/**
 * M4 Unit 5: atlas pixel → 3D world position.
 *
 * Given a variant + atlas (x, y), find:
 *   - which part's which face contains the pixel (via island-map lookup)
 *   - the texel-center's 3D position in the model's local frame
 *   - the face outward normal
 *
 * This is load-bearing for the 3D hover CursorDecal: it lets the decal snap
 * to a texel center (per plan R4 / UX decision 1) rather than the raw hit
 * point, which would wiggle sub-pixel as the user moves the cursor.
 *
 * Face orientation table derived from three.js BoxGeometry vertex ordering
 * (per lib/three/geometry.ts mapBoxUVs):
 *
 *   Face order:  [+X right, -X left, +Y top, -Y bottom, +Z front, -Z back]
 *   Vertex order per face: upper-left, upper-right, lower-left, lower-right
 *   (as oriented FROM OUTSIDE the box looking IN)
 *
 *   Face        u=0→u=1 direction     v=0→v=1 direction
 *   ----        ------------------    ------------------
 *   right (+X)  +z/2 → -z/2           +y/2 → -y/2
 *   left  (-X)  -z/2 → +z/2           +y/2 → -y/2
 *   top   (+Y)  -x/2 → +x/2           -z/2 → +z/2
 *   bottom(-Y)  -x/2 → +x/2           +z/2 → -z/2
 *   front (+Z)  -x/2 → +x/2           +y/2 → -y/2
 *   back  (-Z)  +x/2 → -x/2           +y/2 → -y/2
 *
 * `uFrac` and `vFrac` are texel-center-normalized face-local coords in [0,1]
 * (computed by the caller as `(atlasX - rect.x + 0.5) / rect.w`).
 *
 * Results are reported as `readonly [number, number, number]` tuples for
 * zero-object-construction in the hot path — CursorDecal can spread into
 * `position={...}` without allocating an {x,y,z} object per call.
 */

import {
  getIslandMap,
  islandIdAt,
} from '@/lib/editor/island-map';
import {
  getUVs,
  partDims,
  partPosition,
  type PlayerPart,
  type SkinVariant,
} from './geometry';

type FaceKey = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';

// Canonical ordering (must mirror lib/editor/island-map.ts).
const PART_ID_ORDER: readonly PlayerPart[] = [
  'head',
  'body',
  'rightArm',
  'leftArm',
  'rightLeg',
  'leftLeg',
  'headOverlay',
  'bodyOverlay',
  'rightArmOverlay',
  'leftArmOverlay',
  'rightLegOverlay',
  'leftLegOverlay',
];

const FACE_ID_ORDER: readonly FaceKey[] = [
  'top',
  'bottom',
  'right',
  'front',
  'left',
  'back',
];

/** Outward unit normal per face, matching the three.js BoxGeometry face axes. */
export function faceNormal(face: FaceKey): readonly [number, number, number] {
  switch (face) {
    case 'right':
      return [1, 0, 0];
    case 'left':
      return [-1, 0, 0];
    case 'top':
      return [0, 1, 0];
    case 'bottom':
      return [0, -1, 0];
    case 'front':
      return [0, 0, 1];
    case 'back':
      return [0, 0, -1];
  }
}

/**
 * Given a face + face-local (u, v) fractions and the box dimensions, return
 * the 3D offset from the box CENTER for that face-point. The returned tuple
 * is in the same local frame as `partPosition` — add them together to get
 * world space.
 */
export function faceLocalOffset(
  face: FaceKey,
  uFrac: number,
  vFrac: number,
  w: number,
  h: number,
  d: number,
): readonly [number, number, number] {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;
  switch (face) {
    case 'right':
      // +X face: u maps +z → -z, v maps +y → -y
      return [hw, hh - vFrac * h, hd - uFrac * d];
    case 'left':
      // -X face: u maps -z → +z, v maps +y → -y
      return [-hw, hh - vFrac * h, -hd + uFrac * d];
    case 'top':
      // +Y face: u maps -x → +x, v maps -z → +z
      return [-hw + uFrac * w, hh, -hd + vFrac * d];
    case 'bottom':
      // -Y face: u maps -x → +x, v maps +z → -z
      return [-hw + uFrac * w, -hh, hd - vFrac * d];
    case 'front':
      // +Z face: u maps -x → +x, v maps +y → -y
      return [-hw + uFrac * w, hh - vFrac * h, hd];
    case 'back':
      // -Z face: u maps +x → -x, v maps +y → -y
      return [hw - uFrac * w, hh - vFrac * h, -hd];
  }
}

export type AtlasWorldHit = {
  position: readonly [number, number, number];
  normal: readonly [number, number, number];
  part: PlayerPart;
  face: FaceKey;
};

/**
 * Resolve an atlas pixel to its texel-center 3D world position + face normal.
 * Returns null if (x, y) is out of bounds or not covered by any part.
 *
 * The atlas→part+face lookup uses the cached island-map (one byte per pixel,
 * O(1) lookup). No allocations per call beyond the single returned object.
 */
export function atlasToWorld(
  variant: SkinVariant,
  x: number,
  y: number,
): AtlasWorldHit | null {
  const islandId = islandIdAt(getIslandMap(variant), x, y);
  if (islandId === 0) return null;

  // Decode islandId (1-72) → partIdx (0-11) × faceIdx (0-5).
  const zeroBased = islandId - 1;
  const partIdx = Math.floor(zeroBased / FACE_ID_ORDER.length);
  const faceIdx = zeroBased % FACE_ID_ORDER.length;
  const part = PART_ID_ORDER[partIdx];
  const face = FACE_ID_ORDER[faceIdx];
  if (part === undefined || face === undefined) return null;

  const uvs = getUVs(variant);
  const rect = uvs[part][face];

  // Texel-center face-local fractions. The +0.5 pixel offset puts the decal
  // at the pixel center, not the top-left corner.
  const uFrac = (x - rect.x + 0.5) / rect.w;
  const vFrac = (y - rect.y + 0.5) / rect.h;

  const [w, h, d] = partDims(variant, part);
  const [cx, cy, cz] = partPosition(variant, part);
  const [lx, ly, lz] = faceLocalOffset(face, uFrac, vFrac, w, h, d);
  const normal = faceNormal(face);

  return {
    position: [cx + lx, cy + ly, cz + lz],
    normal,
    part,
    face,
  };
}
