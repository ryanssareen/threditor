// @vitest-environment node
//
// M11 Unit 1 — tag + name validation helpers.

import { describe, expect, it } from 'vitest';

import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  normalizeTagInput,
  validateName,
  validateTags,
} from '../lib/editor/tags';

describe('normalizeTagInput', () => {
  it('splits by comma + lowercases + trims + drops empties', () => {
    expect(normalizeTagInput('Cool, Cool, cool ,   BLUE,, ')).toEqual([
      'cool',
      'cool',
      'cool',
      'blue',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeTagInput('')).toEqual([]);
    expect(normalizeTagInput('   ,  ,  ')).toEqual([]);
  });
});

describe('validateTags', () => {
  it('dedupes + normalizes a raw string', () => {
    const r = validateTags('Cool, Cool, cool ,   BLUE');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tags).toEqual(['cool', 'blue']);
  });

  it('accepts exactly MAX_TAGS (8) unique items', () => {
    const r = validateTags('a,b,c,d,e,f,g,h');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tags).toHaveLength(8);
  });

  it('rejects 9 unique tags with a clear error', () => {
    const r = validateTags('a,b,c,d,e,f,g,h,i');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`Maximum ${MAX_TAGS}`);
  });

  it('rejects a tag exceeding MAX_TAG_LENGTH', () => {
    const long = 'a'.repeat(MAX_TAG_LENGTH + 1);
    const r = validateTags(long);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`${MAX_TAG_LENGTH} chars`);
  });

  it('accepts an empty tag string (returns empty array)', () => {
    const r = validateTags('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tags).toEqual([]);
  });

  it('accepts an array of tags pre-split', () => {
    const r = validateTags(['Alpha', 'BETA', 'alpha']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tags).toEqual(['alpha', 'beta']);
  });
});

describe('validateName', () => {
  it('trims whitespace', () => {
    const r = validateName('  Cool Skin  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('Cool Skin');
  });

  it('collapses internal whitespace', () => {
    const r = validateName('Cool    Skin');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('Cool Skin');
  });

  it('rejects empty string', () => {
    const r = validateName('');
    expect(r.ok).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    const r = validateName('     ');
    expect(r.ok).toBe(false);
  });

  it('rejects 51-char name', () => {
    const r = validateName('a'.repeat(51));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('50');
  });

  it('accepts 50-char name', () => {
    const r = validateName('a'.repeat(50));
    expect(r.ok).toBe(true);
  });

  it('accepts unicode (emoji etc.)', () => {
    const r = validateName('🐉 Dragon');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('🐉 Dragon');
  });
});
