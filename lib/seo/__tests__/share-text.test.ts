// M14: buildSkinShareText unit tests.

import { describe, expect, it } from 'vitest';

import { buildSkinShareText } from '../share-text';

const SAMPLE = {
  name: 'Shaded Hoodie',
  ownerUsername: 'ryanssareen',
  variant: 'classic' as const,
  likeCount: 17,
  tags: ['hoodie', 'shading'],
};

describe('buildSkinShareText', () => {
  it('produces short form with name, owner, and variant', () => {
    const t = buildSkinShareText(SAMPLE);
    expect(t.short).toContain('Shaded Hoodie');
    expect(t.short).toContain('ryanssareen');
    expect(t.short).toContain('classic');
    expect(t.short).toContain('Minecraft');
    expect(t.short.length).toBeLessThanOrEqual(100);
  });

  it('produces long form with like count + top tags', () => {
    const t = buildSkinShareText(SAMPLE);
    expect(t.long).toContain('17 likes');
    expect(t.long).toContain('hoodie');
    expect(t.long).toContain('shading');
    expect(t.long).toContain('ryanssareen');
    expect(t.long.length).toBeLessThanOrEqual(200);
  });

  it('pluralises 1 like as "1 like"', () => {
    const t = buildSkinShareText({ ...SAMPLE, likeCount: 1 });
    expect(t.long).toContain('1 like');
    expect(t.long).not.toContain('1 likes');
  });

  it('pluralises 0 likes as "0 likes"', () => {
    const t = buildSkinShareText({ ...SAMPLE, likeCount: 0 });
    expect(t.long).toContain('0 likes');
  });

  it('omits tag suffix when tags array is empty', () => {
    const t = buildSkinShareText({ ...SAMPLE, tags: [] });
    expect(t.long).not.toContain('Tagged');
  });

  it('caps tag listing at the first 3 to protect the 200-char ceiling', () => {
    const t = buildSkinShareText({
      ...SAMPLE,
      tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    });
    // Only the first three should appear in the long form.
    expect(t.long).toContain('a, b, c');
    expect(t.long).not.toContain('a, b, c, d');
  });

  it('truncates long form with ellipsis when the composed prose overflows 200 chars', () => {
    // Long form doesn't interpolate name, so overflow comes from a very
    // long ownerUsername or tag list. A 200-char owner makes the
    // resulting string definitively over 200.
    const t = buildSkinShareText({
      ...SAMPLE,
      ownerUsername: 'a'.repeat(200),
    });
    expect(t.long.length).toBeLessThanOrEqual(200);
    expect(t.long.endsWith('…')).toBe(true);
  });

  it('truncates short form with ellipsis when over 100 chars', () => {
    const longName = 'B'.repeat(200);
    const t = buildSkinShareText({ ...SAMPLE, name: longName });
    expect(t.short.length).toBeLessThanOrEqual(100);
    expect(t.short.endsWith('…')).toBe(true);
  });

  it('omits " by {owner}" suffix when ownerUsername is empty', () => {
    const t = buildSkinShareText({ ...SAMPLE, ownerUsername: '' });
    expect(t.short).not.toContain(' by ');
    expect(t.long).not.toContain(' by ');
  });

  it('handles slim variant label', () => {
    const t = buildSkinShareText({ ...SAMPLE, variant: 'slim' });
    expect(t.short).toContain('slim');
    expect(t.long).toContain('slim');
  });

  it('is deterministic (same input → same output)', () => {
    const a = buildSkinShareText(SAMPLE);
    const b = buildSkinShareText(SAMPLE);
    expect(a).toEqual(b);
  });
});
