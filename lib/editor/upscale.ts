/**
 * M15 Unit 1: nearest-neighbor canvas upscaler.
 *
 * Used by the export pipeline to produce HD PNGs (128 / 256 / 512)
 * from the editor's 64×64 composite canvas. Deliberately pure — no
 * React, no three.js, no zustand — so the export path can call it
 * directly and tests can assert pixel-perfect behaviour.
 *
 * Implementation uses a typed-array loop rather than
 * `ctx.drawImage(src, 0, 0, tw, th)` with `imageSmoothingEnabled =
 * false`. The drawImage path is faster in production, but the
 * smoothing flag has historically been unreliable across browsers
 * (Safari and some mobile Chromium forks have silently smoothed even
 * with the flag false), and some ad-blocker / privacy extensions
 * still force smoothing. A manual nearest-neighbor blit is
 * deterministic, trivial at the sizes we support (<1 ms at 512×512),
 * and sidesteps the browser-override risk documented in
 * docs/solutions/m15-hd-skins-plan.md §Risks.
 *
 * M8 invariant preserved: a fully-transparent source pixel (alpha=0,
 * RGB=0) upscales to a block of fully-transparent destination pixels
 * with alpha=0 AND RGB=0 — the Minecraft-safe pre-image survives.
 */

/**
 * Resolutions supported by the HD export path. 64 is the pass-through
 * (Minecraft vanilla) case; the others are HD variants for modded
 * servers / resource packs.
 */
export type SupportedResolution = 64 | 128 | 256 | 512;

/**
 * Produce a fresh canvas at `targetSize × targetSize` containing a
 * nearest-neighbor-scaled copy of `source`.
 *
 * Returns a brand-new canvas even when `targetSize` matches the source
 * dimensions. Callers can safely mutate or `toBlob` the result without
 * disturbing `source`.
 *
 * Throws if a 2D context cannot be obtained from the constructed
 * canvas (very low-memory devices; jsdom environments that stub
 * `getContext` to return null).
 */
export function upscaleCanvasNearestNeighbor(
  source: HTMLCanvasElement,
  targetSize: SupportedResolution,
): HTMLCanvasElement {
  const sourceWidth = source.width;
  const sourceHeight = source.height;

  const target = document.createElement('canvas');
  target.width = targetSize;
  target.height = targetSize;
  const targetCtx = target.getContext('2d', {
    colorSpace: 'srgb',
    willReadFrequently: true,
  });
  if (targetCtx === null) {
    throw new Error('upscale: failed to obtain 2D context on target canvas');
  }
  targetCtx.imageSmoothingEnabled = false;

  const sourceCtx = source.getContext('2d', {
    colorSpace: 'srgb',
    willReadFrequently: true,
  });
  if (sourceCtx === null) {
    throw new Error('upscale: failed to obtain 2D context on source canvas');
  }

  const sourceData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight);
  const src = sourceData.data;

  const out = new Uint8ClampedArray(targetSize * targetSize * 4);

  // Integer scale in the common cases (64→128 = 2×, 64→256 = 4×,
  // 64→512 = 8×). Non-integer ratios are still handled correctly by
  // the floor(y * sourceHeight / targetSize) math below — we don't
  // take the integer-only fast path because the generic path is
  // already well under 1 ms at 512×512.
  for (let y = 0; y < targetSize; y++) {
    const srcY = Math.floor((y * sourceHeight) / targetSize);
    const srcRowOffset = srcY * sourceWidth * 4;
    const outRowOffset = y * targetSize * 4;
    for (let x = 0; x < targetSize; x++) {
      const srcX = Math.floor((x * sourceWidth) / targetSize);
      const srcIdx = srcRowOffset + srcX * 4;
      const outIdx = outRowOffset + x * 4;
      out[outIdx] = src[srcIdx];
      out[outIdx + 1] = src[srcIdx + 1];
      out[outIdx + 2] = src[srcIdx + 2];
      out[outIdx + 3] = src[srcIdx + 3];
    }
  }

  targetCtx.putImageData(new ImageData(out, targetSize, targetSize), 0, 0);
  return target;
}
