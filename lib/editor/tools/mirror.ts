/**
 * lib/editor/tools/mirror.ts
 *
 * M5 mirror LUT. One Uint16Array(4096) per variant mapping each body-part
 * atlas pixel to its X-mirror counterpart. Pattern mirrors
 * lib/three/overlay-map.ts exactly (module-init build + cache + sentinel).
 *
 * Reflection rules (derivation in plan D3 + §Q "least confident"):
 *   - Mirror plane is world X=0. rightArm (x>0) ↔ leftArm (x<0), same for legs
 *     and their overlays. head, body, headOverlay, bodyOverlay self-pair.
 *   - Face-key swap: front↔front, back↔back, top↔top, bottom↔bottom, right↔left.
 *     Rationale: a face's 3D normal direction after reflection — front still
 *     faces +Z, top still faces +Y, but the +X face of rightArm becomes the
 *     -X face of leftArm (= left).
 *   - Face-local X flip ALWAYS: within the face rect, pixel fx maps to
 *     (rect.w - 1 - fx). The face-local Y is preserved.
 *   - Sentinel MIRROR_NO_MAPPING (0xFFFF) for atlas pixels outside any part.
 *
 * Invariant (enforced by tests): mirrorAtlasPixel(mirrorAtlasPixel(p)) === p
 * for every body-part pixel.
 */

import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';
import {
  CLASSIC_UVS,
  SLIM_UVS,
  type PlayerPart,
  type PlayerUVs,
  type SkinVariant,
} from '@/lib/three/geometry';

type FaceKey = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';

const FACE_KEYS: readonly FaceKey[] = ['top', 'bottom', 'right', 'front', 'left', 'back'];

/** Involution: X=0 plane swaps right↔left limbs, keeps head/body. */
const MIRROR_PART_MAP: Record<PlayerPart, PlayerPart> = {
  head: 'head',
  headOverlay: 'headOverlay',
  body: 'body',
  bodyOverlay: 'bodyOverlay',
  rightArm: 'leftArm',
  leftArm: 'rightArm',
  rightArmOverlay: 'leftArmOverlay',
  leftArmOverlay: 'rightArmOverlay',
  rightLeg: 'leftLeg',
  leftLeg: 'rightLeg',
  rightLegOverlay: 'leftLegOverlay',
  leftLegOverlay: 'rightLegOverlay',
};

/** Involution: front/back/top/bottom unchanged, right↔left swap. */
const MIRROR_FACE_MAP: Record<FaceKey, FaceKey> = {
  top: 'top',
  bottom: 'bottom',
  front: 'front',
  back: 'back',
  right: 'left',
  left: 'right',
};

export const MIRROR_NO_MAPPING = 0xffff;

function buildMirrorMap(uvs: PlayerUVs): Uint16Array {
  const map = new Uint16Array(SKIN_ATLAS_SIZE * SKIN_ATLAS_SIZE).fill(MIRROR_NO_MAPPING);

  for (const [part, mirrorPart] of Object.entries(MIRROR_PART_MAP) as [
    PlayerPart,
    PlayerPart,
  ][]) {
    const srcBoxUVs = uvs[part];
    const dstBoxUVs = uvs[mirrorPart];

    for (const face of FACE_KEYS) {
      const mirrorFace = MIRROR_FACE_MAP[face];
      const srcRect = srcBoxUVs[face];
      const dstRect = dstBoxUVs[mirrorFace];

      // Width parity check: slim narrows arm front/back from 4→3. Mirror
      // counterparts are also slim (rightArm ↔ leftArm both shrink) so widths
      // agree. If this ever gets violated — e.g., future asymmetric geometry
      // — the fx flip below would walk off the rect.
      if (srcRect.w !== dstRect.w || srcRect.h !== dstRect.h) {
        // Skip this pairing rather than corrupting the LUT. Tests catch it.
        continue;
      }

      for (let fy = 0; fy < srcRect.h; fy++) {
        for (let fx = 0; fx < srcRect.w; fx++) {
          const srcIdx = (srcRect.y + fy) * SKIN_ATLAS_SIZE + (srcRect.x + fx);
          const mirrorFx = srcRect.w - 1 - fx;
          const dstIdx = (dstRect.y + fy) * SKIN_ATLAS_SIZE + (dstRect.x + mirrorFx);
          map[srcIdx] = dstIdx;
        }
      }
    }
  }

  return map;
}

const CLASSIC_MIRROR_MAP = buildMirrorMap(CLASSIC_UVS);
const SLIM_MIRROR_MAP = buildMirrorMap(SLIM_UVS);

export function getMirrorMap(variant: SkinVariant): Uint16Array {
  return variant === 'classic' ? CLASSIC_MIRROR_MAP : SLIM_MIRROR_MAP;
}

/**
 * Returns the atlas pixel that mirrors (x, y) across the X=0 plane, or null
 * when (x, y) is out of bounds or outside every body-part face rect.
 */
export function mirrorAtlasPixel(
  variant: SkinVariant,
  x: number,
  y: number,
): { x: number; y: number } | null {
  if (x < 0 || x >= SKIN_ATLAS_SIZE || y < 0 || y >= SKIN_ATLAS_SIZE) return null;
  const map = getMirrorMap(variant);
  const dstIdx = map[y * SKIN_ATLAS_SIZE + x];
  if (dstIdx === MIRROR_NO_MAPPING) return null;
  return {
    x: dstIdx % SKIN_ATLAS_SIZE,
    y: Math.floor(dstIdx / SKIN_ATLAS_SIZE),
  };
}
