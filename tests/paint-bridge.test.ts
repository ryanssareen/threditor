// @vitest-environment node
//
// M4 Unit 4 — paint bridge pure-function tests.
//
// R3F raycast + <mesh onPointerDown> behavior cannot be cleanly exercised
// under jsdom (no WebGL context, raycaster hits require a real three.js
// renderer pipeline). Instead we test the pure transformations that
// PlayerModel's paint handlers depend on:
//
//   1. uv → atlas coord (with Y-flip per DESIGN §7)
//   2. Overlay/base precedence resolution (alpha-threshold redirect)
//
// Full integration (click on 3D model → pixel on 2D) is covered in the
// manual acceptance list (see plan §Acceptance Criteria).

import { describe, expect, it } from 'vitest';

import { SKIN_ATLAS_SIZE, OVERLAY_ALPHA_THRESHOLD } from '@/lib/three/constants';
import { CLASSIC_UVS } from '@/lib/three/geometry';
import { resolveOverlayHit } from '@/lib/three/overlay-map';
import { uvToAtlasX, uvToAtlasY } from '@/lib/three/atlas-math';

// M5 Unit 0: this test used to replicate PlayerModel's internal scalar
// helpers. They now live in lib/three/atlas-math.ts and
// lib/three/overlay-map.ts; import from there and assert against the
// canonical source rather than a drifting copy.

const resolveHit = (
  rawX: number,
  rawY: number,
  isOverlay: boolean,
  pixels: Uint8ClampedArray,
  variant: 'classic' | 'slim',
): { x: number; y: number; target: 'base' | 'overlay' } =>
  resolveOverlayHit(variant, pixels, rawX, rawY, isOverlay);

describe('uvToAtlas (3D hit → atlas pixel)', () => {
  describe('X axis (u → atlas x, no flip)', () => {
    it('u=0 → atlas x=0', () => {
      expect(uvToAtlasX(0)).toBe(0);
    });
    it('u=0.5 → atlas x=32', () => {
      expect(uvToAtlasX(0.5)).toBe(32);
    });
    it('u=0.99999 → atlas x=63 (last pixel)', () => {
      expect(uvToAtlasX(0.99999)).toBe(63);
    });
    it('u=1 → atlas x=63 (clamped, not 64)', () => {
      expect(uvToAtlasX(1)).toBe(63);
    });
    it('negative u → atlas x=0 (clamped)', () => {
      expect(uvToAtlasX(-0.01)).toBe(0);
    });
    it('u>1 → atlas x=63 (clamped; guards UV extrapolation at overlay +1px edge)', () => {
      expect(uvToAtlasX(1.01)).toBe(63);
    });
  });

  describe('Y axis (v → atlas y, WITH flip)', () => {
    it('v=0 → atlas y=63 (uv bottom → atlas bottom row)', () => {
      expect(uvToAtlasY(0)).toBe(63);
    });
    it('v=1 → atlas y=0 (uv top → atlas top row, clamped from -1 after flip)', () => {
      // (1 - 1) * 64 = 0 → atlas y=0
      expect(uvToAtlasY(1)).toBe(0);
    });
    it('v=0.5 → atlas y=32', () => {
      expect(uvToAtlasY(0.5)).toBe(32);
    });
    it('v=0.99999 → atlas y=0', () => {
      expect(uvToAtlasY(0.99999)).toBe(0);
    });
    it('negative v → atlas y=63 (clamped; (1 - (-0.01)) * 64 = 64.64 → 64 → clamp 63)', () => {
      expect(uvToAtlasY(-0.01)).toBe(63);
    });
    it('v>1 → atlas y=0 (clamped)', () => {
      expect(uvToAtlasY(1.01)).toBe(0);
    });
  });
});

describe('resolveHit (overlay/base precedence)', () => {
  function makeEmptyPixels(): Uint8ClampedArray {
    return new Uint8ClampedArray(SKIN_ATLAS_SIZE * SKIN_ATLAS_SIZE * 4);
  }

  function setPixelAlpha(pixels: Uint8ClampedArray, x: number, y: number, alpha: number): void {
    pixels[(y * SKIN_ATLAS_SIZE + x) * 4 + 3] = alpha;
  }

  it('base mesh hit → target=base, coords unchanged', () => {
    const pixels = makeEmptyPixels();
    const result = resolveHit(10, 10, false, pixels, 'classic');
    expect(result).toEqual({ x: 10, y: 10, target: 'base' });
  });

  it('overlay mesh hit with transparent pixel → redirect to base via LUT, target=base', () => {
    const pixels = makeEmptyPixels();
    // headOverlay front face center in classic. Check CLASSIC_UVS to pick
    // a known overlay pixel.
    const headOverlayFront = CLASSIC_UVS.headOverlay.front;
    const headFront = CLASSIC_UVS.head.front;
    const overlayX = headOverlayFront.x + 2;
    const overlayY = headOverlayFront.y + 2;
    // alpha=0 (transparent) → should redirect
    const result = resolveHit(overlayX, overlayY, true, pixels, 'classic');
    expect(result.target).toBe('base');
    expect(result.x).toBe(headFront.x + 2);
    expect(result.y).toBe(headFront.y + 2);
  });

  it('overlay mesh hit with opaque pixel → target=overlay, no redirect', () => {
    const pixels = makeEmptyPixels();
    const headOverlayFront = CLASSIC_UVS.headOverlay.front;
    const overlayX = headOverlayFront.x + 2;
    const overlayY = headOverlayFront.y + 2;
    setPixelAlpha(pixels, overlayX, overlayY, 255);
    const result = resolveHit(overlayX, overlayY, true, pixels, 'classic');
    expect(result).toEqual({ x: overlayX, y: overlayY, target: 'overlay' });
  });

  it('overlay mesh hit with alpha exactly at threshold → target=overlay (≥ threshold)', () => {
    const pixels = makeEmptyPixels();
    const headOverlayFront = CLASSIC_UVS.headOverlay.front;
    const overlayX = headOverlayFront.x + 2;
    const overlayY = headOverlayFront.y + 2;
    setPixelAlpha(pixels, overlayX, overlayY, OVERLAY_ALPHA_THRESHOLD);
    const result = resolveHit(overlayX, overlayY, true, pixels, 'classic');
    expect(result.target).toBe('overlay');
  });

  it('overlay mesh hit with alpha just below threshold → redirect', () => {
    const pixels = makeEmptyPixels();
    const headOverlayFront = CLASSIC_UVS.headOverlay.front;
    const overlayX = headOverlayFront.x + 2;
    const overlayY = headOverlayFront.y + 2;
    setPixelAlpha(pixels, overlayX, overlayY, OVERLAY_ALPHA_THRESHOLD - 1);
    const result = resolveHit(overlayX, overlayY, true, pixels, 'classic');
    expect(result.target).toBe('base');
  });

  it('overlay redirect preserves face-local offset', () => {
    // Sample multiple offsets in a headOverlay face; each should redirect
    // to the same offset inside the head face.
    const pixels = makeEmptyPixels();
    const overlayRect = CLASSIC_UVS.headOverlay.top;
    const baseRect = CLASSIC_UVS.head.top;
    for (let dy = 0; dy < overlayRect.h; dy += 2) {
      for (let dx = 0; dx < overlayRect.w; dx += 2) {
        const r = resolveHit(overlayRect.x + dx, overlayRect.y + dy, true, pixels, 'classic');
        expect(r.target).toBe('base');
        expect(r.x).toBe(baseRect.x + dx);
        expect(r.y).toBe(baseRect.y + dy);
      }
    }
  });

  it('redirect works for every overlay part × face pairing (classic)', () => {
    const pixels = makeEmptyPixels();
    const pairs: [string, string][] = [
      ['headOverlay', 'head'],
      ['bodyOverlay', 'body'],
      ['rightArmOverlay', 'rightArm'],
      ['leftArmOverlay', 'leftArm'],
      ['rightLegOverlay', 'rightLeg'],
      ['leftLegOverlay', 'leftLeg'],
    ];
    const faces = ['top', 'bottom', 'right', 'front', 'left', 'back'] as const;
    for (const [overlayPart, basePart] of pairs) {
      for (const face of faces) {
        const oRect = CLASSIC_UVS[overlayPart as keyof typeof CLASSIC_UVS][face];
        const bRect = CLASSIC_UVS[basePart as keyof typeof CLASSIC_UVS][face];
        // Sample face-center (use 0,0 if face is 1px; generally center works)
        const dx = Math.min(1, oRect.w - 1);
        const dy = Math.min(1, oRect.h - 1);
        const r = resolveHit(oRect.x + dx, oRect.y + dy, true, pixels, 'classic');
        expect(r.target).toBe('base');
        expect(r.x).toBe(bRect.x + dx);
        expect(r.y).toBe(bRect.y + dy);
      }
    }
  });
});
