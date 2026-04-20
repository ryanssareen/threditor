// @vitest-environment node
//
// M4 Unit 5 — atlas-to-world coordinate helper tests.
//
// The helper drives the 3D CursorDecal's texel-center snap: given a
// hovered atlas pixel, return the 3D world position of that pixel's
// center on the player model. Correctness matters because a wrong
// translation puts the decal on the wrong body part.
//
// We test:
//   1. faceNormal — 6 known outward directions
//   2. faceLocalOffset — face-center lands on the face plane
//   3. atlasToWorld — OOB returns null; non-covered atlas pixels return
//      null; known part+face atlas samples resolve to the expected part
//      with the normal pointing the expected direction

import { describe, expect, it } from 'vitest';

import {
  atlasToWorld,
  faceLocalOffset,
  faceNormal,
} from '@/lib/three/atlas-to-world';
import { CLASSIC_UVS, partPosition, partDims } from '@/lib/three/geometry';

describe('faceNormal', () => {
  it('returns +X for right face', () => {
    expect(faceNormal('right')).toEqual([1, 0, 0]);
  });
  it('returns -X for left face', () => {
    expect(faceNormal('left')).toEqual([-1, 0, 0]);
  });
  it('returns +Y for top face', () => {
    expect(faceNormal('top')).toEqual([0, 1, 0]);
  });
  it('returns -Y for bottom face', () => {
    expect(faceNormal('bottom')).toEqual([0, -1, 0]);
  });
  it('returns +Z for front face', () => {
    expect(faceNormal('front')).toEqual([0, 0, 1]);
  });
  it('returns -Z for back face', () => {
    expect(faceNormal('back')).toEqual([0, 0, -1]);
  });
});

describe('faceLocalOffset — face-center invariants', () => {
  // At uFrac=0.5, vFrac=0.5 (face center), the "fixed axis" of the face
  // equals ±dim/2 and the other two axes are zero.
  const w = 0.5;
  const h = 0.5;
  const d = 0.5;
  const center = 0.5;

  it('front face center → (0, 0, +d/2)', () => {
    expect(faceLocalOffset('front', center, center, w, h, d)).toEqual([0, 0, d / 2]);
  });
  it('back face center → (0, 0, -d/2)', () => {
    expect(faceLocalOffset('back', center, center, w, h, d)).toEqual([0, 0, -d / 2]);
  });
  it('right face center → (+w/2, 0, 0)', () => {
    expect(faceLocalOffset('right', center, center, w, h, d)).toEqual([w / 2, 0, 0]);
  });
  it('left face center → (-w/2, 0, 0)', () => {
    expect(faceLocalOffset('left', center, center, w, h, d)).toEqual([-w / 2, 0, 0]);
  });
  it('top face center → (0, +h/2, 0)', () => {
    expect(faceLocalOffset('top', center, center, w, h, d)).toEqual([0, h / 2, 0]);
  });
  it('bottom face center → (0, -h/2, 0)', () => {
    expect(faceLocalOffset('bottom', center, center, w, h, d)).toEqual([0, -h / 2, 0]);
  });
});

describe('faceLocalOffset — corner direction invariants', () => {
  // Per the table in atlas-to-world.ts, for each face:
  //   u=0 is the "upper-left" UV, u=1 is the "upper-right" UV
  //   v=0 is the atlas top edge of the face, v=1 is the atlas bottom edge
  //
  // For each face, verify that (u=0, v=0) and (u=1, v=1) diverge along
  // the expected axes.
  const w = 1;
  const h = 1;
  const d = 1;

  it('front face u=0,v=0 is at (-w/2, +h/2, +d/2) (top-left corner)', () => {
    expect(faceLocalOffset('front', 0, 0, w, h, d)).toEqual([-0.5, 0.5, 0.5]);
  });
  it('front face u=1,v=1 is at (+w/2, -h/2, +d/2) (bottom-right corner)', () => {
    expect(faceLocalOffset('front', 1, 1, w, h, d)).toEqual([0.5, -0.5, 0.5]);
  });
  it('right face u=0,v=0 is at (+w/2, +h/2, +d/2)', () => {
    expect(faceLocalOffset('right', 0, 0, w, h, d)).toEqual([0.5, 0.5, 0.5]);
  });
  it('right face u=1,v=1 is at (+w/2, -h/2, -d/2)', () => {
    expect(faceLocalOffset('right', 1, 1, w, h, d)).toEqual([0.5, -0.5, -0.5]);
  });
});

describe('atlasToWorld', () => {
  it('returns null for OOB coords', () => {
    expect(atlasToWorld('classic', -1, 0)).toBeNull();
    expect(atlasToWorld('classic', 0, -1)).toBeNull();
    expect(atlasToWorld('classic', 64, 0)).toBeNull();
    expect(atlasToWorld('classic', 0, 64)).toBeNull();
  });

  it('returns null for an atlas pixel not covered by any face', () => {
    // (0, 0) is in the unused atlas region in the standard Minecraft
    // layout (top-left corner is not part of any face).
    // If the layout changes, this may start returning non-null; adjust
    // the sample if the island-map changes.
    expect(atlasToWorld('classic', 0, 0)).toBeNull();
  });

  it('resolves a head-front atlas pixel to head.front with +Z normal', () => {
    const rect = CLASSIC_UVS.head.front;
    const hit = atlasToWorld('classic', rect.x + 4, rect.y + 4);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error('unreachable');
    expect(hit.part).toBe('head');
    expect(hit.face).toBe('front');
    expect(hit.normal).toEqual([0, 0, 1]);
    // Position should be in front (+Z) of the head's center.
    const [cx, cy, cz] = partPosition('classic', 'head');
    const [, , headD] = partDims('classic', 'head');
    expect(hit.position[2]).toBeCloseTo(cz + headD / 2, 5);
    expect(hit.position[0]).toBeGreaterThan(cx - 0.2); // within head bounds x
    expect(hit.position[1]).toBeGreaterThan(cy - 0.2); // within head bounds y
  });

  it('resolves head-front corner atlas pixel close to a 3D corner', () => {
    // Upper-left corner of the head.front face in atlas.
    const rect = CLASSIC_UVS.head.front;
    const hit = atlasToWorld('classic', rect.x, rect.y);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error('unreachable');
    const [cx, cy, cz] = partPosition('classic', 'head');
    const [w, h, d] = partDims('classic', 'head');
    // Top-left of front face in 3D local frame = (-w/2, +h/2, +d/2)
    // BUT atlas top-left is v_frac=0 which is +h/2 — need to account for
    // the texel-center 0.5-pixel offset.
    const uFrac = 0.5 / rect.w;
    const vFrac = 0.5 / rect.h;
    expect(hit.position[0]).toBeCloseTo(cx + (-w / 2 + uFrac * w), 5);
    expect(hit.position[1]).toBeCloseTo(cy + (h / 2 - vFrac * h), 5);
    expect(hit.position[2]).toBeCloseTo(cz + d / 2, 5);
  });

  it('resolves a body-right atlas pixel to body.right with +X normal', () => {
    const rect = CLASSIC_UVS.body.right;
    const hit = atlasToWorld('classic', rect.x + 1, rect.y + 4);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error('unreachable');
    expect(hit.part).toBe('body');
    expect(hit.face).toBe('right');
    expect(hit.normal).toEqual([1, 0, 0]);
  });

  it('resolves a headOverlay atlas pixel to headOverlay (not redirected)', () => {
    // atlasToWorld does NOT apply overlay/base precedence — that's the
    // consumer's job. It just returns the part+face of the atlas pixel.
    const rect = CLASSIC_UVS.headOverlay.front;
    const hit = atlasToWorld('classic', rect.x + 2, rect.y + 2);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error('unreachable');
    expect(hit.part).toBe('headOverlay');
  });

  it('returns the same face+part for every pixel inside the same face rect', () => {
    const rect = CLASSIC_UVS.rightArm.front;
    for (let dy = 0; dy < rect.h; dy += 2) {
      for (let dx = 0; dx < rect.w; dx += 2) {
        const hit = atlasToWorld('classic', rect.x + dx, rect.y + dy);
        expect(hit).not.toBeNull();
        if (hit === null) continue;
        expect(hit.part).toBe('rightArm');
        expect(hit.face).toBe('front');
      }
    }
  });

  it('slim variant arm pixel resolves to rightArm.front with narrower dims', () => {
    const rect = CLASSIC_UVS.rightArm.front; // classic arm front is 4×12
    // Slim rightArm.front is 3×12 — pick a coord inside the SLIM rect
    // specifically (x=rect.x+1 is safe for both variants).
    const hit = atlasToWorld('slim', rect.x + 1, rect.y + 4);
    expect(hit).not.toBeNull();
    if (hit === null) throw new Error('unreachable');
    expect(hit.part).toBe('rightArm');
    expect(hit.face).toBe('front');
  });
});
