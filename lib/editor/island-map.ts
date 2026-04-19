/**
 * M3: per-variant Minecraft-skin island maps.
 *
 * Load-bearing for M3 (bucket hover preview), M5 (bucket fill),
 * M7 (template thumbnails that need per-face masking), M11 (OG image
 * per-face lighting). Changing the ID scheme is a cross-milestone
 * contract break; do so only via a /ce:plan amendment.
 *
 * Each atlas pixel at (x, y) stores an `IslandId`:
 *   - 0: unused / transparent atlas region
 *   - 1-72: one of 12 parts × 6 faces, assigned deterministically
 *
 * Face-level granularity (not body-part-level) is per DESIGN.md §9.1.
 * A bucket fill seeded on the head-front face stops at the atlas seam
 * between head-front and head-top because those are distinct IslandIds
 * even though they belong to the same cube in 3D.
 *
 * The two maps (Classic + Slim) differ only in the four arm-face rects
 * where Slim narrows front/back from 4 px to 3 px. They are built once
 * at module init and cached in module scope per plan §9.1 / DESIGN.md.
 */

import { SKIN_ATLAS_SIZE } from '@/lib/three/constants';
import {
  CLASSIC_UVS,
  SLIM_UVS,
  type PlayerPart,
  type PlayerUVs,
  type SkinVariant,
  type UVRect,
} from '@/lib/three/geometry';
import type { IslandId, IslandMap } from './types';

type FaceKey = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';

/**
 * Canonical part ordering for ID assignment. Changing this order
 * renumbers every IslandId — don't. New parts added in future milestones
 * (e.g., a cape) must append to the end, not insert.
 */
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

/** Canonical face ordering for ID assignment within a part. */
const FACE_ID_ORDER: readonly FaceKey[] = [
  'top',
  'bottom',
  'right',
  'front',
  'left',
  'back',
];

function fillRect(map: Uint8Array, rect: UVRect, id: IslandId): void {
  const { x, y, w, h } = rect;
  const yEnd = y + h;
  const xEnd = x + w;
  for (let py = y; py < yEnd; py++) {
    const rowStart = py * SKIN_ATLAS_SIZE;
    for (let px = x; px < xEnd; px++) {
      map[rowStart + px] = id;
    }
  }
}

function buildIslandMap(uvs: PlayerUVs): IslandMap {
  const map = new Uint8Array(SKIN_ATLAS_SIZE * SKIN_ATLAS_SIZE);
  let nextId: IslandId = 1;
  for (const part of PART_ID_ORDER) {
    const boxUVs = uvs[part];
    for (const face of FACE_ID_ORDER) {
      fillRect(map, boxUVs[face], nextId);
      nextId += 1;
    }
  }
  return map;
}

const CLASSIC_ISLAND_MAP: IslandMap = buildIslandMap(CLASSIC_UVS);
const SLIM_ISLAND_MAP: IslandMap = buildIslandMap(SLIM_UVS);

/**
 * Resolve the island map for the given variant. The returned Uint8Array
 * is module-scoped and must not be mutated by callers.
 */
export function getIslandMap(variant: SkinVariant): IslandMap {
  return variant === 'classic' ? CLASSIC_ISLAND_MAP : SLIM_ISLAND_MAP;
}

/**
 * Look up the island ID at atlas pixel (x, y). Returns 0 for out-of-range
 * coordinates so callers don't have to bound-check before calling.
 */
export function islandIdAt(map: IslandMap, x: number, y: number): IslandId {
  if (x < 0 || x >= SKIN_ATLAS_SIZE || y < 0 || y >= SKIN_ATLAS_SIZE) return 0;
  return map[y * SKIN_ATLAS_SIZE + x];
}

/** Total number of distinct island IDs (12 parts × 6 faces). */
export const ISLAND_ID_COUNT = PART_ID_ORDER.length * FACE_ID_ORDER.length;
