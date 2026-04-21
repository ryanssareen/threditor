/**
 * M7 Unit 3: asset + manifest integration tests.
 *
 * Verifies that the shipped public/templates/manifest.json parses
 * through the Unit 2 validator and that every file + thumbnail URL
 * resolves to an existing file on disk. Also checks each PNG is
 * exactly 64×64 (via PNG IHDR parse).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { normalizeTemplate } from '../lib/editor/templates';
import type { TemplateManifest } from '../lib/editor/types';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const MANIFEST_PATH = join(PROJECT_ROOT, 'public/templates/manifest.json');

function loadManifestFromDisk(): TemplateManifest {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as unknown;
  return raw as TemplateManifest;
}

function resolvePublicUrl(url: string): string {
  // /templates/foo → public/templates/foo
  return join(PROJECT_ROOT, 'public', url);
}

/** Parse the PNG IHDR (bytes 16..23) to read width + height. */
function pngDimensions(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  if (buf.length < 24) throw new Error(`${path}: too short to be a PNG`);
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error(`${path}: bad PNG signature`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('M7 Unit 3 — shipped template assets', () => {
  const manifest = loadManifestFromDisk();

  it('manifest.json exists and has version 1', () => {
    expect(manifest.version).toBe(1);
  });

  it('manifest has exactly 4 categories', () => {
    expect(manifest.categories.length).toBe(4);
    const ids = manifest.categories.map((c) => c.id).sort();
    expect(ids).toEqual(['base', 'identity', 'safe-wins', 'technique']);
  });

  it('manifest contains exactly 11 templates (10 distinct + blank-better split by variant)', () => {
    const total = manifest.categories.reduce((n, c) => n + c.templates.length, 0);
    expect(total).toBe(11);
  });

  it('every template passes the Unit 2 validator', () => {
    for (const cat of manifest.categories) {
      for (const raw of cat.templates) {
        const normalized = normalizeTemplate(raw);
        expect(normalized).not.toBeNull();
      }
    }
  });

  it('every template file URL resolves to an existing 64×64 PNG on disk', () => {
    for (const cat of manifest.categories) {
      for (const t of cat.templates) {
        const absPath = resolvePublicUrl(t.file);
        expect(existsSync(absPath), `missing ${t.file}`).toBe(true);
        const dims = pngDimensions(absPath);
        expect(dims.width).toBe(64);
        expect(dims.height).toBe(64);
      }
    }
  });

  it('every thumbnail URL resolves to an existing file on disk', () => {
    for (const cat of manifest.categories) {
      for (const t of cat.templates) {
        const absPath = resolvePublicUrl(t.thumbnail);
        expect(existsSync(absPath), `missing ${t.thumbnail}`).toBe(true);
        // Size sanity: non-zero and under 1MB (generous for future real art).
        const size = statSync(absPath).size;
        expect(size).toBeGreaterThan(0);
        expect(size).toBeLessThan(1024 * 1024);
      }
    }
  });

  it('every template has exactly one variant matching DESIGN §5.1 spec', () => {
    for (const cat of manifest.categories) {
      for (const t of cat.templates) {
        expect(['classic', 'slim']).toContain(t.variant);
      }
    }
  });

  it('blank-better ships as two variant-specific manifest entries (plan D7)', () => {
    const baseCat = manifest.categories.find((c) => c.id === 'base');
    expect(baseCat).toBeDefined();
    const ids = baseCat!.templates.map((t) => t.id).sort();
    expect(ids).toEqual(['blank-better-classic', 'blank-better-slim']);
    const variants = baseCat!.templates.map((t) => t.variant).sort();
    expect(variants).toEqual(['classic', 'slim']);
  });
});
