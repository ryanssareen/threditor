// @vitest-environment node
//
// M5 Unit 5 — mirror LUT.

import { describe, expect, it } from 'vitest';

import {
  MIRROR_NO_MAPPING,
  getMirrorMap,
  mirrorAtlasPixel,
} from '../lib/editor/tools/mirror';
import { CLASSIC_UVS, SLIM_UVS } from '../lib/three/geometry';
import { SKIN_ATLAS_SIZE } from '../lib/three/constants';

describe('mirror LUT — classic', () => {
  it('head.front self-mirrors within the rect with face-local X flip', () => {
    const rect = CLASSIC_UVS.head.front;
    // Pick a left-of-center pixel; its mirror should be right-of-center
    // within the same rect, same y.
    const fx = 1;
    const fy = 3;
    const m = mirrorAtlasPixel('classic', rect.x + fx, rect.y + fy);
    expect(m).not.toBeNull();
    expect(m!.x).toBe(rect.x + (rect.w - 1 - fx));
    expect(m!.y).toBe(rect.y + fy);
  });

  it('rightArm.front → leftArm.front at mirrored fx, same fy', () => {
    const src = CLASSIC_UVS.rightArm.front;
    const dst = CLASSIC_UVS.leftArm.front;
    const fx = 1;
    const fy = 3;
    const m = mirrorAtlasPixel('classic', src.x + fx, src.y + fy);
    expect(m).not.toBeNull();
    expect(m!.x).toBe(dst.x + (dst.w - 1 - fx));
    expect(m!.y).toBe(dst.y + fy);
  });

  it('rightArm.right → leftArm.left (face-key swap)', () => {
    const src = CLASSIC_UVS.rightArm.right;
    const dst = CLASSIC_UVS.leftArm.left;
    const fx = 1;
    const fy = 2;
    const m = mirrorAtlasPixel('classic', src.x + fx, src.y + fy);
    expect(m).not.toBeNull();
    expect(m!.x).toBe(dst.x + (dst.w - 1 - fx));
    expect(m!.y).toBe(dst.y + fy);
  });

  it('rightLeg.front mirrors to leftLeg.front (not leg.back)', () => {
    const src = CLASSIC_UVS.rightLeg.front;
    const dst = CLASSIC_UVS.leftLeg.front;
    const m = mirrorAtlasPixel('classic', src.x, src.y);
    expect(m).not.toBeNull();
    expect(m!.x).toBe(dst.x + (dst.w - 1));
    expect(m!.y).toBe(dst.y);
  });

  it('rightArmOverlay.front mirrors to leftArmOverlay.front (overlay stays overlay)', () => {
    const src = CLASSIC_UVS.rightArmOverlay.front;
    const dst = CLASSIC_UVS.leftArmOverlay.front;
    const m = mirrorAtlasPixel('classic', src.x + 2, src.y + 2);
    expect(m).not.toBeNull();
    expect(m!.x).toBe(dst.x + (dst.w - 1 - 2));
    expect(m!.y).toBe(dst.y + 2);
  });

  it('bodyOverlay self-pairs and X-flips within its own rect', () => {
    const src = CLASSIC_UVS.bodyOverlay.front;
    const fx = 3;
    const fy = 5;
    const m = mirrorAtlasPixel('classic', src.x + fx, src.y + fy);
    expect(m).not.toBeNull();
    expect(m!.x).toBe(src.x + (src.w - 1 - fx));
    expect(m!.y).toBe(src.y + fy);
  });
});

describe('mirror LUT — involution', () => {
  it('mirror∘mirror = identity for every body-part pixel (classic)', () => {
    const map = getMirrorMap('classic');
    let checked = 0;
    for (let y = 0; y < SKIN_ATLAS_SIZE; y++) {
      for (let x = 0; x < SKIN_ATLAS_SIZE; x++) {
        const idx = y * SKIN_ATLAS_SIZE + x;
        if (map[idx] === MIRROR_NO_MAPPING) continue;
        const m = mirrorAtlasPixel('classic', x, y)!;
        const mm = mirrorAtlasPixel('classic', m.x, m.y)!;
        expect(mm.x).toBe(x);
        expect(mm.y).toBe(y);
        checked += 1;
      }
    }
    // Sanity: classic has 12 parts × 6 faces; every body-part pixel
    // should have a mirror. A few thousand checked is healthy.
    expect(checked).toBeGreaterThan(2000);
  });

  it('mirror∘mirror = identity for slim too', () => {
    const map = getMirrorMap('slim');
    for (let y = 0; y < SKIN_ATLAS_SIZE; y++) {
      for (let x = 0; x < SKIN_ATLAS_SIZE; x++) {
        const idx = y * SKIN_ATLAS_SIZE + x;
        if (map[idx] === MIRROR_NO_MAPPING) continue;
        const m = mirrorAtlasPixel('slim', x, y)!;
        const mm = mirrorAtlasPixel('slim', m.x, m.y)!;
        expect(mm.x).toBe(x);
        expect(mm.y).toBe(y);
      }
    }
  });
});

describe('mirror LUT — slim variant narrower arms', () => {
  it('slim rightArm.front width = 3 and mirror respects it', () => {
    const src = SLIM_UVS.rightArm.front;
    const dst = SLIM_UVS.leftArm.front;
    expect(src.w).toBe(3);
    expect(dst.w).toBe(3);
    const fx = 0;
    const fy = 1;
    const m = mirrorAtlasPixel('slim', src.x + fx, src.y + fy);
    expect(m).not.toBeNull();
    expect(m!.x).toBe(dst.x + (dst.w - 1 - fx));
    expect(m!.y).toBe(dst.y + fy);
  });
});

describe('mirror LUT — out of body-part + OOB', () => {
  it('OOB negative → null', () => {
    expect(mirrorAtlasPixel('classic', -1, 0)).toBeNull();
    expect(mirrorAtlasPixel('classic', 0, -1)).toBeNull();
  });
  it('OOB past 63 → null', () => {
    expect(mirrorAtlasPixel('classic', 64, 0)).toBeNull();
    expect(mirrorAtlasPixel('classic', 0, 64)).toBeNull();
  });
  it('atlas corner (0, 0) is outside classic body parts → null', () => {
    // Classic head.top starts at (8, 0); (0, 0) is unused.
    expect(mirrorAtlasPixel('classic', 0, 0)).toBeNull();
  });
});

describe('mirror LUT — cache identity', () => {
  it('getMirrorMap returns the same Uint16Array on repeated calls', () => {
    expect(getMirrorMap('classic')).toBe(getMirrorMap('classic'));
    expect(getMirrorMap('slim')).toBe(getMirrorMap('slim'));
  });
  it('classic and slim LUTs are distinct instances', () => {
    expect(getMirrorMap('classic')).not.toBe(getMirrorMap('slim'));
  });
});
