/**
 * M2: programmatic placeholder skin generator.
 * Returns a 64x64 RGBA data URL with distinct hues per body-part region so the
 * Classic↔Slim variant toggle produces a visibly different render.
 *
 * Palette is intentionally high-contrast for debug visibility, not aesthetic —
 * M2 visual review noted the purple-arm / blue-body pairing reads as "mushy"
 * against the OLED-dark background.
 *
 * M7 note: the `blank-better` template (adapted from Microsoft's
 * minecraft-samples) is the production first-open recommendation via the
 * Ghost Templates picker. This placeholder is kept as the fresh-install
 * seed (displayed before the user picks a template, or after a variant
 * toggle clears layers) and as the dev-time Classic↔Slim variant demo
 * source. Do not remove — use-texture-manager's Effect B still calls it.
 */

import { SKIN_ATLAS_SIZE } from './constants';
import { type PlayerPart, type SkinVariant } from './geometry';

type Rect = { x: number; y: number; w: number; h: number };

// Hue palette chosen for high mutual contrast on OLED-dark (#0A0A0A) background.
const COLORS = {
  head: '#8B5A3C', // tan
  body: '#3366CC', // blue
  arm: '#663399', // purple
  leg: '#2E8B57', // green
  overlay: 'rgba(0, 229, 255, 0.35)', // accent-tinted, semi-transparent so base reads through
} as const;

/**
 * Top-half rects (y < 32) used by both Classic and Slim unchanged.
 * Bottom-half rects (y >= 32) include the left-limb regions added in MC 1.8.
 * Rects are keyed by body part; each rect spans the full atlas footprint for
 * that part (we do not need per-face precision for the placeholder — whole-part
 * fills are sufficient to verify the UV toggle works).
 *
 * Typed `Record<PlayerPart, Rect[]>` so adding a new PlayerPart to the union
 * produces a compile error here until a rect is supplied.
 */
const CLASSIC_PART_RECTS: Record<PlayerPart, Rect[]> = {
  head: [{ x: 0, y: 0, w: 32, h: 16 }],
  headOverlay: [{ x: 32, y: 0, w: 32, h: 16 }],
  body: [{ x: 16, y: 16, w: 24, h: 16 }],
  bodyOverlay: [{ x: 16, y: 32, w: 24, h: 16 }],
  rightArm: [{ x: 40, y: 16, w: 16, h: 16 }],
  rightArmOverlay: [{ x: 40, y: 32, w: 16, h: 16 }],
  rightLeg: [{ x: 0, y: 16, w: 16, h: 16 }],
  rightLegOverlay: [{ x: 0, y: 32, w: 16, h: 16 }],
  leftArm: [{ x: 32, y: 48, w: 16, h: 16 }],
  leftArmOverlay: [{ x: 48, y: 48, w: 16, h: 16 }],
  leftLeg: [{ x: 16, y: 48, w: 16, h: 16 }],
  leftLegOverlay: [{ x: 0, y: 48, w: 16, h: 16 }],
};

// Slim variant uses same atlas regions — the difference is only in box geometry
// width (3 px vs 4 px). The placeholder pixel data is identical; geometry.ts
// handles the per-face UV rect narrowing.
const SLIM_PART_RECTS = CLASSIC_PART_RECTS;

function fillRect(ctx: CanvasRenderingContext2D, rect: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function partColor(part: PlayerPart): string {
  if (part.startsWith('head')) return part.endsWith('Overlay') ? COLORS.overlay : COLORS.head;
  if (part.startsWith('body')) return part.endsWith('Overlay') ? COLORS.overlay : COLORS.body;
  if (part.includes('Arm')) return part.endsWith('Overlay') ? COLORS.overlay : COLORS.arm;
  if (part.includes('Leg')) return part.endsWith('Overlay') ? COLORS.overlay : COLORS.leg;
  return '#FF00FF'; // magenta = bug marker (unreachable given PlayerPart exhaustiveness)
}

/**
 * Paint the placeholder rectangles onto a caller-provided 2D context.
 * Shared by both public exports. Assumes the canvas is already sized
 * to SKIN_ATLAS_SIZE × SKIN_ATLAS_SIZE and the context has the right
 * config (clear + imageSmoothingEnabled = false).
 */
function paintPlaceholderOnContext(
  ctx: CanvasRenderingContext2D,
  variant: SkinVariant,
): void {
  const rects = variant === 'classic' ? CLASSIC_PART_RECTS : SLIM_PART_RECTS;
  for (const [part, list] of Object.entries(rects) as Array<[PlayerPart, Rect[]]>) {
    for (const rect of list) {
      fillRect(ctx, rect, partColor(part));
    }
  }
}

/**
 * Generate a placeholder skin PNG data URL.
 * Pure function, no DOM side effects beyond the offscreen canvas it allocates
 * and drops. Callable at module init or inside a React component.
 */
export function createPlaceholderSkinDataURL(variant: SkinVariant): string {
  const canvas = document.createElement('canvas');
  canvas.width = SKIN_ATLAS_SIZE;
  canvas.height = SKIN_ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('placeholder-skin: 2D context unavailable');

  // Start fully transparent — unused atlas regions stay clear.
  ctx.clearRect(0, 0, SKIN_ATLAS_SIZE, SKIN_ATLAS_SIZE);
  ctx.imageSmoothingEnabled = false;

  paintPlaceholderOnContext(ctx, variant);

  return canvas.toDataURL('image/png');
}

/**
 * Generate the placeholder pixels as a 16384-byte Uint8ClampedArray
 * (64 × 64 × 4 RGBA, top-left origin). Shape matches `Layer.pixels` so
 * TextureManager can consume it directly via `composite([layer])`.
 *
 * Pure function, no DOM side effects beyond the offscreen canvas it
 * allocates and drops. Callable only on the client — `document` access
 * is required.
 */
export function createPlaceholderSkinPixels(variant: SkinVariant): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = SKIN_ATLAS_SIZE;
  canvas.height = SKIN_ATLAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('placeholder-skin: 2D context unavailable');

  ctx.clearRect(0, 0, SKIN_ATLAS_SIZE, SKIN_ATLAS_SIZE);
  ctx.imageSmoothingEnabled = false;

  paintPlaceholderOnContext(ctx, variant);

  return ctx.getImageData(0, 0, SKIN_ATLAS_SIZE, SKIN_ATLAS_SIZE).data;
}
