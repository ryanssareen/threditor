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
import { compositeSkinAtlas } from './cloudflare-composite';
import type { AISkinResponse, SkinPartDescriptions } from './types';

/** Cloudflare model identifier as recorded on /aiGenerations.model. */
export const CLOUDFLARE_MODEL_ID = 'cf/sdxl-lightning';

/**
 * M17 v2 model identifier for the per-region SDXL render path.
 * Recorded on /aiGenerations.model so dashboards distinguish
 * the per-region cohort from the legacy single-call portrait period
 * (`cf/sdxl-lightning`) and the brief Groq-fallback period.
 */
export const CLOUDFLARE_PER_REGION_MODEL_ID = 'cf/sdxl-lightning-x6';

const BODY_EXCERPT_LEN = 200;

export type CloudflareCallResult = {
  parsed: AISkinResponse;
  durationMs: number;
  modelId:
    | typeof CLOUDFLARE_MODEL_ID
    | typeof CLOUDFLARE_PER_REGION_MODEL_ID;
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
 * M17 v2 — per-region SDXL pipeline.
 *
 * Stage 3 of the clarifier → interpreter → renderer pipeline. Takes
 * structured per-part descriptions and produces an atlas-formatted
 * `AISkinResponse` whose UV regions line up with the 3D model.
 *
 * STRATEGY
 * ────────
 * Make 6 parallel Cloudflare SDXL calls — one per body part (head,
 * torso, R/L arm, R/L leg) — each with a focused per-part prompt.
 * Each call returns a 512×512 portrait of *that* body part. Then
 * `compositeSkinAtlas` (sharp on the Vercel side) blits each
 * 512×512 source into all six faces of its corresponding cuboid in
 * a 64×64 transparent canvas, using the canonical Minecraft 1.8+
 * UV layout from `cloudflare-atlas.ts`. The composited atlas is
 * then quantized + RLE-encoded by the existing `generateSkinFromImage`
 * pipeline so the final response shape is identical to every other
 * provider.
 *
 * This replaces the broken single-call SDXL portrait approach (which
 * produced a picture of a character that, when wrapped on the cube,
 * looked like a montage of misaligned face/body fragments) and the
 * brief Groq-fallback workaround.
 *
 * COSTS
 * ─────
 * Each SDXL Lightning call is ~1500 Neurons; 6 parallel calls
 * ≈ 9000 Neurons per generation, well inside Cloudflare's free-tier
 * envelope. The 6 calls run in parallel so wallclock is ~same as
 * one call (~3-4s).
 *
 * QUIRKS
 * ──────
 * The deployed Worker prepends a fixed prefix
 * (`pixel art, 64x64 minecraft skin texture, character front view, …`)
 * to every prompt. Per-region prompts therefore arrive at SDXL with
 * a slight contradiction (`character front view, head only`), which
 * SDXL handles by emphasizing the head. Output quality is acceptable;
 * a future Worker change to skip the prefix when given a `region`
 * flag would help further.
 */
export async function generateSkinFromParts(
  parts: SkinPartDescriptions,
  signal: AbortSignal,
): Promise<CloudflareCallResult> {
  const startedAt = Date.now();
  const partPrompts = buildPartPrompts(parts);

  console.log('[CF Stage 3] Per-region SDXL: 6 parallel Worker calls');

  // Parallel fan-out. `Promise.all` rejects on the first failure,
  // which is what we want — if any part fails the whole skin is
  // unusable. Errors are typed (CloudflareXxxError) so the route's
  // existing catch cascade maps them correctly.
  const [
    headBuf,
    torsoBuf,
    rightArmBuf,
    leftArmBuf,
    rightLegBuf,
    leftLegBuf,
  ] = await Promise.all([
    fetchPartImage(partPrompts.head, signal),
    fetchPartImage(partPrompts.torso, signal),
    fetchPartImage(partPrompts.rightArm, signal),
    fetchPartImage(partPrompts.leftArm, signal),
    fetchPartImage(partPrompts.rightLeg, signal),
    fetchPartImage(partPrompts.leftLeg, signal),
  ]);

  console.log('[CF Stage 3] All 6 parts received, compositing atlas');

  // Composite all 6 part images into a 64×64 RGBA atlas with proper
  // UV layout. Throws ImageProcessingError on sharp failure.
  const atlasBuf = await compositeSkinAtlas({
    head: headBuf,
    torso: torsoBuf,
    rightArm: rightArmBuf,
    leftArm: leftArmBuf,
    rightLeg: rightLegBuf,
    leftLeg: leftLegBuf,
    variant: parts.variant,
  });

  // Run the existing quantize + RLE pipeline. The atlas is already
  // 64×64 so the resize step is a pass-through, but we keep the call
  // so the response shape is identical to every other provider and
  // any future format tweaks land in one place.
  const parsed = await generateSkinFromImage(atlasBuf);

  return {
    parsed,
    durationMs: Date.now() - startedAt,
    modelId: CLOUDFLARE_PER_REGION_MODEL_ID,
  };
}

/**
 * Build one focused SDXL prompt per body part. The deployed Worker
 * prepends its own `pixel art, 64x64 minecraft skin texture, …`
 * prefix, so we DON'T re-include those tokens; we focus on the
 * specific body part and its description.
 *
 * `single isolated <part> on plain background` is the key phrase
 * that gets SDXL to emit a centered portrait of just one body part
 * rather than a full character. The trailing `no body, no other
 * limb` is a soft negative that further suppresses the Worker
 * prefix's `character front view` push.
 */
function buildPartPrompts(parts: SkinPartDescriptions): {
  head: string;
  torso: string;
  rightArm: string;
  leftArm: string;
  rightLeg: string;
  leftLeg: string;
} {
  const variantTag =
    parts.variant === 'slim' ? 'slim 3-pixel arms' : 'classic 4-pixel arms';

  const head = appendOverlay(parts.head, parts.headOverlay);
  const torso = appendOverlay(parts.torso, parts.torsoOverlay);

  return {
    head: `single isolated minecraft head, ${head}, ${variantTag}, plain background, no body, no limbs, centered, front-facing`,
    torso: `single isolated minecraft torso, ${torso}, ${variantTag}, plain background, no head, no limbs, centered, front-facing`,
    rightArm: `single isolated minecraft right arm, ${parts.rightArm}, ${variantTag}, plain background, no body, no head, no other limb, centered, vertical`,
    leftArm: `single isolated minecraft left arm, ${parts.leftArm}, ${variantTag}, plain background, no body, no head, no other limb, centered, vertical`,
    rightLeg: `single isolated minecraft right leg, ${parts.rightLeg}, plain background, no body, no head, no arms, no other leg, centered, vertical`,
    leftLeg: `single isolated minecraft left leg, ${parts.leftLeg}, plain background, no body, no head, no arms, no other leg, centered, vertical`,
  };
}

function appendOverlay(base: string, overlay: string | undefined): string {
  if (overlay === undefined || overlay.trim().length === 0) return base;
  return `${base}, with ${overlay.trim()}`;
}

/**
 * Fetch a single part image from the Cloudflare Worker. Same
 * transport contract as `callCloudflareWorker` (legacy single-call
 * path) — duplicated rather than refactored because the per-region
 * path needs the raw PNG buffer (no `generateSkinFromImage` call
 * yet — that runs once on the composited atlas).
 */
async function fetchPartImage(
  prompt: string,
  signal: AbortSignal,
): Promise<Buffer> {
  const { url, token } = readEnvOrThrow();

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
    if (signal.aborted) throw new CloudflareAbortedError(false);
    if (isAbortLikeError(err)) throw new CloudflareAbortedError(false);
    if (isTimeoutLikeError(err, signal)) throw new CloudflareTimeoutError();
    throw new CloudflareUpstreamError(0, formatErr(err));
  }

  if (res.status === 401) {
    void res.body?.cancel();
    throw new CloudflareAuthError();
  }
  if (res.status === 429) {
    void res.body?.cancel();
    throw new CloudflareRateLimitError(parseRetryAfter(res.headers.get('retry-after')));
  }
  if (res.status < 200 || res.status >= 300) {
    throw new CloudflareUpstreamError(res.status, await readBodyExcerpt(res));
  }

  try {
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch (err) {
    if (signal.aborted) throw new CloudflareAbortedError(true);
    if (isAbortLikeError(err)) throw new CloudflareAbortedError(fetched);
    throw new CloudflareUpstreamError(res.status, formatErr(err));
  }
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
