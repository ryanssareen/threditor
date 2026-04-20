/**
 * Scalar atlas-math helpers shared between the 2D paint surface and the
 * 3D paint surface. Extracted during M5 Unit 0 from duplicated copies in
 * PlayerModel.tsx and paint-bridge.test.ts.
 *
 * Y-flip rationale: atlas is top-down (row 0 is the top), UV is bottom-up
 * (v=0 is the bottom). 3D hits arrive as UV; atlas writes use pixel coords.
 * Per DESIGN §7.
 */

import { SKIN_ATLAS_SIZE } from './constants';

/**
 * Clamp a raw atlas coord to [0, 63]. Guards against rare UV extrapolation
 * at the overlay +1-px geometry edge where `e.uv` may slightly exceed [0, 1].
 */
export function clampAtlas(v: number): number {
  if (v < 0) return 0;
  if (v >= SKIN_ATLAS_SIZE) return SKIN_ATLAS_SIZE - 1;
  return v;
}

/** Convert a UV u-coord into a clamped atlas x (no flip). */
export function uvToAtlasX(u: number): number {
  return clampAtlas(Math.floor(u * SKIN_ATLAS_SIZE));
}

/** Convert a UV v-coord into a clamped atlas y (with Y-flip). */
export function uvToAtlasY(v: number): number {
  return clampAtlas(Math.floor((1 - v) * SKIN_ATLAS_SIZE));
}
