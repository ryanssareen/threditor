import 'server-only';

/**
 * M16 Unit 2: Groq SDK wrapper.
 *
 * `generateSkin(userPrompt, signal)` is the only public function. It:
 *   1. Reads `GROQ_API_KEY` at invocation time (never at module load).
 *   2. Dynamically imports `groq-sdk` so the package never reaches a
 *      shared client bundle even by accidental re-export.
 *   3. Calls chat.completions.create with `response_format: json_object`.
 *   4. Parses + validates the response via `lib/ai/skin-codec`.
 *   5. On validation failure, retries ONCE at `temperature: 0` with a
 *      stricter reminder appended to the user prompt.
 *   6. Translates SDK errors into typed `GroqXxxError` so the route
 *      can map them to HTTP status codes uniformly.
 *
 * Token usage / finish_reason / model name from the LAST attempt are
 * surfaced via the resolved value so the route can log them.
 */

import { CodecError } from './types';
import { validateResponse } from './skin-codec';
import {
  buildMessages,
  HARD_TIMEOUT_MS,
  MAX_COMPLETION_TOKENS,
  MODEL,
  TEMPERATURE_INITIAL,
  TEMPERATURE_RETRY,
} from './prompt';
import type { AISkinResponse } from './types';

// ── Typed error tree ─────────────────────────────────────────────────

export class GroqEnvError extends Error {
  readonly envKeyShape: { present: boolean; length: number; prefix: string };
  constructor(
    envKeyShape: { present: boolean; length: number; prefix: string },
    message?: string,
  ) {
    super(message ?? 'GROQ_API_KEY is missing or malformed');
    this.name = 'GroqEnvError';
    this.envKeyShape = envKeyShape;
  }
}

export class GroqAuthError extends Error {
  constructor(message?: string) {
    super(message ?? 'Groq authentication failed');
    this.name = 'GroqAuthError';
  }
}

export class GroqRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message?: string) {
    super(message ?? 'Groq rate limit hit');
    this.name = 'GroqRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GroqUpstreamError extends Error {
  constructor(message?: string) {
    super(message ?? 'Groq upstream error');
    this.name = 'GroqUpstreamError';
  }
}

export class GroqTimeoutError extends Error {
  constructor(message?: string) {
    super(message ?? 'Groq call timed out');
    this.name = 'GroqTimeoutError';
  }
}

export class GroqAbortedError extends Error {
  /**
   * Whether token streaming had begun before the abort. `false` means
   * Groq billed nothing (refundable rate-limit slot in the route).
   */
  readonly streamStarted: boolean;
  constructor(streamStarted: boolean, message?: string) {
    super(message ?? 'Groq call aborted by client');
    this.name = 'GroqAbortedError';
    this.streamStarted = streamStarted;
  }
}

export class GroqValidationError extends Error {
  readonly finishReason: string | null;
  /** Truncated to 200 chars before reaching this field — log-safe. */
  readonly samplePayload: string;
  /** Last validation reason from the codec (palette_oor, row_drift, …). */
  readonly category: string;
  constructor(category: string, finishReason: string | null, samplePayload: string) {
    super(`Groq output failed validation after retry: ${category}`);
    this.name = 'GroqValidationError';
    this.category = category;
    this.finishReason = finishReason;
    this.samplePayload = samplePayload;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Shape-only diagnostic on `GROQ_API_KEY`. Never includes key material. */
export function getGroqKeyShape(): {
  present: boolean;
  length: number;
  prefix: string;
} {
  const raw = process.env.GROQ_API_KEY ?? '';
  const trimmed = raw.trim();
  return {
    present: trimmed.length > 0,
    length: trimmed.length,
    // First 4 chars confirm a Groq-shaped key (`gsk_`) without leaking
    // any organization-keyed entropy.
    prefix: trimmed.slice(0, 4),
  };
}

/**
 * Strip a `\`\`\`json … \`\`\`` fence wrapper if Groq emitted one
 * despite our system prompt forbidding it. Returns the unwrapped
 * string; if no fence, returns the input unchanged.
 */
function stripCodeFences(content: string): string {
  const trimmed = content.trim();
  // ```json\n...\n``` or ```\n...\n```
  const fenceMatch = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  if (fenceMatch !== null) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * Try to extract a top-level JSON object from a string that may have
 * leading prose. Looks for the first `{` and the matching last `}`.
 * Returns null if no balanced extraction is found — we'd rather
 * trigger a retry than risk JSON.parse on noise.
 */
function extractJsonObject(content: string): string | null {
  const stripped = stripCodeFences(content);
  if (stripped.startsWith('{') && stripped.endsWith('}')) return stripped;
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  return stripped.slice(first, last + 1);
}

type AttemptResult = {
  parsed: AISkinResponse;
  finishReason: string | null;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  totalTokens: number | undefined;
};

export type GenerateSkinResult = AttemptResult & {
  retryCount: 0 | 1;
};

/** What we get from `groq-sdk` for one attempt — minimal shape. */
type GroqAttemptOutcome =
  | {
      kind: 'ok';
      content: string;
      finishReason: string | null;
      usage: {
        promptTokens: number | undefined;
        completionTokens: number | undefined;
        totalTokens: number | undefined;
      };
    }
  | { kind: 'aborted'; streamStarted: boolean }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'auth_error' }
  | { kind: 'timeout' }
  | { kind: 'upstream_error'; message: string };

// ── Main ─────────────────────────────────────────────────────────────

export async function generateSkin(
  userPrompt: string,
  signal: AbortSignal,
): Promise<GenerateSkinResult> {
  console.log('[Groq] 🔧 generateSkin called:', {
    promptLength: userPrompt.length,
    promptPreview: userPrompt.substring(0, 50) + '...',
    timestamp: new Date().toISOString(),
  });
  
  const keyShape = getGroqKeyShape();
  console.log('[Groq] 🔑 API Key shape:', keyShape);
  
  if (!keyShape.present) {
    console.error('[Groq] ❌ API Key missing!');
    throw new GroqEnvError(keyShape);
  }

  console.log('[Groq] 📦 Importing groq-sdk...');
  // Dynamic import keeps groq-sdk out of any accidentally-shared bundle
  // path. The cost of the import is one-time-per-cold-start (~200ms).
  const groqMod = await import('groq-sdk');
  const Groq = groqMod.default ?? groqMod.Groq;
  const errorCtors = groqMod;

  console.log('[Groq] 🏗️  Creating Groq client...');
  const client = new Groq({
    apiKey: process.env.GROQ_API_KEY,
    timeout: HARD_TIMEOUT_MS,
    // SDK retries on 5xx are fine; we layer one retry on top for
    // validation-only failures.
    maxRetries: 1,
  });

  console.log('[Groq] 📞 Calling Groq API (attempt 1, temp 0.8)...');
  // First attempt at temperature 0.8.
  let attempt: AttemptResult;
  let retryCount: 0 | 1 = 0;
  try {
    attempt = await runAttempt({
      client,
      errorCtors,
      isRetry: false,
      userPrompt,
      signal,
      temperature: TEMPERATURE_INITIAL,
    });
    return { ...attempt, retryCount };
  } catch (err) {
    // Only CodecError gets a retry. Everything else propagates
    // immediately so 401/429/timeout don't double-bill the user.
    if (!(err instanceof CodecError)) throw err;

    retryCount = 1;
    try {
      attempt = await runAttempt({
        client,
        errorCtors,
        isRetry: true,
        userPrompt,
        signal,
        temperature: TEMPERATURE_RETRY,
      });
      return { ...attempt, retryCount };
    } catch (retryErr) {
      if (retryErr instanceof CodecError) {
        throw new GroqValidationError(
          retryErr.reason,
          null,
          retryErr.message.slice(0, 200),
        );
      }
      throw retryErr;
    }
  }
}

/**
 * One Groq round-trip + parse + validate. Throws CodecError on shape
 * failure (caller decides whether to retry); throws typed GroqXxxError
 * on transport / auth / rate-limit / timeout failures.
 */
async function runAttempt(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorCtors: any;
  isRetry: boolean;
  userPrompt: string;
  signal: AbortSignal;
  temperature: number;
}): Promise<AttemptResult> {
  const { client, errorCtors, isRetry, userPrompt, signal, temperature } = args;
  const messages = buildMessages(userPrompt, isRetry);

  const outcome = await callGroqOnce({
    client,
    errorCtors,
    messages,
    signal,
    temperature,
  });
  if (outcome.kind === 'aborted') {
    throw new GroqAbortedError(outcome.streamStarted);
  }
  if (outcome.kind === 'rate_limited') {
    throw new GroqRateLimitError(outcome.retryAfterSeconds);
  }
  if (outcome.kind === 'auth_error') {
    throw new GroqAuthError();
  }
  if (outcome.kind === 'timeout') {
    throw new GroqTimeoutError();
  }
  if (outcome.kind === 'upstream_error') {
    throw new GroqUpstreamError(outcome.message);
  }

  console.log('[Groq] 📝 Raw response received:', {
    contentLength: outcome.content.length,
    contentPreview: outcome.content.substring(0, 200) + '...',
    finishReason: outcome.finishReason,
  });

  const json = extractJsonObject(outcome.content);
  if (json === null) {
    throw new CodecError('shape_invalid', 'No JSON object found in response');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CodecError('shape_invalid', 'JSON.parse failed');
  }

  console.log('[Groq] 🔍 Parsed JSON structure:', {
    hasPalette: typeof parsed === 'object' && parsed !== null && 'palette' in parsed,
    hasRows: typeof parsed === 'object' && parsed !== null && 'rows' in parsed,
    rowCount: typeof parsed === 'object' && parsed !== null && 'rows' in parsed && Array.isArray((parsed as any).rows) ? (parsed as any).rows.length : 'N/A',
    paletteCount: typeof parsed === 'object' && parsed !== null && 'palette' in parsed && Array.isArray((parsed as any).palette) ? (parsed as any).palette.length : 'N/A',
  });

  // Throws CodecError on any shape problem.
  validateResponse(parsed);

  return {
    parsed,
    finishReason: outcome.finishReason,
    promptTokens: outcome.usage.promptTokens,
    completionTokens: outcome.usage.completionTokens,
    totalTokens: outcome.usage.totalTokens,
  };
}

/** Call Groq once, classify the outcome. No parsing here. */
async function callGroqOnce(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorCtors: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any;
  signal: AbortSignal;
  temperature: number;
}): Promise<GroqAttemptOutcome> {
  const { client, errorCtors, messages, signal, temperature } = args;

  try {
    const completion = await client.chat.completions.create(
      {
        model: MODEL,
        messages,
        // NOTE: Removed response_format json_object mode because llama-3.3-70b-versatile
        // returns 400 "json_validate_failed". Relying on prompt engineering instead.
        // response_format: { type: 'json_object' },
        temperature,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      },
      { signal },
    );
    const choice = completion?.choices?.[0];
    const content: unknown = choice?.message?.content ?? '';
    if (typeof content !== 'string' || content.length === 0) {
      return {
        kind: 'upstream_error',
        message: 'empty completion content',
      };
    }
    return {
      kind: 'ok',
      content,
      finishReason:
        typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      usage: {
        promptTokens: completion?.usage?.prompt_tokens,
        completionTokens: completion?.usage?.completion_tokens,
        totalTokens: completion?.usage?.total_tokens,
      },
    };
  } catch (err) {
    return classifySdkError(err, errorCtors, signal);
  }
}

function classifySdkError(
  err: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorCtors: any,
  signal: AbortSignal,
): GroqAttemptOutcome {
  // The Groq SDK uses native AbortController — when our signal fires,
  // the SDK throws either a DOMException with name=AbortError or a
  // GroqError-shaped APIUserAbortError.
  if (signal.aborted) {
    // Heuristic: if the error came from `fetch` before any chunks were
    // read, streaming had not started. We don't have a clean signal
    // from the SDK for "stream started or not", so we conservatively
    // assume `streamStarted: false` for an early abort. The route
    // refunds the rate-limit slot only when our signal fired before
    // the SDK promise resolved or rejected for any other reason — see
    // /api/ai/generate route comments.
    return { kind: 'aborted', streamStarted: false };
  }

  // Detect SDK-specific errors by `name` (works whether the constructor
  // came from CJS or ESM). Falls back to message-string matching for
  // older/newer SDKs.
  const name =
    err !== null && typeof err === 'object' && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';
  const status =
    err !== null && typeof err === 'object' && 'status' in err
      ? Number((err as { status: unknown }).status)
      : NaN;
  const message =
    err instanceof Error ? err.message : String(err ?? 'unknown error');

  if (
    name === 'APIUserAbortError' ||
    name === 'AbortError' ||
    /aborted/i.test(message)
  ) {
    return { kind: 'aborted', streamStarted: false };
  }

  if (
    name === 'APIConnectionTimeoutError' ||
    /timeout/i.test(message) ||
    /TIMEOUT/.test(message)
  ) {
    return { kind: 'timeout' };
  }

  if (name === 'AuthenticationError' || status === 401 || status === 403) {
    return { kind: 'auth_error' };
  }

  if (name === 'RateLimitError' || status === 429) {
    let retryAfterSeconds = 60;
    // Best-effort header read.
    const headers =
      err !== null && typeof err === 'object' && 'headers' in err
        ? (err as { headers: unknown }).headers
        : null;
    if (headers !== null && typeof headers === 'object') {
      const rh = (headers as Record<string, unknown>)['retry-after'];
      if (typeof rh === 'string') {
        const n = Number(rh);
        if (Number.isFinite(n) && n > 0) retryAfterSeconds = n;
      }
    }
    return { kind: 'rate_limited', retryAfterSeconds };
  }

  // Use the SDK's own type if available; otherwise fall through.
  if (
    errorCtors?.APIUserAbortError !== undefined &&
    err instanceof errorCtors.APIUserAbortError
  ) {
    return { kind: 'aborted', streamStarted: false };
  }
  if (
    errorCtors?.APIConnectionTimeoutError !== undefined &&
    err instanceof errorCtors.APIConnectionTimeoutError
  ) {
    return { kind: 'timeout' };
  }

  return { kind: 'upstream_error', message: message.slice(0, 200) };
}
