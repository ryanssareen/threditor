#!/usr/bin/env node
/**
 * M7 Unit 3: generate placeholder template PNGs + thumbnails.
 *
 * Usage: node scripts/gen-template-placeholders.mjs
 *
 * Writes 64×64 RGBA PNGs to public/templates/{classic,slim}/ and
 * 256×256 PNG thumbnails (not WebP — see note below) to
 * public/templates/thumbs/.
 *
 * Each placeholder is a variant-tinted checkerboard with a subtle
 * per-template hue shift so the Ghost picker's 3 visible cards are
 * visually distinguishable. REAL artwork from the design handoff
 * replaces these; see docs/plans/m7-templates-plan.md Unit 3.
 *
 * Thumbnails are PNG (not WebP) because Node's stdlib lacks a WebP
 * encoder and no new deps are allowed for M7. The manifest's
 * `thumbnail` URLs point to .png files; M8 can re-render to WebP
 * once the real artwork lands.
 */

import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Minimal PNG encoder (RGBA, 8-bit) ────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 'ascii');
  data.copy(buf, 8);
  const crcInput = buf.subarray(4, 8 + len);
  buf.writeUInt32BE(crc32(crcInput), 8 + len);
  return buf;
}

function encodePng(width, height, rgba) {
  // rgba: Uint8Array or Buffer, length width*height*4
  if (rgba.length !== width * height * 4) {
    throw new Error('rgba length mismatch');
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha (RGBA)
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: none
  ihdr[12] = 0; // interlace: no

  // IDAT: per-row filter byte (0 = None) + row pixels
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Placeholder pixel generators ────────────────────────────────────

function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

/** 64×64 RGBA placeholder with variant + hue signature. */
function makePlaceholderPixels(templateId, variant) {
  const size = 64;
  const out = new Uint8Array(size * size * 4);
  // Deterministic hue from templateId hash.
  const hash = createHash('sha256').update(templateId).digest();
  const hue = (hash[0] / 256 + hash[1] / 65536) % 1;
  const [r1, g1, b1] = hslToRgb(hue, 0.55, 0.6);
  const [r2, g2, b2] = hslToRgb(hue, 0.45, 0.3);

  // Minecraft skin atlas regions (approximate; just for placeholder tint).
  // Head: top-left 32x16. Body: 16..40 × 16..32. Arms/legs: rest.
  // We'll do a checkerboard tinted per region so the variant toggle
  // produces visually different renders.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Atlas regions with RGBA: paint the "used" regions; leave the
      // rest transparent.
      const inHead = y < 16 && x < 32;
      const inBody = y >= 16 && y < 32 && x >= 16 && x < 40;
      const inRightArm = y >= 16 && y < 32 && x >= 40 && x < 56;
      const inRightLeg = y >= 16 && y < 32 && x < 16;
      const inLeftArm =
        variant === 'classic'
          ? y >= 48 && y < 64 && x >= 32 && x < 48
          : y >= 48 && y < 64 && x >= 32 && x < 47;
      const inLeftLeg = y >= 48 && y < 64 && x >= 16 && x < 32;
      // Overlays live on mirrored rows; skip for simplicity (transparent).

      const inAny =
        inHead || inBody || inRightArm || inRightLeg || inLeftArm || inLeftLeg;
      if (!inAny) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
        out[i + 3] = 0;
        continue;
      }

      // 2-pixel checkerboard: alternate the two tints per block.
      const block = (Math.floor(x / 2) + Math.floor(y / 2)) & 1;
      const [r, g, b] = block ? [r1, g1, b1] : [r2, g2, b2];
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** 256×256 RGBA thumbnail: just a scaled-up solid panel with the hue. */
function makeThumbnailPixels(templateId) {
  const size = 256;
  const out = new Uint8Array(size * size * 4);
  const hash = createHash('sha256').update(templateId).digest();
  const hue = (hash[0] / 256 + hash[1] / 65536) % 1;
  const [r1, g1, b1] = hslToRgb(hue, 0.5, 0.55);
  const [r2, g2, b2] = hslToRgb(hue, 0.5, 0.35);

  // Large diamond / blocky pattern so thumbnails are obviously placeholders.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const block = (Math.floor(x / 32) + Math.floor(y / 32)) & 1;
      const [r, g, b] = block ? [r1, g1, b1] : [r2, g2, b2];
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

// ── Catalog ──────────────────────────────────────────────────────────

const CATALOG = [
  // Safe Wins
  { id: 'classic-hoodie', variant: 'classic', category: 'safe-wins' },
  { id: 'gamer-tee', variant: 'classic', category: 'safe-wins' },
  { id: 'minimal-black', variant: 'slim', category: 'safe-wins' },
  // Technique
  { id: 'split-color', variant: 'classic', category: 'technique' },
  { id: 'shaded-hoodie', variant: 'classic', category: 'technique' },
  { id: 'armor-lite', variant: 'classic', category: 'technique' },
  { id: 'cartoon-face', variant: 'slim', category: 'technique' },
  // Identity
  { id: 'sports-jersey', variant: 'classic', category: 'identity' },
  { id: 'hoodie-headphones', variant: 'slim', category: 'identity' },
  // Base — shipped as TWO entries per plan D7.
  { id: 'blank-better-classic', variant: 'classic', category: 'base' },
  { id: 'blank-better-slim', variant: 'slim', category: 'base' },
];

for (const t of CATALOG) {
  const pngPath = join(
    ROOT,
    'public/templates',
    t.variant,
    `${t.id.replace(/^blank-better-(classic|slim)$/, 'blank-better')}.png`,
  );
  mkdirSync(dirname(pngPath), { recursive: true });
  const pixels = makePlaceholderPixels(t.id, t.variant);
  const png = encodePng(64, 64, pixels);
  writeFileSync(pngPath, png);
  console.log(`wrote ${pngPath} (${png.length} bytes)`);

  const thumbPath = join(ROOT, 'public/templates/thumbs', `${t.id}.png`);
  mkdirSync(dirname(thumbPath), { recursive: true });
  const thumb = encodePng(256, 256, makeThumbnailPixels(t.id));
  writeFileSync(thumbPath, thumb);
  console.log(`wrote ${thumbPath} (${thumb.length} bytes)`);
}

console.log(`\nDone. ${CATALOG.length} templates, ${CATALOG.length * 2} files.`);
