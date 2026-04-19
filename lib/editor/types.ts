/**
 * M3: core editor data types.
 *
 * Locked shapes from docs/DESIGN.md §4. M4–M8 import from here.
 * Changing any of these is a cross-milestone contract break; do so only
 * via a /ce:plan amendment.
 */

/** Minecraft skin variant — narrow Classic arms (4 px) vs Slim arms (3 px). */
export type SkinVariant = 'classic' | 'slim';

/** A single painted layer, 64x64 RGBA. pixels.length === 64 * 64 * 4. */
export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  /** 0–1 inclusive */
  opacity: number;
  blendMode: 'normal' | 'multiply' | 'overlay' | 'screen';
  /** Length = 64 * 64 * 4 = 16384. RGBA, row-major, top-left origin. */
  pixels: Uint8ClampedArray;
};

/** The full skin document persisted to IndexedDB. */
export type SkinDocument = {
  id: string;
  variant: SkinVariant;
  /** Bottom-to-top render order. The texture composite walks this front-to-back. */
  layers: Layer[];
  activeLayerId: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Undo/redo diff record. One per user gesture (mousedown → mouseup),
 * not per pixel. Mirror strokes produce one record with bbox spanning
 * both sides and mirrored: true.
 */
export type Stroke = {
  id: string;
  layerId: string;
  bbox: { x: number; y: number; w: number; h: number };
  /** Length = bbox.w * bbox.h * 4 */
  before: Uint8ClampedArray;
  /** Length = bbox.w * bbox.h * 4 */
  after: Uint8ClampedArray;
  tool: 'pencil' | 'eraser' | 'bucket';
  mirrored: boolean;
};

/**
 * Island ID. 0 = unused/transparent atlas region, 1+ = body-part region
 * (head-front=1, head-back=2, torso-front=3, …). Used by bucket fill to
 * prevent bleed across UV seams.
 */
export type IslandId = number;

/** 64 * 64 = 4096 island IDs, row-major, top-left origin. */
export type IslandMap = Uint8Array;

export type Point = { x: number; y: number };

/** RGBA tuple, 0–255 per channel. */
export type RGBA = readonly [r: number, g: number, b: number, a: number];
