/**
 * M17 v2: Minecraft 1.8+ skin atlas UV region table.
 *
 * Pure data module — no `'server-only'`, no SDK imports. Defines
 * exactly where each face of each body part lives inside the 64×64
 * atlas, so the compositor can blit a per-part SDXL render into the
 * correct rectangle.
 *
 * Coordinates are top-left origin: `{ x, y, w, h }` where (x, y) is
 * the top-left pixel of the rectangle and (w, h) are width/height.
 *
 * Reference: https://minecraft.wiki/w/Skin#Skin_layout (1.8+)
 */

export type AtlasRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PartFaces = {
  top: AtlasRegion;
  bottom: AtlasRegion;
  right: AtlasRegion;
  front: AtlasRegion;
  left: AtlasRegion;
  back: AtlasRegion;
};

export const FACE_KEYS = ['top', 'bottom', 'right', 'front', 'left', 'back'] as const;
export type FaceKey = (typeof FACE_KEYS)[number];

/** Head: 8×8×8 cube. Six 8×8 faces in the top-left 32×16 region. */
export const HEAD_FACES: PartFaces = {
  top: { x: 8, y: 0, w: 8, h: 8 },
  bottom: { x: 16, y: 0, w: 8, h: 8 },
  right: { x: 0, y: 8, w: 8, h: 8 },
  front: { x: 8, y: 8, w: 8, h: 8 },
  left: { x: 16, y: 8, w: 8, h: 8 },
  back: { x: 24, y: 8, w: 8, h: 8 },
};

/** Body / torso: 8×4×12 cuboid. */
export const BODY_FACES: PartFaces = {
  top: { x: 20, y: 16, w: 8, h: 4 },
  bottom: { x: 28, y: 16, w: 8, h: 4 },
  right: { x: 16, y: 20, w: 4, h: 12 },
  front: { x: 20, y: 20, w: 8, h: 12 },
  left: { x: 28, y: 20, w: 4, h: 12 },
  back: { x: 32, y: 20, w: 8, h: 12 },
};

/** Right arm — classic 4×4×12 cuboid. */
export const RIGHT_ARM_FACES_CLASSIC: PartFaces = {
  top: { x: 44, y: 16, w: 4, h: 4 },
  bottom: { x: 48, y: 16, w: 4, h: 4 },
  right: { x: 40, y: 20, w: 4, h: 12 },
  front: { x: 44, y: 20, w: 4, h: 12 },
  left: { x: 48, y: 20, w: 4, h: 12 },
  back: { x: 52, y: 20, w: 4, h: 12 },
};

/**
 * Right arm — slim 3×4×12 cuboid (Alex variant). Top/bottom are
 * 3 wide; back face shifts to col 51 to leave a 1-px gutter that
 * Minecraft expects.
 */
export const RIGHT_ARM_FACES_SLIM: PartFaces = {
  top: { x: 44, y: 16, w: 3, h: 4 },
  bottom: { x: 47, y: 16, w: 3, h: 4 },
  right: { x: 40, y: 20, w: 4, h: 12 },
  front: { x: 44, y: 20, w: 3, h: 12 },
  left: { x: 47, y: 20, w: 4, h: 12 },
  back: { x: 51, y: 20, w: 3, h: 12 },
};

/** Right leg: 4×4×12 cuboid. */
export const RIGHT_LEG_FACES: PartFaces = {
  top: { x: 4, y: 16, w: 4, h: 4 },
  bottom: { x: 8, y: 16, w: 4, h: 4 },
  right: { x: 0, y: 20, w: 4, h: 12 },
  front: { x: 4, y: 20, w: 4, h: 12 },
  left: { x: 8, y: 20, w: 4, h: 12 },
  back: { x: 12, y: 20, w: 4, h: 12 },
};

/** Left arm — classic, in the post-1.8 second-layer region (rows 48–63). */
export const LEFT_ARM_FACES_CLASSIC: PartFaces = {
  top: { x: 36, y: 48, w: 4, h: 4 },
  bottom: { x: 40, y: 48, w: 4, h: 4 },
  right: { x: 32, y: 52, w: 4, h: 12 },
  front: { x: 36, y: 52, w: 4, h: 12 },
  left: { x: 40, y: 52, w: 4, h: 12 },
  back: { x: 44, y: 52, w: 4, h: 12 },
};

/** Left arm — slim. */
export const LEFT_ARM_FACES_SLIM: PartFaces = {
  top: { x: 36, y: 48, w: 3, h: 4 },
  bottom: { x: 39, y: 48, w: 3, h: 4 },
  right: { x: 32, y: 52, w: 4, h: 12 },
  front: { x: 36, y: 52, w: 3, h: 12 },
  left: { x: 39, y: 52, w: 4, h: 12 },
  back: { x: 43, y: 52, w: 3, h: 12 },
};

/** Left leg — 1.8+ second-layer region. */
export const LEFT_LEG_FACES: PartFaces = {
  top: { x: 20, y: 48, w: 4, h: 4 },
  bottom: { x: 24, y: 48, w: 4, h: 4 },
  right: { x: 16, y: 52, w: 4, h: 12 },
  front: { x: 20, y: 52, w: 4, h: 12 },
  left: { x: 24, y: 52, w: 4, h: 12 },
  back: { x: 28, y: 52, w: 4, h: 12 },
};

/** Pick the variant-correct face layout for a given body part. */
export function rightArmFaces(variant: 'classic' | 'slim'): PartFaces {
  return variant === 'slim' ? RIGHT_ARM_FACES_SLIM : RIGHT_ARM_FACES_CLASSIC;
}

export function leftArmFaces(variant: 'classic' | 'slim'): PartFaces {
  return variant === 'slim' ? LEFT_ARM_FACES_SLIM : LEFT_ARM_FACES_CLASSIC;
}
