import { describe, expect, it } from 'vitest';

import {
  OVERLAY_NO_MAPPING,
  getOverlayToBaseMap,
  overlayToBase,
} from '../lib/three/overlay-map';
import { CLASSIC_UVS, SLIM_UVS } from '../lib/three/geometry';

describe('overlay-map', () => {
  describe('getOverlayToBaseMap', () => {
    it('returns a Uint16Array of length 4096 for classic', () => {
      const map = getOverlayToBaseMap('classic');
      expect(map).toBeInstanceOf(Uint16Array);
      expect(map.length).toBe(64 * 64);
    });

    it('returns a Uint16Array of length 4096 for slim', () => {
      const map = getOverlayToBaseMap('slim');
      expect(map).toBeInstanceOf(Uint16Array);
      expect(map.length).toBe(64 * 64);
    });

    it('returns the same cached reference on repeated calls', () => {
      expect(getOverlayToBaseMap('classic')).toBe(getOverlayToBaseMap('classic'));
      expect(getOverlayToBaseMap('slim')).toBe(getOverlayToBaseMap('slim'));
    });

    it('classic and slim return different instances', () => {
      expect(getOverlayToBaseMap('classic')).not.toBe(getOverlayToBaseMap('slim'));
    });
  });

  describe('OVERLAY_NO_MAPPING sentinel', () => {
    it('equals 0xFFFF (65535)', () => {
      expect(OVERLAY_NO_MAPPING).toBe(0xffff);
    });
  });

  describe('pixel counts (classic vs slim)', () => {
    // Classic overlay parts face-rect pixel counts:
    //   headOverlay:      384 px  (all 6 faces: 6 × 64)
    //   bodyOverlay:      352 px  (top 32 + bottom 32 + right 48 + front 96 + left 48 + back 96)
    //   rightArmOverlay:  224 px  (top 16 + bottom 16 + right 48 + front 48 + left 48 + back 48)
    //   leftArmOverlay:   224 px  (same as rightArmOverlay)
    //   rightLegOverlay:  224 px
    //   leftLegOverlay:   224 px
    //   classic total = 1632 mapped pixels
    //
    // Slim narrows rightArmOverlay and leftArmOverlay (front/back w 4→3, top/bottom w 4→3):
    //   rightArmOverlay slim:  192 px  (top 12 + bottom 12 + right 48 + front 36 + left 48 + back 36)
    //   leftArmOverlay slim:   192 px
    //   slim total = 1568 mapped pixels
    //   delta = 64 px (32 per arm × 2 arms)

    it('classic map has exactly 1632 non-sentinel entries', () => {
      const map = getOverlayToBaseMap('classic');
      let count = 0;
      for (let i = 0; i < map.length; i++) {
        if (map[i] !== OVERLAY_NO_MAPPING) count++;
      }
      expect(count).toBe(1632);
    });

    it('slim map has exactly 1568 non-sentinel entries', () => {
      const map = getOverlayToBaseMap('slim');
      let count = 0;
      for (let i = 0; i < map.length; i++) {
        if (map[i] !== OVERLAY_NO_MAPPING) count++;
      }
      expect(count).toBe(1568);
    });

    it('classic total non-sentinel count > slim total non-sentinel count (slim arms are narrower)', () => {
      const classicMap = getOverlayToBaseMap('classic');
      const slimMap = getOverlayToBaseMap('slim');
      let classicCount = 0;
      let slimCount = 0;
      for (let i = 0; i < classicMap.length; i++) {
        if (classicMap[i] !== OVERLAY_NO_MAPPING) classicCount++;
      }
      for (let i = 0; i < slimMap.length; i++) {
        if (slimMap[i] !== OVERLAY_NO_MAPPING) slimCount++;
      }
      expect(classicCount).toBeGreaterThan(slimCount);
      // Delta: 32 pixels per arm overlay × 2 arms = 64
      expect(classicCount - slimCount).toBe(64);
    });
  });

  describe('overlayToBase OOB checks', () => {
    it('returns null for x = -1', () => {
      expect(overlayToBase('classic', -1, 0)).toBeNull();
    });

    it('returns null for x = 64', () => {
      expect(overlayToBase('classic', 64, 0)).toBeNull();
    });

    it('returns null for y = -1', () => {
      expect(overlayToBase('classic', 0, -1)).toBeNull();
    });

    it('returns null for y = 64', () => {
      expect(overlayToBase('classic', 0, 64)).toBeNull();
    });
  });

  describe('overlayToBase returns null for pixels not in any overlay rect', () => {
    it('(0, 0) is not in any overlay rect — returns null', () => {
      // The top-left corner of the atlas is not covered by any face rect
      // (confirmed: headOverlay starts at x=32 minimum; no overlay covers (0,0))
      expect(overlayToBase('classic', 0, 0)).toBeNull();
    });

    it('a pixel inside head base front rect (not an overlay) returns null', () => {
      // head.front = { x: 8, y: 8, w: 8, h: 8 } — base, not overlay
      expect(overlayToBase('classic', 10, 10)).toBeNull();
    });

    it('a pixel inside body base front rect returns null', () => {
      // body.front = { x: 20, y: 20, w: 8, h: 12 }
      expect(overlayToBase('classic', 22, 22)).toBeNull();
    });
  });

  describe('overlayToBase happy path — center of each overlay face', () => {
    it('headOverlay front center maps to head front center', () => {
      // headOverlay.front = { x: 40, y: 8, w: 8, h: 8 }  center offset = (4, 4)
      // head.front        = { x:  8, y: 8, w: 8, h: 8 }
      const result = overlayToBase('classic', 40 + 4, 8 + 4);
      expect(result).toEqual({ x: 8 + 4, y: 8 + 4 });
    });

    it('headOverlay top center maps to head top center', () => {
      // headOverlay.top = { x: 40, y: 0, w: 8, h: 8 }  center offset = (4, 4)
      // head.top        = { x:  8, y: 0, w: 8, h: 8 }
      const result = overlayToBase('classic', 40 + 4, 0 + 4);
      expect(result).toEqual({ x: 8 + 4, y: 0 + 4 });
    });

    it('bodyOverlay front center maps to body front center', () => {
      // bodyOverlay.front = { x: 20, y: 36, w: 8, h: 12 }  center offset = (4, 6)
      // body.front        = { x: 20, y: 20, w: 8, h: 12 }
      const result = overlayToBase('classic', 20 + 4, 36 + 6);
      expect(result).toEqual({ x: 20 + 4, y: 20 + 6 });
    });

    it('rightArmOverlay front center maps to rightArm front center (classic)', () => {
      // rightArmOverlay.front = { x: 44, y: 36, w: 4, h: 12 }  center offset = (2, 6)
      // rightArm.front        = { x: 44, y: 20, w: 4, h: 12 }
      const result = overlayToBase('classic', 44 + 2, 36 + 6);
      expect(result).toEqual({ x: 44 + 2, y: 20 + 6 });
    });

    it('leftArmOverlay front center maps to leftArm front center (classic)', () => {
      // leftArmOverlay.front = { x: 52, y: 52, w: 4, h: 12 }  center offset = (2, 6)
      // leftArm.front        = { x: 36, y: 52, w: 4, h: 12 }
      const result = overlayToBase('classic', 52 + 2, 52 + 6);
      expect(result).toEqual({ x: 36 + 2, y: 52 + 6 });
    });

    it('rightLegOverlay front center maps to rightLeg front center', () => {
      // rightLegOverlay.front = { x: 4, y: 36, w: 4, h: 12 }  center offset = (2, 6)
      // rightLeg.front        = { x: 4, y: 20, w: 4, h: 12 }
      const result = overlayToBase('classic', 4 + 2, 36 + 6);
      expect(result).toEqual({ x: 4 + 2, y: 20 + 6 });
    });

    it('leftLegOverlay front center maps to leftLeg front center', () => {
      // leftLegOverlay.front = { x: 4, y: 52, w: 4, h: 12 }  center offset = (2, 6)
      // leftLeg.front        = { x: 20, y: 52, w: 4, h: 12 }
      const result = overlayToBase('classic', 4 + 2, 52 + 6);
      expect(result).toEqual({ x: 20 + 2, y: 52 + 6 });
    });
  });

  describe('overlayToBase boundary checks — top-left and bottom-right corners', () => {
    it('top-left of headOverlay top face maps to top-left of head top face', () => {
      // headOverlay.top = { x: 40, y: 0, w: 8, h: 8 }  top-left offset = (0, 0)
      // head.top        = { x:  8, y: 0, w: 8, h: 8 }
      const result = overlayToBase('classic', 40, 0);
      expect(result).toEqual({ x: 8, y: 0 });
    });

    it('bottom-right of headOverlay top face maps to bottom-right of head top face', () => {
      // headOverlay.top: bottom-right pixel offset = (w-1, h-1) = (7, 7)
      // head.top: same offset
      const result = overlayToBase('classic', 40 + 7, 0 + 7);
      expect(result).toEqual({ x: 8 + 7, y: 0 + 7 });
    });

    it('top-left of headOverlay front face maps to top-left of head front face', () => {
      // headOverlay.front = { x: 40, y: 8, w: 8, h: 8 }
      // head.front        = { x:  8, y: 8, w: 8, h: 8 }
      const result = overlayToBase('classic', 40, 8);
      expect(result).toEqual({ x: 8, y: 8 });
    });

    it('bottom-right of bodyOverlay back face maps to bottom-right of body back face', () => {
      // bodyOverlay.back = { x: 32, y: 36, w: 8, h: 12 }  bottom-right = (7, 11)
      // body.back        = { x: 32, y: 20, w: 8, h: 12 }
      const result = overlayToBase('classic', 32 + 7, 36 + 11);
      expect(result).toEqual({ x: 32 + 7, y: 20 + 11 });
    });

    it('top-left of rightLegOverlay right face maps to top-left of rightLeg right face', () => {
      // rightLegOverlay.right = { x: 0, y: 36, w: 4, h: 12 }
      // rightLeg.right        = { x: 0, y: 20, w: 4, h: 12 }
      const result = overlayToBase('classic', 0, 36);
      expect(result).toEqual({ x: 0, y: 20 });
    });
  });

  describe('overlayToBase — face-local offset is preserved', () => {
    it('headOverlay front at offset (4,4) maps to head front at same offset (4,4)', () => {
      // headOverlay.front = { x: 40, y: 8, w: 8, h: 8 }
      // head.front        = { x:  8, y: 8, w: 8, h: 8 }
      const oX = CLASSIC_UVS.headOverlay.front.x + 4;
      const oY = CLASSIC_UVS.headOverlay.front.y + 4;
      const result = overlayToBase('classic', oX, oY);
      expect(result).not.toBeNull();
      expect(result!.x).toBe(CLASSIC_UVS.head.front.x + 4);
      expect(result!.y).toBe(CLASSIC_UVS.head.front.y + 4);
    });

    it('bodyOverlay back at offset (3, 8) maps to body back at same offset', () => {
      // bodyOverlay.back = { x: 32, y: 36, w: 8, h: 12 }
      // body.back        = { x: 32, y: 20, w: 8, h: 12 }
      const oX = CLASSIC_UVS.bodyOverlay.back.x + 3;
      const oY = CLASSIC_UVS.bodyOverlay.back.y + 8;
      const result = overlayToBase('classic', oX, oY);
      expect(result).not.toBeNull();
      expect(result!.x).toBe(CLASSIC_UVS.body.back.x + 3);
      expect(result!.y).toBe(CLASSIC_UVS.body.back.y + 8);
    });

    it('rightLegOverlay left at offset (1, 5) maps to rightLeg left at same offset', () => {
      // rightLegOverlay.left = { x: 8, y: 36, w: 4, h: 12 }
      // rightLeg.left        = { x: 8, y: 20, w: 4, h: 12 }
      const oX = CLASSIC_UVS.rightLegOverlay.left.x + 1;
      const oY = CLASSIC_UVS.rightLegOverlay.left.y + 5;
      const result = overlayToBase('classic', oX, oY);
      expect(result).not.toBeNull();
      expect(result!.x).toBe(CLASSIC_UVS.rightLeg.left.x + 1);
      expect(result!.y).toBe(CLASSIC_UVS.rightLeg.left.y + 5);
    });
  });

  describe('overlayToBase — slim variant', () => {
    it('slim: rightArmOverlay front center maps to rightArm front center', () => {
      // rightArmOverlay.front (slim) = { x: 44, y: 36, w: 3, h: 12 }  center offset = (1, 6)
      // rightArm.front (slim)        = { x: 44, y: 20, w: 3, h: 12 }
      const { rightArmOverlay, rightArm } = SLIM_UVS;
      const oX = rightArmOverlay.front.x + 1;
      const oY = rightArmOverlay.front.y + 6;
      const result = overlayToBase('slim', oX, oY);
      expect(result).toEqual({ x: rightArm.front.x + 1, y: rightArm.front.y + 6 });
    });

    it('slim: leftArmOverlay front center maps to leftArm front center', () => {
      // leftArmOverlay.front (slim) = { x: 52, y: 52, w: 3, h: 12 }  center offset = (1, 6)
      // leftArm.front (slim)        = { x: 36, y: 52, w: 3, h: 12 }
      const { leftArmOverlay, leftArm } = SLIM_UVS;
      const oX = leftArmOverlay.front.x + 1;
      const oY = leftArmOverlay.front.y + 6;
      const result = overlayToBase('slim', oX, oY);
      expect(result).toEqual({ x: leftArm.front.x + 1, y: leftArm.front.y + 6 });
    });

    it('slim: pixel at classic rightArmOverlay back that falls outside slim back rect returns null', () => {
      // Classic rightArmOverlay.back = { x: 52, y: 36, w: 4, h: 12 }  last col = x=55
      // Slim   rightArmOverlay.back  = { x: 51, y: 36, w: 3, h: 12 }  last col = x=53
      // Pixel (55, 40) is inside classic overlay back but outside slim's back rect
      // (slim back starts at x=51 with w=3 so valid cols are 51, 52, 53 — x=55 is outside)
      const classicResult = overlayToBase('classic', 55, 40);
      const slimResult = overlayToBase('slim', 55, 40);
      expect(classicResult).not.toBeNull();
      expect(slimResult).toBeNull();
    });

    it('slim: headOverlay (unchanged from classic) still maps correctly', () => {
      // headOverlay is identical for classic and slim
      const classicResult = overlayToBase('classic', 40, 8);
      const slimResult = overlayToBase('slim', 40, 8);
      expect(classicResult).toEqual(slimResult);
      expect(slimResult).toEqual({ x: 8, y: 8 });
    });

    it('slim: rightArmOverlay right face (w=4 — unchanged) still maps', () => {
      // rightArmOverlay.right (slim) = { x: 40, y: 36, w: 4, h: 12 }
      // rightArm.right (slim)        = { x: 40, y: 20, w: 4, h: 12 }
      const result = overlayToBase('slim', 40 + 2, 36 + 6);
      expect(result).toEqual({ x: 40 + 2, y: 20 + 6 });
    });
  });

  describe('overlayToBase — all face keys covered', () => {
    it('all six faces of headOverlay produce non-null results for classic', () => {
      const { headOverlay } = CLASSIC_UVS;
      for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back'] as const) {
        const rect = headOverlay[face];
        const midX = rect.x + Math.floor(rect.w / 2);
        const midY = rect.y + Math.floor(rect.h / 2);
        const result = overlayToBase('classic', midX, midY);
        expect(result, `face=${face}`).not.toBeNull();
      }
    });

    it('all six faces of leftLegOverlay produce non-null results for classic', () => {
      const { leftLegOverlay } = CLASSIC_UVS;
      for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back'] as const) {
        const rect = leftLegOverlay[face];
        const midX = rect.x + Math.floor(rect.w / 2);
        const midY = rect.y + Math.floor(rect.h / 2);
        const result = overlayToBase('classic', midX, midY);
        expect(result, `face=${face}`).not.toBeNull();
      }
    });
  });

  describe('overlayToBase — LUT correctness via known overlay pixel', () => {
    it('known pixel: headOverlay.front(x+4, y+4) → head.front(x+4, y+4)', () => {
      // headOverlay.front = { x: 40, y: 8, w: 8, h: 8 }
      // head.front        = { x:  8, y: 8, w: 8, h: 8 }
      // face-local offset (4, 4) must survive the LUT round-trip
      const overlayX = CLASSIC_UVS.headOverlay.front.x + 4;
      const overlayY = CLASSIC_UVS.headOverlay.front.y + 4;
      const result = overlayToBase('classic', overlayX, overlayY);
      expect(result).toEqual({
        x: CLASSIC_UVS.head.front.x + 4,
        y: CLASSIC_UVS.head.front.y + 4,
      });
    });

    it('known pixel: bodyOverlay.right(x+1, y+3) → body.right(x+1, y+3)', () => {
      // bodyOverlay.right = { x: 16, y: 36, w: 4, h: 12 }
      // body.right        = { x: 16, y: 20, w: 4, h: 12 }
      const overlayX = CLASSIC_UVS.bodyOverlay.right.x + 1;
      const overlayY = CLASSIC_UVS.bodyOverlay.right.y + 3;
      const result = overlayToBase('classic', overlayX, overlayY);
      expect(result).toEqual({
        x: CLASSIC_UVS.body.right.x + 1,
        y: CLASSIC_UVS.body.right.y + 3,
      });
    });
  });
});
