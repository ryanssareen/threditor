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
  /**
   * M7: true once the user has committed any stroke since the last
   * applyTemplate (or since session start if no template was applied).
   * Optional for backward-compat with M3–M6 saves; loadDocument defaults
   * missing/unknown values to `true` so existing users skip the Ghost
   * picker on reload.
   */
  hasEditedSinceTemplate?: boolean;
  /**
   * M7: the id of the most recently applied template, or null if none.
   * Optional for backward-compat. Drives the contextual hint + affordance
   * pulse on reload-mid-transition (edge case).
   */
  lastAppliedTemplateId?: string | null;
};

/**
 * Bbox in atlas pixel space. Top-left origin. Used by stamp out-params
 * (zero-alloc hot path), undo-stack dirty-rect diffs, and union math.
 */
export type Bbox = { x: number; y: number; w: number; h: number };

/**
 * M6: a single dirty-rect diff inside a stroke. For a non-mirrored stroke
 * there is exactly one patch; for a mirrored stroke there are two
 * (primary + mirror). Each patch's before/after are tight bbox slices,
 * not whole-layer snapshots — per DESIGN §4 and plan D2.
 */
export type StrokePatch = {
  bbox: Bbox;
  /** Length = bbox.w * bbox.h * 4 */
  before: Uint8ClampedArray;
  /** Length = bbox.w * bbox.h * 4 */
  after: Uint8ClampedArray;
};

/**
 * Undo/redo diff record. One per user gesture (pointerdown → pointerup).
 *
 * Mirror strokes produce ONE Stroke record with `patches.length === 2`
 * and `mirrored: true`. Undo/redo restores both sides in a single step.
 */
export type Stroke = {
  id: string;
  layerId: string;
  patches: StrokePatch[];
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

// ─── M7: template types ────────────────────────────────────────────────

/**
 * Which UI element pulses at +1000ms post-apply per DESIGN §5.4. `null`
 * skips the pulse. The matching component declares `data-pulse-target`
 * on its root DOM node; AffordancePulse sets `data-pulse="true"` and a
 * CSS keyframe runs for 600ms.
 */
export type AffordancePulseTarget = 'color' | 'mirror' | 'brush' | null;

/** One template in the catalog. Shape matches DESIGN §5.2 manifest. */
export type TemplateMeta = {
  id: string;
  label: string;
  variant: SkinVariant;
  /** Absolute URL from `public/`, e.g. `/templates/classic/classic-hoodie.png`. */
  file: string;
  /** Absolute URL to a 256×256 WebP thumbnail in `/templates/thumbs/`. */
  thumbnail: string;
  license: 'MIT';
  credit: string | null;
  tags: string[];
  /** String shown anchored to the viewport at +700ms post-apply. */
  contextualHint: string;
  /** Which UI element pulses at +1000ms post-apply. */
  affordancePulse: AffordancePulseTarget;
};

/** One category grouping in the bottom sheet. */
export type TemplateCategory = {
  id: string;
  label: string;
  templates: TemplateMeta[];
};

/** Top-level manifest shape. `version` is reserved for future migrations. */
export type TemplateManifest = {
  version: 1;
  categories: TemplateCategory[];
};

/**
 * Snapshot captured by the apply-template undo command. Both `before`
 * and `after` carry the full multi-field state so undo/redo is a pure
 * state swap. `layers` holds deep-cloned layer objects (pixel buffers
 * sliced, not shared) so subsequent stamp-writes to the live layer
 * can't corrupt the snapshot.
 */
export type ApplyTemplateSnapshot = {
  layers: Layer[];
  activeLayerId: string;
  variant: SkinVariant;
  hasEditedSinceTemplate: boolean;
  lastAppliedTemplateId: string | null;
};
