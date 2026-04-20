/**
 * M4: Overlay→base atlas pixel LUT.
 *
 * Maps every overlay atlas pixel index to its corresponding base atlas pixel
 * index using the UV rect data from geometry.ts. Load-bearing for M4's
 * overlay/base precedence logic (R6).
 *
 * One Uint16Array(4096) per variant is built once at module init and cached.
 * Unused slots hold OVERLAY_NO_MAPPING (0xFFFF).
 *
 * Pixel counts (non-sentinel entries):
 *   classic: 1632  (headOverlay 384 + bodyOverlay 352 + rightArmOverlay 224
 *                   + leftArmOverlay 224 + rightLegOverlay 224 + leftLegOverlay 224)
 *   slim:    1568  (same, but rightArmOverlay 192 + leftArmOverlay 192;
 *                   slim narrows front/back/top/bottom from w=4 to w=3 per arm)
 *   delta:     64  (32 px per arm overlay × 2 arms)
 *
 * INVARIANT: overlay and base face rects have identical dimensions because
 * overlay geometry is +1 px on each axis but UVs are drawn at the original
 * base dimensions per M2 COMPOUND §invariant 104. This makes a 1-to-1
 * face-local offset mapping valid.
 */

import { OVERLAY_ALPHA_THRESHOLD, SKIN_ATLAS_SIZE } from '@/lib/three/constants';
import {
  CLASSIC_UVS,
  SLIM_UVS,
  type PlayerPart,
  type PlayerUVs,
  type SkinVariant,
} from '@/lib/three/geometry';

type FaceKey = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';

const FACE_KEYS: readonly FaceKey[] = ['top', 'bottom', 'right', 'front', 'left', 'back'];

/**
 * Maps each overlay part to its corresponding base part.
 * Base parts map to null (they have no overlay counterpart to look up from).
 * Record<PlayerPart, ...> enforces exhaustiveness at compile time.
 */
const OVERLAY_TO_BASE_PART: Record<PlayerPart, PlayerPart | null> = {
  head: null,
  body: null,
  rightArm: null,
  leftArm: null,
  rightLeg: null,
  leftLeg: null,
  headOverlay: 'head',
  bodyOverlay: 'body',
  rightArmOverlay: 'rightArm',
  leftArmOverlay: 'leftArm',
  rightLegOverlay: 'rightLeg',
  leftLegOverlay: 'leftLeg',
};

/** Sentinel value stored in the LUT for atlas pixels with no overlay mapping. */
export const OVERLAY_NO_MAPPING = 0xffff;

function buildOverlayMap(uvs: PlayerUVs): Uint16Array {
  const map = new Uint16Array(SKIN_ATLAS_SIZE * SKIN_ATLAS_SIZE).fill(OVERLAY_NO_MAPPING);

  for (const [overlayPart, basePart] of Object.entries(OVERLAY_TO_BASE_PART) as [
    PlayerPart,
    PlayerPart | null,
  ][]) {
    if (basePart === null) continue;

    const overlayBoxUVs = uvs[overlayPart];
    const baseBoxUVs = uvs[basePart];

    for (const face of FACE_KEYS) {
      const overlayRect = overlayBoxUVs[face];
      const baseRect = baseBoxUVs[face];

      const { w, h } = overlayRect;

      for (let localY = 0; localY < h; localY++) {
        for (let localX = 0; localX < w; localX++) {
          const overlayIdx = (overlayRect.y + localY) * SKIN_ATLAS_SIZE + (overlayRect.x + localX);
          const baseIdx = (baseRect.y + localY) * SKIN_ATLAS_SIZE + (baseRect.x + localX);
          map[overlayIdx] = baseIdx;
        }
      }
    }
  }

  return map;
}

const CLASSIC_OVERLAY_MAP = buildOverlayMap(CLASSIC_UVS);
const SLIM_OVERLAY_MAP = buildOverlayMap(SLIM_UVS);

/**
 * Returns the cached overlay→base LUT for the given variant.
 * The returned Uint16Array is module-scoped and must not be mutated by callers.
 */
export function getOverlayToBaseMap(variant: SkinVariant): Uint16Array {
  return variant === 'classic' ? CLASSIC_OVERLAY_MAP : SLIM_OVERLAY_MAP;
}

/**
 * Given an overlay atlas pixel (x, y), returns the corresponding base atlas
 * pixel coordinates, or null if:
 *   - (x, y) is out of bounds [0, 63]
 *   - the pixel is not part of any overlay face rect
 *
 * The returned object's coordinates are in the same top-left-origin pixel
 * space as the input (matching UVRect x/y convention in geometry.ts).
 */
export function overlayToBase(
  variant: SkinVariant,
  x: number,
  y: number,
): { x: number; y: number } | null {
  if (x < 0 || x >= SKIN_ATLAS_SIZE || y < 0 || y >= SKIN_ATLAS_SIZE) return null;

  const map = getOverlayToBaseMap(variant);
  const baseIdx = map[y * SKIN_ATLAS_SIZE + x];

  if (baseIdx === OVERLAY_NO_MAPPING) return null;

  return {
    x: baseIdx % SKIN_ATLAS_SIZE,
    y: Math.floor(baseIdx / SKIN_ATLAS_SIZE),
  };
}

/**
 * Resolve a raw (atlas-pixel) hit plus mesh-isOverlay flag into the final
 * paint target using M4's overlay/base precedence rule:
 *
 *   - If the hit mesh is a base mesh → {rawX, rawY, target: 'base'}.
 *   - If the hit mesh is an overlay mesh AND the layer pixel's alpha is
 *     ≥ OVERLAY_ALPHA_THRESHOLD → {rawX, rawY, target: 'overlay'}.
 *   - Otherwise (overlay mesh + transparent pixel) → redirect to the base
 *     atlas pixel via the LUT; target: 'base'.
 *   - If the overlay pixel has no LUT entry (shouldn't happen for a valid
 *     overlay-mesh hit) → fall back to {rawX, rawY, target: 'overlay'}.
 *
 * Extracted during M5 Unit 0 so PlayerModel.tsx and paint-bridge tests share
 * a single source of truth. Reads one byte per overlay resolution; returns
 * a fresh object per call (caller is expected to allocate one per event).
 */
export function resolveOverlayHit(
  variant: SkinVariant,
  pixels: Uint8ClampedArray,
  rawX: number,
  rawY: number,
  isOverlay: boolean,
): { x: number; y: number; target: 'base' | 'overlay' } {
  if (!isOverlay) {
    return { x: rawX, y: rawY, target: 'base' };
  }
  const alphaIdx = (rawY * SKIN_ATLAS_SIZE + rawX) * 4 + 3;
  const alpha = pixels[alphaIdx];
  if (alpha >= OVERLAY_ALPHA_THRESHOLD) {
    return { x: rawX, y: rawY, target: 'overlay' };
  }
  const base = overlayToBase(variant, rawX, rawY);
  if (base === null) {
    return { x: rawX, y: rawY, target: 'overlay' };
  }
  return { x: base.x, y: base.y, target: 'base' };
}
