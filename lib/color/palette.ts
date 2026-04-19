/**
 * M3: static default color palette.
 *
 * Per the hybrid palette strategy in docs/plans/m3-paint-canvas.md §G:
 * ship an 8-color Minecraft-iconic default; median-cut extraction from
 * selected templates lands in M7 (palette-extract.ts, deferred).
 *
 * Palette seats (index 0 is the default activeColor on first load):
 *   0 Dirt brown    - starting "safe" color, reads well on dark UI
 *   1 Grass green   - secondary, used as initial previousColor for the
 *                     two-swatch preview click-to-swap
 *   2 Stone gray    - neutral
 *   3 Water blue
 *   4 Lava orange
 *   5 Gold yellow
 *   6 Redstone red
 *   7 Obsidian black
 *
 * All values lowercase hex. No `#` case variance across the codebase.
 */

export const DEFAULT_PALETTE: readonly string[] = [
  '#6b3a1e', // dirt brown
  '#4a7a32', // grass green
  '#7f7f7f', // stone gray
  '#3366cc', // water blue
  '#e06a1c', // lava orange
  '#f2c94c', // gold yellow
  '#c03a2b', // redstone red
  '#0d0d0d', // obsidian black
];

/**
 * Initial `previousColor` seat for the two-swatch preview (A.7). Distinct
 * from index 0 so the first click-to-swap produces a visible change even
 * before the user paints.
 */
export const DEFAULT_PREVIOUS_COLOR = DEFAULT_PALETTE[1];
