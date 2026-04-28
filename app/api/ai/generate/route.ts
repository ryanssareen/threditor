import 'server-only';

/**
 * M16 Unit 4 + M17 Unit 5: POST /api/ai/generate
 *
 * Pipeline:
 *   1. Parse body, validate prompt (length, charset, NFKC).
 *   2. Resolve session (Bearer first, cookie fallback).
 *   3. Hash IP (SHA-256 + IP_HASH_SALT, truncated to 16 hex chars).
 *   4. Atomic rate-limit check + increment via Firestore transaction.
 *   5. Branch on `AI_PROVIDER` env (default: `groq`):
 *        - `cloudflare` → Cloudflare Worker (SDXL Lightning) →
 *          sharp/image-q pipeline → AISkinResponse.
 *        - `groq` → existing M16 Groq SDK path.
 *   6. Decode-validate the response (codec inside the provider wrap).
 *   7. Log to /aiGenerations (best-effort, never re-thrown) with
 *      `provider` for cohort comparison.
 *   8. Return { palette, rows } JSON.
 *
 * Slot-burn policy on failure (preserved from M16):
 *   - GroqAbortedError / CloudflareAbortedError with !streamStarted
 *     → REFUND (provider billed nothing).
 *   - All other failures → BURN.
 *
 * Cloudflare slot-burn note: `streamStarted=true` flips when the
 * `fetch(workerUrl)` promise resolves (response headers received).
 * Cloudflare bills Neurons inside the Worker before the response
 * promise resolves on the Vercel side, so an abort during the
 * `arrayBuffer()` read keeps the slot burned. See plan §System-Wide
 * Impact for the rationale.
 *
 * `maxDuration = 30` matches the in-handler `HARD_TIMEOUT_MS`. Without
 * it the Vercel Hobby-tier 10s default would 504 on cold starts before
 * our own combined-signal abort fires.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getServerSession } from '@/lib/firebase/auth';
import {
  bumpAggregateCloudflareCalls,
  bumpAggregateTokens,
  checkAndIncrement,
  hashIp,
  refundSlot,
} from '@/lib/ai/rate-limit';
import { logGeneration } from '@/lib/firebase/ai-logs';
import {
  GroqAbortedError,
  GroqAuthError,
  GroqEnvError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqUpstreamError,
  GroqValidationError,
  generateSkin,
  getGroqKeyShape,
} from '@/lib/ai/groq';
import {
  CloudflareAbortedError,
  CloudflareAuthError,
  CloudflareEnvError,
  CloudflareRateLimitError,
  CloudflareTimeoutError,
  CloudflareUpstreamError,
  ImageProcessingError,
} from '@/lib/ai/cloudflare-errors';
import {
  CLOUDFLARE_MODEL_ID,
  generateSkinFromParts,
  getCloudflareEnvShape,
} from '@/lib/ai/cloudflare-client';
import { interpretPromptToSkinParts } from '@/lib/ai/groq-interpreter';
import { analyzePromptForClarification } from '@/lib/ai/groq-clarifier';
import { costEstimateUsd, HARD_TIMEOUT_MS, MODEL } from '@/lib/ai/prompt';
import type { AISkinResponse, UserAnswers } from '@/lib/ai/types';

const PROMPT_MAX_LEN = 200;
// Match `[\p{Cc}\p{Cf}\p{Co}\p{Cn}]` — control bytes, format/bidi
// overrides, private-use, unassigned codepoints.
const FORBIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u;

type Provider = 'groq' | 'cloudflare';

function readProvider(): Provider {
  const raw = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  return raw === 'cloudflare' ? 'cloudflare' : 'groq';
}

// ── Helpers ──────────────────────────────────────────────────────────

function privateNoStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  return res;
}

function jsonError(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: Record<string, string>,
): NextResponse {
  const res = NextResponse.json(body, { status });
  if (extraHeaders !== undefined) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      res.headers.set(k, v);
    }
  }
  return privateNoStore(res);
}

type PromptValidation =
  | { ok: true; prompt: string }
  | {
      ok: false;
      reason: 'required' | 'too_long' | 'empty' | 'invalid_chars' | 'unicode_form';
    };

function validatePrompt(raw: unknown): PromptValidation {
  if (typeof raw !== 'string') return { ok: false, reason: 'required' };
  if (raw.length === 0) return { ok: false, reason: 'required' };
  // Length cap on the RAW (pre-trim) value so a 200-char prompt with
  // trailing whitespace doesn't squeak through.
  if (raw.length > PROMPT_MAX_LEN) return { ok: false, reason: 'too_long' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed !== trimmed.normalize('NFKC')) {
    return { ok: false, reason: 'unicode_form' };
  }
  if (FORBIDDEN_CHARS.test(trimmed)) {
    return { ok: false, reason: 'invalid_chars' };
  }
  return { ok: true, prompt: trimmed };
}

async function resolveSession(req: NextRequest): Promise<{
  uid: string | null;
  authError: NextResponse | null;
}> {
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (bearerMatch !== null) {
    try {
      const { auth } = (await import('@/lib/firebase/admin')).getAdminFirebase();
      // checkRevoked: true — appropriate for a paid endpoint (revoke
      // honored immediately rather than waiting for the 1h ID-token
      // refresh window).
      const decoded = await auth.verifyIdToken(bearerMatch[1], true);
      return { uid: decoded.uid, authError: null };
    } catch {
      // fall through to cookie path; 401 if both fail.
    }
  }
  const session = await getServerSession();
  if (session !== null) return { uid: session.uid, authError: null };
  return {
    uid: null,
    authError: jsonError({ error: 'unauthorized' }, 401),
  };
}

function clientIpFrom(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const first = fwd.split(',')[0]?.trim();
  if (first !== undefined && first.length > 0) return first;
  return req.headers.get('x-real-ip')?.trim() ?? '';
}

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  // AbortSignal.any is in Node 20 and modern browsers — we're in Node
  // runtime here so it's safe to assume.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const any = (AbortSignal as any).any;
  if (typeof any === 'function') return any(signals);
  // Fallback: manual fan-in. Returns a controller that aborts on
  // first child.
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

// ── Provider unification ─────────────────────────────────────────────

type ProviderResult = {
  parsed: AISkinResponse;
  retryCount: 0 | 1;
  finishReason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  totalTokens: number | null;
  modelId: string;
};

async function callProvider(
  provider: Provider,
  prompt: string,
  userAnswers: UserAnswers | null,
  signal: AbortSignal,
): Promise<ProviderResult> {
  if (provider === 'cloudflare') {
    // M17 Stages 2+3 (Stage 1 — clarifier — runs in the route handler
    // before we get here):
    //   Stage 2: Groq interprets the user prompt + clarification
    //            answers into structured per-part `SkinPartDescriptions`.
    //   Stage 3: Cloudflare worker renders a 64×64 skin from a rich
    //            region-aware composed prompt.
    console.log('[AI Generation] 🧠 Stage 2: Groq interpreting prompt → parts');
    const stage2 = await interpretPromptToSkinParts(prompt, userAnswers, signal);
    console.log('[AI Generation] ✅ Stage 2 complete:', {
      variant: stage2.parts.variant,
      hasHeadOverlay: stage2.parts.headOverlay !== undefined,
      hasTorsoOverlay: stage2.parts.torsoOverlay !== undefined,
      hasUserAnswers: userAnswers !== null,
      promptTokens: stage2.promptTokens,
      completionTokens: stage2.completionTokens,
    });

    console.log('[AI Generation] 🎨 Stage 3: Cloudflare rendering parts → skin');
    const r = await generateSkinFromParts(stage2.parts, signal);
    console.log('[AI Generation] ✅ Stage 3 complete:', {
      durationMs: r.durationMs,
      paletteSize: r.parsed.palette.length,
    });

    return {
      parsed: r.parsed,
      retryCount: 0,
      finishReason: 'stop',
      tokensIn: stage2.promptTokens,
      tokensOut: stage2.completionTokens,
      totalTokens: stage2.totalTokens,
      modelId: r.modelId,
    };
  }
  const r = await generateSkin(prompt, signal);
  return {
    parsed: r.parsed,
    retryCount: r.retryCount,
    finishReason: r.finishReason,
    tokensIn: r.promptTokens ?? 0,
    tokensOut: r.completionTokens ?? 0,
    totalTokens: r.totalTokens ?? 0,
    modelId: MODEL,
  };
}

/**
 * Validate `userAnswers` from the request body. Returns:
 *   - `null` when the field is missing / null / not an object
 *   - a normalized `UserAnswers` map otherwise (keys clamped, values
 *     coerced to string / string[]; non-string values dropped)
 *
 * Per-key cap is 40 chars, per-value 80, max 16 keys. Defends against
 * the answer channel becoming a side-channel for prompt injection or
 * cost amplification.
 */
function normalizeUserAnswers(raw: unknown): UserAnswers | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const out: UserAnswers = {};
  let count = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (count >= 16) break;
    const key = String(k).trim().slice(0, 40);
    if (key.length === 0) continue;
    if (typeof v === 'string') {
      const value = v.trim().slice(0, 80);
      if (value.length === 0) continue;
      out[key] = value;
      count++;
    } else if (Array.isArray(v)) {
      const arr: string[] = [];
      for (const item of v.slice(0, 8)) {
        if (typeof item !== 'string') continue;
        const t = item.trim().slice(0, 80);
        if (t.length === 0) continue;
        arr.push(t);
      }
      if (arr.length > 0) {
        out[key] = arr;
        count++;
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ── POST handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log('[AI Generation] 🎬 Request received');
  
  // 1. Parse body — read once into a const (M10 §Gotcha 737).
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
    console.log('[AI Generation] 📦 Body parsed:', {
      hasBody: bodyJson !== null,
      bodyType: typeof bodyJson,
      bodyKeys: bodyJson && typeof bodyJson === 'object' ? Object.keys(bodyJson) : [],
    });
  } catch (err) {
    console.error('[AI Generation] ❌ JSON parse error:', err);
    return jsonError(
      { error: 'prompt_invalid', details: { reason: 'required' } },
      400,
    );
  }
  const promptRaw =
    bodyJson !== null &&
    typeof bodyJson === 'object' &&
    'prompt' in bodyJson
      ? (bodyJson as { prompt: unknown }).prompt
      : undefined;
  const promptCheck = validatePrompt(promptRaw);
  if (!promptCheck.ok) {
    console.error('[AI Generation] ❌ Prompt validation failed:', promptCheck.reason);
    return jsonError(
      { error: 'prompt_invalid', details: { reason: promptCheck.reason } },
      400,
    );
  }
  const prompt = promptCheck.prompt;
  console.log('[AI Generation] ✅ Prompt validated:', prompt.substring(0, 50) + '...');

  // M17: Parse mode parameter (optional, defaults to env var).
  const modeRaw =
    bodyJson !== null &&
    typeof bodyJson === 'object' &&
    'mode' in bodyJson
      ? (bodyJson as { mode: unknown }).mode
      : undefined;
  console.log('[AI Generation] 🎛️ Mode parsing:', {
    modeRaw,
    modeType: typeof modeRaw,
    envProvider: process.env.AI_PROVIDER,
    envProviderTrimmed: (process.env.AI_PROVIDER ?? '').trim(),
  });
  
  const provider: Provider =
    modeRaw === 'cloudflare' || modeRaw === 'groq'
      ? modeRaw
      : readProvider(); // fallback to env var

  console.log('[AI Generation] 🎯 Provider selected:', provider);

  // M17 Stage-1 inputs:
  //   - `userAnswers` — present on the second round-trip after the
  //     dialog gathers clarification responses.
  //   - `skipClarification` — true when the caller wants to bypass the
  //     clarifier entirely (e.g., simple prompt the user knows is fine,
  //     or repeated retries).
  const userAnswers: UserAnswers | null = normalizeUserAnswers(
    bodyJson !== null && typeof bodyJson === 'object' && 'userAnswers' in bodyJson
      ? (bodyJson as { userAnswers: unknown }).userAnswers
      : undefined,
  );
  const skipClarification =
    bodyJson !== null &&
    typeof bodyJson === 'object' &&
    'skipClarification' in bodyJson &&
    (bodyJson as { skipClarification: unknown }).skipClarification === true;
  console.log('[AI Generation] 🛠 Clarification flags:', {
    hasUserAnswers: userAnswers !== null,
    skipClarification,
  });

  // 2. Auth.
  const auth = await resolveSession(req);
  if (auth.uid === null) return auth.authError ?? jsonError({ error: 'unauthorized' }, 401);
  const uid = auth.uid;

  // 3. Hash IP.
  const ip = clientIpFrom(req);
  const ipHash = await hashIp(ip);

  // M17 Stage 1 — Clarifier. Runs BEFORE rate-limit consumption when
  // the caller hasn't already answered questions and hasn't asked us
  // to skip. The clarifier is cheap (~300 tokens) and runs only once
  // per user-initiated generation; we don't burn a generation slot
  // for it, so users aren't penalized for the dialog round-trip.
  //
  // Only the `cloudflare` provider runs the clarifier — the `groq`
  // provider's M16 path is a single-call generator with its own
  // prompt strategy, and adding clarification there would change its
  // observed cost / behavior unrelated to the M17 lift.
  const shouldClarify =
    provider === 'cloudflare' && !skipClarification && userAnswers === null;
  if (shouldClarify) {
    const clarifySignal = AbortSignal.timeout(HARD_TIMEOUT_MS);
    const combined = combineSignals(req.signal, clarifySignal);
    try {
      console.log('[AI Generation] ❓ Stage 1: Clarifier analyzing prompt');
      const clarifyResult = await analyzePromptForClarification(prompt, combined);
      if (clarifyResult.response.needsClarification) {
        console.log('[AI Generation] ↩ Returning clarification questions:', {
          count: clarifyResult.response.questions?.length ?? 0,
        });
        // No slot burned — questions returned without consuming the
        // user's daily / hourly generation budget.
        return privateNoStore(
          NextResponse.json({
            status: 'needs_clarification',
            questions: clarifyResult.response.questions,
          }),
        );
      }
      console.log('[AI Generation] ✅ Clarifier: no questions needed, proceeding');
    } catch (err) {
      // Clarifier failure should NOT block the user — fall through to
      // generation without answers. Log so we can spot a chronically
      // broken Stage-1 in production.
      console.warn('[AI Generation] ⚠ Stage-1 clarifier failed, proceeding without:', {
        errorName: err instanceof Error ? err.constructor.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Rate-limit check + increment.
  let rateGate;
  try {
    rateGate = await checkAndIncrement({ uid, ipHash });
  } catch (err) {
    console.error('rate-limit transaction failed:', err);
    return jsonError({ error: 'service_unavailable' }, 503);
  }
  if (!rateGate.allowed) {
    if (rateGate.reason === 'aggregate') {
      // Distinguish operator-driven pause from per-user/IP caps.
      return jsonError({ error: 'service_paused' }, 503);
    }
    return jsonError(
      { error: 'rate_limited', reason: rateGate.reason, resetAt: rateGate.resetAt },
      429,
    );
  }
  const refundDocs = rateGate.refundDocs;

  // 5. Combined abort signal: client disconnect OR 30s timeout.
  const timeoutSignal = AbortSignal.timeout(HARD_TIMEOUT_MS);
  const signal = combineSignals(req.signal, timeoutSignal);

  // 6. Call the model.
  console.log('[AI Generation] 🚀 Starting generation:', {
    promptPreview: prompt.substring(0, 50) + '...',
    provider,
    uid,
    timestamp: new Date().toISOString(),
  });

  try {
    const result = await callProvider(provider, prompt, userAnswers, signal);

    console.log('[AI Generation] ✅ Success:', {
      promptPreview: prompt.substring(0, 50) + '...',
      provider,
      modelId: result.modelId,
      retryCount: result.retryCount,
      finishReason: result.finishReason,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      timestamp: new Date().toISOString(),
    });

    // 7. Best-effort logging of success.
    const cost =
      provider === 'cloudflare'
        ? 0
        : costEstimateUsd(result.tokensIn ?? undefined, result.tokensOut ?? undefined);
    void logGeneration({
      uid,
      prompt,
      model: result.modelId,
      provider,
      success: true,
      retryCount: result.retryCount,
      finishReason: result.finishReason,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costEstimate: cost,
    });

    if (provider === 'cloudflare') {
      void bumpAggregateCloudflareCalls(1);
    } else if (typeof result.totalTokens === 'number' && result.totalTokens > 0) {
      void bumpAggregateTokens(result.totalTokens);
    }

    // 8. Success response.
    return privateNoStore(
      NextResponse.json({
        palette: result.parsed.palette,
        rows: result.parsed.rows,
      }),
    );
  } catch (err) {
    console.error('[AI Generation] ❌ Provider call failed:', {
      error: err,
      errorType: err?.constructor?.name,
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
      provider,
      timestamp: new Date().toISOString(),
    });
    return handleProviderError(err, {
      provider,
      uid,
      prompt,
      refundDocs,
    });
  }
}

// ── Error mapping ────────────────────────────────────────────────────

type ErrorContext = {
  provider: Provider;
  uid: string;
  prompt: string;
  refundDocs: { user: string; userDay: string; ip: string | null };
};

function logFailure(
  ctx: ErrorContext,
  partial: {
    error: string;
    validationFailureCategory?: string;
    retryCount?: 0 | 1;
    finishReason?: string | null;
  },
): void {
  void logGeneration({
    uid: ctx.uid,
    prompt: ctx.prompt,
    model: ctx.provider === 'cloudflare' ? CLOUDFLARE_MODEL_ID : MODEL,
    provider: ctx.provider,
    success: false,
    error: partial.error,
    validationFailureCategory: partial.validationFailureCategory,
    retryCount: partial.retryCount ?? 0,
    finishReason: partial.finishReason ?? null,
    tokensIn: ctx.provider === 'cloudflare' ? null : 0,
    tokensOut: ctx.provider === 'cloudflare' ? null : 0,
    costEstimate: 0,
  });
}

function handleProviderError(err: unknown, ctx: ErrorContext): NextResponse {
  console.log('[AI Generation] 🔍 Handling error:', {
    errorConstructor: err?.constructor?.name,
    isCloudflareEnvError: err instanceof CloudflareEnvError,
    isCloudflareAuthError: err instanceof CloudflareAuthError,
    isCloudflareRateLimitError: err instanceof CloudflareRateLimitError,
    isError: err instanceof Error,
    provider: ctx.provider,
  });
  
  // ── Cloudflare error tree ──────────────────────────────────────

  if (err instanceof CloudflareEnvError) {
    console.error(
      '[AI Generation] ❌ CloudflareEnvError - Worker URL/token misconfigured:',
      {
        envShape: err.envShape,
        message: err.message,
        timestamp: new Date().toISOString(),
      },
    );
    logFailure(ctx, { error: 'service_misconfigured' });
    // No `debug` body — operator reads the diagnostic from server logs.
    return jsonError({ error: 'service_misconfigured' }, 500);
  }

  if (err instanceof CloudflareAuthError) {
    console.error(
      '[AI Generation] ❌ CloudflareAuthError - Worker rejected our token:',
      {
        envShape: getCloudflareEnvShape(),
        message: err.message,
        timestamp: new Date().toISOString(),
      },
    );
    logFailure(ctx, { error: 'service_misconfigured' });
    return jsonError({ error: 'service_misconfigured' }, 500);
  }

  if (err instanceof CloudflareRateLimitError) {
    console.warn(
      '[AI Generation] ⚠️  CloudflareRateLimitError - WAF rate limit:',
      {
        retryAfterSeconds: err.retryAfterSeconds,
        timestamp: new Date().toISOString(),
      },
    );
    logFailure(ctx, { error: 'upstream_rate_limited' });
    return jsonError(
      {
        error: 'rate_limited',
        reason: 'aggregate',
        resetAt: Date.now() + err.retryAfterSeconds * 1000,
      },
      429,
      { 'Retry-After': String(err.retryAfterSeconds) },
    );
  }

  if (err instanceof CloudflareTimeoutError) {
    console.error('[AI Generation] ❌ CloudflareTimeoutError - Worker timed out:', {
      timeoutMs: HARD_TIMEOUT_MS,
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, { error: 'timeout' });
    return jsonError({ error: 'timeout' }, 504);
  }

  if (err instanceof CloudflareAbortedError) {
    console.warn(
      '[AI Generation] ⚠️  CloudflareAbortedError - Worker call aborted:',
      {
        streamStarted: err.streamStarted,
        willRefund: !err.streamStarted,
        timestamp: new Date().toISOString(),
      },
    );
    logFailure(ctx, { error: 'aborted' });
    if (!err.streamStarted) {
      void refundSlot(ctx.refundDocs);
    }
    return jsonError({ error: 'aborted' }, 499);
  }

  if (err instanceof CloudflareUpstreamError) {
    console.error('[AI Generation] ❌ CloudflareUpstreamError - Worker upstream error:', {
      statusCode: err.statusCode,
      bodyExcerpt: err.bodyExcerpt,
      message: err.message,
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, { error: 'upstream' });
    return jsonError({ error: 'service_unavailable' }, 502);
  }

  if (err instanceof ImageProcessingError) {
    console.error('[AI Generation] ❌ ImageProcessingError - sharp/image-q failed:', {
      category: err.category,
      message: err.message,
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, {
      error: 'generation_invalid',
      validationFailureCategory: err.category,
    });
    return jsonError({ error: 'generation_invalid' }, 422);
  }

  // ── Groq error tree (preserved from M16) ───────────────────────

  if (err instanceof GroqEnvError) {
    console.error('[AI Generation] ❌ GroqEnvError - API Key Configuration Issue:', {
      errorMessage: err.message,
      envKeyShape: getGroqKeyShape(),
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, { error: 'service_misconfigured' });
    return jsonError(
      {
        error: 'service_misconfigured',
        debug: { envKeyShape: getGroqKeyShape() },
      },
      500,
    );
  }

  if (err instanceof GroqAbortedError) {
    console.warn('[AI Generation] ⚠️  GroqAbortedError - Request Cancelled:', {
      streamStarted: err.streamStarted,
      willRefund: !err.streamStarted,
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, { error: 'aborted' });
    if (!err.streamStarted) {
      void refundSlot(ctx.refundDocs);
    }
    return jsonError({ error: 'aborted' }, 499);
  }

  if (err instanceof GroqTimeoutError) {
    console.error('[AI Generation] ❌ GroqTimeoutError - Request Timed Out:', {
      timeoutMs: HARD_TIMEOUT_MS,
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, { error: 'timeout' });
    return jsonError({ error: 'timeout' }, 504);
  }

  if (err instanceof GroqRateLimitError) {
    console.warn('[AI Generation] ⚠️  GroqRateLimitError - Upstream Rate Limited:', {
      retryAfterSeconds: err.retryAfterSeconds,
      resetAt: new Date(Date.now() + err.retryAfterSeconds * 1000).toISOString(),
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, { error: 'upstream_rate_limited' });
    return jsonError(
      {
        error: 'rate_limited',
        reason: 'aggregate',
        resetAt: Date.now() + err.retryAfterSeconds * 1000,
      },
      429,
      { 'Retry-After': String(err.retryAfterSeconds) },
    );
  }

  if (err instanceof GroqAuthError) {
    console.error('[AI Generation] ❌ GroqAuthError - Authentication Failed:', {
      errorMessage: err.message,
      envKeyShape: getGroqKeyShape(),
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, { error: 'service_misconfigured' });
    return jsonError(
      {
        error: 'service_misconfigured',
        debug: { envKeyShape: getGroqKeyShape() },
      },
      500,
    );
  }

  if (err instanceof GroqValidationError) {
    console.error(
      '[AI Generation] ❌ GroqValidationError - Invalid Generation Output:',
      {
        category: err.category,
        finishReason: err.finishReason,
        errorMessage: err.message,
        promptPreview: ctx.prompt.substring(0, 50) + '...',
        timestamp: new Date().toISOString(),
      },
    );
    logFailure(ctx, {
      error: 'generation_invalid',
      validationFailureCategory: err.category,
      retryCount: 1,
      finishReason: err.finishReason,
    });
    return jsonError({ error: 'generation_invalid' }, 422);
  }

  if (err instanceof GroqUpstreamError) {
    console.error('[AI Generation] ❌ GroqUpstreamError - Groq API Error:', {
      errorMessage: err.message,
      timestamp: new Date().toISOString(),
    });
    logFailure(ctx, { error: 'upstream' });
    return jsonError({ error: 'service_unavailable' }, 502);
  }

  // ── Unknown / unexpected ───────────────────────────────────────

  console.error('[AI Generation] 🔥 UNEXPECTED ERROR:', {
    errorName: err instanceof Error ? err.constructor.name : typeof err,
    errorMessage: err instanceof Error ? err.message : String(err),
    errorStack: err instanceof Error ? err.stack : undefined,
    promptPreview: ctx.prompt.substring(0, 50) + '...',
    timestamp: new Date().toISOString(),
  });
  logFailure(ctx, { error: 'unknown' });
  return jsonError({ error: 'service_unavailable' }, 500);
}
