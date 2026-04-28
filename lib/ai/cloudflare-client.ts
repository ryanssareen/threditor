import 'server-only';

/**
 * M17 Unit 4: Cloudflare Worker fetch wrapper with typed errors.
 *
 * Mirrors the discipline of `lib/ai/groq.ts`: env vars read at
 * invocation time (never at module load), exhaustive error
 * classification into typed `CloudflareXxxError` so the route's
 * catch cascade can map each to an HTTP status code uniformly.
 *
 * No retry logic — the route handles retry policy at a higher level.
 *
 * Slot-burn detection seam: `streamStarted` flips to `true` the
 * moment `fetch(...)` resolves (response headers received). After
 * that point, the Worker has likely already burned Neurons inside
 * `env.AI.run`, so abort during `arrayBuffer()` keeps the rate-limit
 * slot burned even though the Vercel-side payload never arrived.
 * See plan §System-Wide Impact for the rationale.
 */

import {
  CloudflareAbortedError,
  CloudflareAuthError,
  CloudflareEnvError,
  CloudflareRateLimitError,
  CloudflareTimeoutError,
  CloudflareUpstreamError,
  type CloudflareEnvShape,
} from './cloudflare-errors';
import { generateSkinFromImage } from './cloudflare';
import { composeRenderPrompt } from './groq-interpreter';
import type { AISkinResponse, SkinPartDescriptions } from './types';

/** Cloudflare model identifier as recorded on /aiGenerations.model. */
export const CLOUDFLARE_MODEL_ID = 'cf/sdxl-lightning';

const BODY_EXCERPT_LEN = 200;

export type CloudflareCallResult = {
  parsed: AISkinResponse;
  durationMs: number;
  modelId: typeof CLOUDFLARE_MODEL_ID;
};

/**
 * Shape-only env diagnostic. Logs `present: boolean` for both vars,
 * plus the URL hostname when present. NEVER includes the URL itself,
 * the token, or any prefix of either. The route logs this server-side
 * but never returns it in user-facing 500 bodies.
 */
export function getCloudflareEnvShape(): CloudflareEnvShape {
  const url = process.env.CLOUDFLARE_WORKER_URL ?? '';
  const token = process.env.CLOUDFLARE_WORKER_TOKEN ?? '';
  const trimmedUrl = url.trim();
  const trimmedToken = token.trim();
  const urlPresent = trimmedUrl.length > 0;
  let hostname: string | undefined;
  if (urlPresent) {
    try {
      hostname = new URL(trimmedUrl).hostname;
    } catch {
      // Malformed URL — leave hostname undefined so the diagnostic
      // surfaces as `{ present: true, hostname: undefined }`. The
      // route reads this and treats undefined hostname as malformed.
    }
  }
  return {
    workerUrlShape: urlPresent
      ? { present: true, ...(hostname !== undefined ? { hostname } : {}) }
      : { present: false },
    tokenShape: { present: trimmedToken.length > 0 },
  };
}

/**
 * Validate the env shape and throw `CloudflareEnvError` if anything
 * is missing or malformed.
 */
function readEnvOrThrow(): { url: string; token: string } {
  const url = (process.env.CLOUDFLARE_WORKER_URL ?? '').trim();
  const token = (process.env.CLOUDFLARE_WORKER_TOKEN ?? '').trim();
  const shape = getCloudflareEnvShape();
  if (!shape.workerUrlShape.present || !shape.tokenShape.present) {
    throw new CloudflareEnvError(shape);
  }
  if (
    shape.workerUrlShape.present &&
    shape.workerUrlShape.hostname === undefined
  ) {
    throw new CloudflareEnvError(
      shape,
      'CLOUDFLARE_WORKER_URL is not a parseable URL',
    );
  }
  // NOTE: We trim the values above, so trailing whitespace is handled gracefully
  return { url, token };
}

function parseRetryAfter(headerValue: string | null): number {
  if (headerValue === null) return 60;
  const n = Number(headerValue);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 60;
}

async function readBodyExcerpt(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, BODY_EXCERPT_LEN);
  } catch {
    return '';
  }
}

/**
 * Call the Cloudflare Worker, decode the PNG body, run the image
 * pipeline, return an `AISkinResponse`.
 *
 * Single-stage path: pass the user's raw prompt through unchanged.
 * Used when the route is invoked without Stage-1 interpretation (e.g.,
 * when Groq is unavailable or for the legacy `cloudflare`-only flow).
 */
export async function generateSkinFromCloudflare(
  prompt: string,
  signal: AbortSignal,
): Promise<CloudflareCallResult> {
  return callCloudflareWorker(prompt, signal);
}

/**
 * M17 Stage 2: render an `AISkinResponse` from structured per-part
 * descriptions produced by Stage 1 (Groq interpreter).
 *
 * Composes a single rich SDXL prompt that anchors region words
 * ("head", "torso", …) so SDXL aligns body-part details with the
 * corresponding atlas regions. Calls the existing Cloudflare worker
 * (which only accepts `{ prompt }`) — no worker redeploy required.
 */
export async function generateSkinFromParts(
  parts: SkinPartDescriptions,
  signal: AbortSignal,
): Promise<CloudflareCallResult> {
  const composed = composeRenderPrompt(parts);
  return callCloudflareWorker(composed, signal);
}

async function callCloudflareWorker(
  prompt: string,
  signal: AbortSignal,
): Promise<CloudflareCallResult> {
  const { url, token } = readEnvOrThrow();

  const startedAt = Date.now();
  let fetched = false;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'image/png',
      },
      body: JSON.stringify({ prompt }),
      signal,
    });
    fetched = true;
  } catch (err) {
    if (signal.aborted) {
      throw new CloudflareAbortedError(false);
    }
    if (isAbortLikeError(err)) {
      throw new CloudflareAbortedError(false);
    }
    if (isTimeoutLikeError(err, signal)) {
      throw new CloudflareTimeoutError();
    }
    throw new CloudflareUpstreamError(0, formatErr(err));
  }

  if (res.status === 401) {
    void res.body?.cancel();
    throw new CloudflareAuthError();
  }
  if (res.status === 429) {
    void res.body?.cancel();
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
    throw new CloudflareRateLimitError(retryAfter);
  }
  if (res.status < 200 || res.status >= 300) {
    const excerpt = await readBodyExcerpt(res);
    throw new CloudflareUpstreamError(res.status, excerpt);
  }

  let bodyBuf: Buffer;
  try {
    const ab = await res.arrayBuffer();
    bodyBuf = Buffer.from(ab);
  } catch (err) {
    if (signal.aborted) {
      throw new CloudflareAbortedError(true);
    }
    if (isAbortLikeError(err)) {
      throw new CloudflareAbortedError(fetched);
    }
    throw new CloudflareUpstreamError(res.status, formatErr(err));
  }

  const parsed = await generateSkinFromImage(bodyBuf);
  return {
    parsed,
    durationMs: Date.now() - startedAt,
    modelId: CLOUDFLARE_MODEL_ID,
  };
}

function isAbortLikeError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const name = 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'AbortError') return true;
  if (name === 'DOMException') {
    // Some runtimes throw a DOMException with .name='AbortError'; the
    // outer name='DOMException' check is the looser fallback.
    return true;
  }
  return false;
}

function isTimeoutLikeError(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return false;
  if (err === null || typeof err !== 'object') return false;
  const name = 'name' in err ? String((err as { name: unknown }).name) : '';
  const message =
    err instanceof Error ? err.message : String((err as { message?: unknown }).message ?? '');
  return (
    name === 'TimeoutError' || /timeout/i.test(message) || /TIMEOUT/.test(message)
  );
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, BODY_EXCERPT_LEN);
  if (typeof err === 'string') return err.slice(0, BODY_EXCERPT_LEN);
  return 'unknown cloudflare client error';
}
