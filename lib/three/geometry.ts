/**
 * M2: Minecraft player-model UV constants and BoxGeometry UV-attribute helper.
 *
 * UV regions are {x, y, w, h} in top-left-origin pixel space on the 64x64 atlas.
 * `mapBoxUVs` converts to three.js UV space (u=x/64, v=1-y/64) per-corner and
 * mutates BoxGeometry.attributes.uv in place.
 *
 * Classic values are from Minecraft Wiki "Skin" (Java 1.8+ 64x64 layout).
 * Slim values are derived from skinview3d's setSkinUVs(box, u, v, w, h, d) helper
 * at bs-community/skinview3d/master/src/model.ts — contiguous-start packing
 * convention, verified face-by-face 2026-04-18 during /ce:work.
 *
 * INVARIANT: these constants are consumed by M3 (raycast → pixel), M4 (paint),
 * M5 (bucket-fill island map), M7 (thumbnail renderer), M11 (OG image). Changing
 * any value requires re-verifying every downstream milestone.
 */

import type { BufferGeometry } from 'three';

import { SKIN_ATLAS_SIZE } from './constants';

export type SkinVariant = 'classic' | 'slim';

export type UVRect = { x: number; y: number; w: number; h: number };

export type BoxUVs = {
  top: UVRect;
  bottom: UVRect;
  right: UVRect;
  front: UVRect;
  left: UVRect;
  back: UVRect;
};

export type PlayerPart =
  | 'head'
  | 'headOverlay'
  | 'body'
  | 'bodyOverlay'
  | 'rightArm'
  | 'rightArmOverlay'
  | 'leftArm'
  | 'leftArmOverlay'
  | 'rightLeg'
  | 'rightLegOverlay'
  | 'leftLeg'
  | 'leftLegOverlay';

export type PlayerUVs = Record<PlayerPart, BoxUVs>;

// World-space dimensions per part: [width, height, depth] in world units.
// 1 skin pixel = 0.0625 world units (derived: head 8px = 0.5 world units per DESIGN.md §6).
export type BoxDims = readonly [number, number, number];

// -----------------------------------------------------------------------------
// Classic variant (4 px arms)
// -----------------------------------------------------------------------------

export const CLASSIC_UVS: PlayerUVs = {
  head: {
    top: { x: 8, y: 0, w: 8, h: 8 },
    bottom: { x: 16, y: 0, w: 8, h: 8 },
    right: { x: 0, y: 8, w: 8, h: 8 },
    front: { x: 8, y: 8, w: 8, h: 8 },
    left: { x: 16, y: 8, w: 8, h: 8 },
    back: { x: 24, y: 8, w: 8, h: 8 },
  },
  headOverlay: {
    top: { x: 40, y: 0, w: 8, h: 8 },
    bottom: { x: 48, y: 0, w: 8, h: 8 },
    right: { x: 32, y: 8, w: 8, h: 8 },
    front: { x: 40, y: 8, w: 8, h: 8 },
    left: { x: 48, y: 8, w: 8, h: 8 },
    back: { x: 56, y: 8, w: 8, h: 8 },
  },
  body: {
    top: { x: 20, y: 16, w: 8, h: 4 },
    bottom: { x: 28, y: 16, w: 8, h: 4 },
    right: { x: 16, y: 20, w: 4, h: 12 },
    front: { x: 20, y: 20, w: 8, h: 12 },
    left: { x: 28, y: 20, w: 4, h: 12 },
    back: { x: 32, y: 20, w: 8, h: 12 },
  },
  bodyOverlay: {
    top: { x: 20, y: 32, w: 8, h: 4 },
    bottom: { x: 28, y: 32, w: 8, h: 4 },
    right: { x: 16, y: 36, w: 4, h: 12 },
    front: { x: 20, y: 36, w: 8, h: 12 },
    left: { x: 28, y: 36, w: 4, h: 12 },
    back: { x: 32, y: 36, w: 8, h: 12 },
  },
  rightArm: {
    top: { x: 44, y: 16, w: 4, h: 4 },
    bottom: { x: 48, y: 16, w: 4, h: 4 },
    right: { x: 40, y: 20, w: 4, h: 12 },
    front: { x: 44, y: 20, w: 4, h: 12 },
    left: { x: 48, y: 20, w: 4, h: 12 },
    back: { x: 52, y: 20, w: 4, h: 12 },
  },
  rightArmOverlay: {
    top: { x: 44, y: 32, w: 4, h: 4 },
    bottom: { x: 48, y: 32, w: 4, h: 4 },
    right: { x: 40, y: 36, w: 4, h: 12 },
    front: { x: 44, y: 36, w: 4, h: 12 },
    left: { x: 48, y: 36, w: 4, h: 12 },
    back: { x: 52, y: 36, w: 4, h: 12 },
  },
  leftArm: {
    top: { x: 36, y: 48, w: 4, h: 4 },
    bottom: { x: 40, y: 48, w: 4, h: 4 },
    right: { x: 32, y: 52, w: 4, h: 12 },
    front: { x: 36, y: 52, w: 4, h: 12 },
    left: { x: 40, y: 52, w: 4, h: 12 },
    back: { x: 44, y: 52, w: 4, h: 12 },
  },
  leftArmOverlay: {
    top: { x: 52, y: 48, w: 4, h: 4 },
    bottom: { x: 56, y: 48, w: 4, h: 4 },
    right: { x: 48, y: 52, w: 4, h: 12 },
    front: { x: 52, y: 52, w: 4, h: 12 },
    left: { x: 56, y: 52, w: 4, h: 12 },
    back: { x: 60, y: 52, w: 4, h: 12 },
  },
  rightLeg: {
    top: { x: 4, y: 16, w: 4, h: 4 },
    bottom: { x: 8, y: 16, w: 4, h: 4 },
    right: { x: 0, y: 20, w: 4, h: 12 },
    front: { x: 4, y: 20, w: 4, h: 12 },
    left: { x: 8, y: 20, w: 4, h: 12 },
    back: { x: 12, y: 20, w: 4, h: 12 },
  },
  rightLegOverlay: {
    top: { x: 4, y: 32, w: 4, h: 4 },
    bottom: { x: 8, y: 32, w: 4, h: 4 },
    right: { x: 0, y: 36, w: 4, h: 12 },
    front: { x: 4, y: 36, w: 4, h: 12 },
    left: { x: 8, y: 36, w: 4, h: 12 },
    back: { x: 12, y: 36, w: 4, h: 12 },
  },
  leftLeg: {
    top: { x: 20, y: 48, w: 4, h: 4 },
    bottom: { x: 24, y: 48, w: 4, h: 4 },
    right: { x: 16, y: 52, w: 4, h: 12 },
    front: { x: 20, y: 52, w: 4, h: 12 },
    left: { x: 24, y: 52, w: 4, h: 12 },
    back: { x: 28, y: 52, w: 4, h: 12 },
  },
  leftLegOverlay: {
    top: { x: 4, y: 48, w: 4, h: 4 },
    bottom: { x: 8, y: 48, w: 4, h: 4 },
    right: { x: 0, y: 52, w: 4, h: 12 },
    front: { x: 4, y: 52, w: 4, h: 12 },
    left: { x: 8, y: 52, w: 4, h: 12 },
    back: { x: 12, y: 52, w: 4, h: 12 },
  },
};

// -----------------------------------------------------------------------------
// Slim variant (3 px arms): only the four arm entries differ from Classic.
// Verified against skinview3d setSkinUVs(rightArmBox, 40, 16, 3, 12, 4) and
// setSkinUVs(leftArmBox, 32, 48, 3, 12, 4) — contiguous-start convention.
// -----------------------------------------------------------------------------

export const SLIM_UVS: PlayerUVs = {
  ...CLASSIC_UVS,
  rightArm: {
    top: { x: 44, y: 16, w: 3, h: 4 },
    bottom: { x: 47, y: 16, w: 3, h: 4 },
    right: { x: 40, y: 20, w: 4, h: 12 },
    front: { x: 44, y: 20, w: 3, h: 12 },
    left: { x: 47, y: 20, w: 4, h: 12 },
    back: { x: 51, y: 20, w: 3, h: 12 },
  },
  rightArmOverlay: {
    top: { x: 44, y: 32, w: 3, h: 4 },
    bottom: { x: 47, y: 32, w: 3, h: 4 },
    right: { x: 40, y: 36, w: 4, h: 12 },
    front: { x: 44, y: 36, w: 3, h: 12 },
    left: { x: 47, y: 36, w: 4, h: 12 },
    back: { x: 51, y: 36, w: 3, h: 12 },
  },
  leftArm: {
    top: { x: 36, y: 48, w: 3, h: 4 },
    bottom: { x: 39, y: 48, w: 3, h: 4 },
    right: { x: 32, y: 52, w: 4, h: 12 },
    front: { x: 36, y: 52, w: 3, h: 12 },
    left: { x: 39, y: 52, w: 4, h: 12 },
    back: { x: 43, y: 52, w: 3, h: 12 },
  },
  leftArmOverlay: {
    top: { x: 52, y: 48, w: 3, h: 4 },
    bottom: { x: 55, y: 48, w: 3, h: 4 },
    right: { x: 48, y: 52, w: 4, h: 12 },
    front: { x: 52, y: 52, w: 3, h: 12 },
    left: { x: 55, y: 52, w: 4, h: 12 },
    back: { x: 59, y: 52, w: 3, h: 12 },
  },
};

// -----------------------------------------------------------------------------
// World-space box dimensions per part (W × H × D). 1 skin px = 0.0625 world.
// -----------------------------------------------------------------------------

const SKIN_PX_TO_WORLD = 0.0625;

const PART_PIXEL_DIMS: Record<SkinVariant, Record<PlayerPart, readonly [number, number, number]>> = {
  classic: {
    head: [8, 8, 8],
    headOverlay: [9, 9, 9],
    body: [8, 12, 4],
    bodyOverlay: [9, 13, 5],
    rightArm: [4, 12, 4],
    rightArmOverlay: [5, 13, 5],
    leftArm: [4, 12, 4],
    leftArmOverlay: [5, 13, 5],
    rightLeg: [4, 12, 4],
    rightLegOverlay: [5, 13, 5],
    leftLeg: [4, 12, 4],
    leftLegOverlay: [5, 13, 5],
  },
  slim: {
    head: [8, 8, 8],
    headOverlay: [9, 9, 9],
    body: [8, 12, 4],
    bodyOverlay: [9, 13, 5],
    rightArm: [3, 12, 4],
    rightArmOverlay: [4, 13, 5],
    leftArm: [3, 12, 4],
    leftArmOverlay: [4, 13, 5],
    rightLeg: [4, 12, 4],
    rightLegOverlay: [5, 13, 5],
    leftLeg: [4, 12, 4],
    leftLegOverlay: [5, 13, 5],
  },
};

export function partDims(variant: SkinVariant, part: PlayerPart): BoxDims {
  const [pw, ph, pd] = PART_PIXEL_DIMS[variant][part];
  return [pw * SKIN_PX_TO_WORLD, ph * SKIN_PX_TO_WORLD, pd * SKIN_PX_TO_WORLD];
}

// -----------------------------------------------------------------------------
// World-space positions per part. Humanoid T-pose with arms-down rest.
// -----------------------------------------------------------------------------

/**
 * Center position of each body part.
 * Derived from DESIGN.md §6 pose (head at y=1.4 with 0.5³ box):
 *   Body center: y = head_base - head_half - body_half = 1.4 - 0.25 - 0.375 = 0.775
 *   Arm center Y: matches body center (shoulder-to-elbow-to-wrist vertical)
 *   Leg center Y: y = body_base - leg_half = 0.4 - 0.375 = 0.025 (legs hang below body)
 *   Arm center X: body_half_width + arm_half_width = 0.25 + (variant-dep)
 *     classic: 0.25 + 0.125 = 0.375
 *     slim:    0.25 + 0.09375 = 0.34375
 *   Leg center X: half of hip-width (legs touch at inner edges beneath body)
 *     = leg_half_width = 0.125
 */
export function partPosition(
  variant: SkinVariant,
  part: PlayerPart,
): readonly [number, number, number] {
  const armX = variant === 'classic' ? 0.375 : 0.34375;
  switch (part) {
    case 'head':
    case 'headOverlay':
      return [0, 1.4, 0];
    case 'body':
    case 'bodyOverlay':
      return [0, 0.775, 0];
    case 'rightArm':
    case 'rightArmOverlay':
      return [-armX, 0.775, 0];
    case 'leftArm':
    case 'leftArmOverlay':
      return [armX, 0.775, 0];
    case 'rightLeg':
    case 'rightLegOverlay':
      return [-0.125, 0.025, 0];
    case 'leftLeg':
    case 'leftLegOverlay':
      return [0.125, 0.025, 0];
  }
}

// -----------------------------------------------------------------------------
// mapBoxUVs: mutates a three.js BoxGeometry's uv attribute to paint each face
// from the specified atlas region. three.js BoxGeometry face order is
// [+X right, -X left, +Y top, -Y bottom, +Z front, -Z back]; per-face vertex
// order is upper-left, upper-right, lower-left, lower-right.
// -----------------------------------------------------------------------------

function uvCornersForFace(
  uv: Float32Array,
  faceIndex: number,
  rect: UVRect,
  atlasSize: number,
): void {
  const u0 = rect.x / atlasSize;
  const u1 = (rect.x + rect.w) / atlasSize;
  const vTop = 1 - rect.y / atlasSize;
  const vBottom = 1 - (rect.y + rect.h) / atlasSize;

  const base = faceIndex * 8; // 4 vertices × 2 components per face

  // upper-left
  uv[base + 0] = u0;
  uv[base + 1] = vTop;
  // upper-right
  uv[base + 2] = u1;
  uv[base + 3] = vTop;
  // lower-left
  uv[base + 4] = u0;
  uv[base + 5] = vBottom;
  // lower-right
  uv[base + 6] = u1;
  uv[base + 7] = vBottom;
}

export function mapBoxUVs(
  geometry: BufferGeometry,
  uvs: BoxUVs,
  atlasSize: number = SKIN_ATLAS_SIZE,
): void {
  const attr = geometry.attributes.uv;
  if (!attr) throw new Error('mapBoxUVs: geometry has no uv attribute');
  const arr = attr.array as Float32Array;
  // three.js BoxGeometry face order:
  // 0: +X (right), 1: -X (left), 2: +Y (top), 3: -Y (bottom), 4: +Z (front), 5: -Z (back)
  uvCornersForFace(arr, 0, uvs.right, atlasSize);
  uvCornersForFace(arr, 1, uvs.left, atlasSize);
  uvCornersForFace(arr, 2, uvs.top, atlasSize);
  uvCornersForFace(arr, 3, uvs.bottom, atlasSize);
  uvCornersForFace(arr, 4, uvs.front, atlasSize);
  uvCornersForFace(arr, 5, uvs.back, atlasSize);
  attr.needsUpdate = true;
}

export function getUVs(variant: SkinVariant): PlayerUVs {
  return variant === 'classic' ? CLASSIC_UVS : SLIM_UVS;
}
