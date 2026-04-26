import 'server-only';

/**
 * M16 Unit 4: POST /api/ai/generate
 *
 * Pipeline:
 *   1. Parse body, validate prompt (length, charset, NFKC).
 *   2. Resolve session (Bearer first, cookie fallback).
 *   3. Hash IP (SHA-256 + IP_HASH_SALT, truncated to 16 hex chars).
 *   4. Atomic rate-limit check + increment via Firestore transaction.
 *   5. Call Groq with combined AbortSignal (req.signal + 30s timeout).
 *   6. Decode-validate the response (validation runs inside the codec
 *      via the client wrapper).
 *   7. Log to /aiGenerations (best-effort, never re-thrown).
 *   8. Return { palette, rows } JSON.
 *
 * Slot-burn policy on failure:
 *   - GroqAbortedError with !streamStarted → REFUND (Groq billed
 *     nothing).
 *   - All other failures → BURN (the slot represents whatever the
 *     user's input + LLM did, even if the result is unusable).
 *
 * Env shape diagnostic (commit `de8f76f` discipline): if GROQ_API_KEY
 * is missing or malformed, the 500 body includes `{ debug:
 * { envKeyShape: { present, length, prefix } } }` — never key material.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { getServerSession } from '@/lib/firebase/auth';
import {
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
import { costEstimateUsd, HARD_TIMEOUT_MS, MODEL } from '@/lib/ai/prompt';

const PROMPT_MAX_LEN = 200;
// Match `[\p{Cc}\p{Cf}\p{Co}\p{Cn}]` — control bytes, format/bidi
// overrides, private-use, unassigned codepoints.
const FORBIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u;

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

// ── POST handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Parse body — read once into a const (M10 §Gotcha 737).
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
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
    return jsonError(
      { error: 'prompt_invalid', details: { reason: promptCheck.reason } },
      400,
    );
  }
  const prompt = promptCheck.prompt;

  // 2. Auth.
  const auth = await resolveSession(req);
  if (auth.uid === null) return auth.authError ?? jsonError({ error: 'unauthorized' }, 401);
  const uid = auth.uid;

  // 3. Hash IP.
  const ip = clientIpFrom(req);
  const ipHash = await hashIp(ip);

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

  // 6. Call Groq.
  try {
    const result = await generateSkin(prompt, signal);

    // 7. Best-effort logging of success.
    const cost = costEstimateUsd(result.promptTokens, result.completionTokens);
    void logGeneration({
      uid,
      prompt,
      model: MODEL,
      success: true,
      retryCount: result.retryCount,
      finishReason: result.finishReason,
      tokensIn: result.promptTokens ?? 0,
      tokensOut: result.completionTokens ?? 0,
      costEstimate: cost,
    });
    if (typeof result.totalTokens === 'number' && result.totalTokens > 0) {
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
    // ── Failure paths ──────────────────────────────────────────────

    // GroqEnvError → 500 with shape diagnostic. NEVER include key.
    if (err instanceof GroqEnvError) {
      void logGeneration({
        uid,
        prompt,
        model: MODEL,
        success: false,
        error: 'service_misconfigured',
        retryCount: 0,
        finishReason: null,
        tokensIn: 0,
        tokensOut: 0,
        costEstimate: 0,
      });
      // Burn slot — the user's request was processed and a config
      // failure on our end is not their fault; refunding here would
      // let an attacker probe whether the env is broken (timing
      // signal). Operator should fix the env, not refund users.
      return jsonError(
        {
          error: 'service_misconfigured',
          debug: { envKeyShape: getGroqKeyShape() },
        },
        500,
      );
    }

    // GroqAbortedError → 499 (client-closed-request). Refund only when
    // the abort fired BEFORE any token streaming began.
    if (err instanceof GroqAbortedError) {
      void logGeneration({
        uid,
        prompt,
        model: MODEL,
        success: false,
        error: 'aborted',
        retryCount: 0,
        finishReason: null,
        tokensIn: 0,
        tokensOut: 0,
        costEstimate: 0,
      });
      if (!err.streamStarted) {
        void refundSlot(refundDocs);
      }
      return jsonError({ error: 'aborted' }, 499);
    }

    // GroqTimeoutError → 504. Burn — Groq may have started streaming.
    if (err instanceof GroqTimeoutError) {
      void logGeneration({
        uid,
        prompt,
        model: MODEL,
        success: false,
        error: 'timeout',
        retryCount: 0,
        finishReason: null,
        tokensIn: 0,
        tokensOut: 0,
        costEstimate: 0,
      });
      return jsonError({ error: 'timeout' }, 504);
    }

    // GroqRateLimitError (org-wide quota) → 429 with retry-after.
    if (err instanceof GroqRateLimitError) {
      void logGeneration({
        uid,
        prompt,
        model: MODEL,
        success: false,
        error: 'upstream_rate_limited',
        retryCount: 0,
        finishReason: null,
        tokensIn: 0,
        tokensOut: 0,
        costEstimate: 0,
      });
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

    // GroqAuthError → 500 with shape diagnostic (operator-facing).
    if (err instanceof GroqAuthError) {
      void logGeneration({
        uid,
        prompt,
        model: MODEL,
        success: false,
        error: 'service_misconfigured',
        retryCount: 0,
        finishReason: null,
        tokensIn: 0,
        tokensOut: 0,
        costEstimate: 0,
      });
      return jsonError(
        {
          error: 'service_misconfigured',
          debug: { envKeyShape: getGroqKeyShape() },
        },
        500,
      );
    }

    // GroqValidationError (after retry) → 422.
    if (err instanceof GroqValidationError) {
      void logGeneration({
        uid,
        prompt,
        model: MODEL,
        success: false,
        error: 'generation_invalid',
        validationFailureCategory: err.category,
        retryCount: 1,
        finishReason: err.finishReason,
        tokensIn: 0,
        tokensOut: 0,
        costEstimate: 0,
      });
      return jsonError({ error: 'generation_invalid' }, 422);
    }

    // GroqUpstreamError → 502.
    if (err instanceof GroqUpstreamError) {
      void logGeneration({
        uid,
        prompt,
        model: MODEL,
        success: false,
        error: 'upstream',
        retryCount: 0,
        finishReason: null,
        tokensIn: 0,
        tokensOut: 0,
        costEstimate: 0,
      });
      return jsonError({ error: 'service_unavailable' }, 502);
    }

    // Unknown / unexpected.
    console.error('ai/generate: unexpected failure', err);
    void logGeneration({
      uid,
      prompt,
      model: MODEL,
      success: false,
      error: 'unknown',
      retryCount: 0,
      finishReason: null,
      tokensIn: 0,
      tokensOut: 0,
      costEstimate: 0,
    });
    return jsonError({ error: 'service_unavailable' }, 500);
  }
}
