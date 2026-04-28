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
import { generateSkin as generateGroqAtlas } from './groq';
import { composeRenderPrompt } from './groq-interpreter';
import { MODEL as GROQ_MODEL } from './prompt';
import type { AISkinResponse, SkinPartDescriptions } from './types';

/** Cloudflare model identifier as recorded on /aiGenerations.model. */
export const CLOUDFLARE_MODEL_ID = 'cf/sdxl-lightning';

/**
 * M17 interim model identifier for the Groq-fallback render path.
 * Recorded on /aiGenerations.model so dashboards can distinguish
 * the broken-SDXL-portrait period (`cf/sdxl-lightning`) from the
 * Groq-fallback period (`groq/llama-3.3-70b-via-cf`).
 */
export const CLOUDFLARE_GROQ_FALLBACK_MODEL_ID = `groq/${GROQ_MODEL}-via-cf`;

const BODY_EXCERPT_LEN = 200;

export type CloudflareCallResult = {
  parsed: AISkinResponse;
  durationMs: number;
  modelId:
    | typeof CLOUDFLARE_MODEL_ID
    | typeof CLOUDFLARE_GROQ_FALLBACK_MODEL_ID;
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
 * M17 Stage 3 (interim): render an `AISkinResponse` from structured
 * per-part descriptions produced by Stage 2 (Groq interpreter).
 *
 * BUG WE'RE WORKING AROUND
 * ────────────────────────
 * Cloudflare's SDXL Lightning generates a *picture of a Minecraft
 * character* — a portrait, not a UV-format atlas. When that 512×512
 * portrait is resized to 64×64 and the editor wraps it onto the 3D
 * cube's UV layout, the atlas regions don't line up with body parts:
 * the face ends up on the torso, an arm becomes scenery, etc. The
 * 3D preview shows a broken montage rather than a character.
 *
 * The proper fix per DESIGN §15.5 is per-region SDXL: 4-6 parallel
 * `env.AI.run(SDXL, …)` calls inside the Worker, one per body part,
 * with sharp / Workers AI compositing into a 64×64 atlas. That
 * requires a Worker redeploy — out of scope for this hot-fix because
 * the Worker hardcodes a `character front view` prompt prefix that
 * fights any per-region attempt from the Vercel side.
 *
 * INTERIM FIX
 * ───────────
 * Route Stage 3 through Groq's atlas generator (the M16 path). Groq
 * understands the 64×64 UV layout from its system prompt and emits
 * palette + RLE rows that are atlas-formatted by construction. The
 * `composeRenderPrompt(parts)` output gives Groq a richer brief than
 * the user's raw input, so skins from this path tend to be more
 * detailed than the M16 baseline despite using the same model.
 *
 * Visual quality is Groq-tier (not the SDXL-tier the "High Quality"
 * label promises) but the output is correct — the atlas wraps onto
 * the 3D model as a real character. We track this on
 * /aiGenerations.model = `groq/llama-3.3-70b-via-cf` so dashboards
 * can distinguish this cohort from the legacy broken-SDXL period.
 *
 * To restore real SDXL imagery, see TODO(M18): `workers/ai-skin-generator.js`
 * needs a per-region rendering branch + composite output.
 */
export async function generateSkinFromParts(
  parts: SkinPartDescriptions,
  signal: AbortSignal,
): Promise<CloudflareCallResult> {
  const startedAt = Date.now();
  const composed = composeRenderPrompt(parts);
  console.log(
    '[CF Stage 3] Routing through Groq atlas generator (SDXL portrait → atlas bug interim fix)',
  );
  const result = await generateGroqAtlas(composed, signal);
  return {
    parsed: result.parsed,
    durationMs: Date.now() - startedAt,
    modelId: CLOUDFLARE_GROQ_FALLBACK_MODEL_ID,
  };
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
