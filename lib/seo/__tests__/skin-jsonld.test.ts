// M14 Unit 3: JSON-LD builder tests.

import { describe, expect, it } from 'vitest';

import {
  buildSkinJsonLd,
  serializeJsonLd,
  type SkinForJsonLd,
} from '../skin-jsonld';
import { SITE_ORIGIN } from '../site';

const BASE: SkinForJsonLd = {
  id: '019dbb09-c521-7665-945f-06fc0de1b27b',
  name: 'Shaded Hoodie',
  ownerUsername: 'ryanssareen',
  storageUrl: 'https://example.test/skin.png',
  thumbnailUrl: 'https://example.test/thumb.webp',
  ogImageUrl: 'https://example.test/og.webp',
  tags: ['hoodie', 'shading'],
  likeCount: 17,
  createdAtMs: Date.UTC(2026, 3, 20, 14, 32, 0),
};

describe('buildSkinJsonLd', () => {
  it('builds an ImageObject with the expected top-level fields', () => {
    const ld = buildSkinJsonLd(BASE);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('ImageObject');
    expect(ld.name).toBe(BASE.name);
    expect(ld.url).toBe(`${SITE_ORIGIN}/skin/${BASE.id}`);
    expect(ld.license).toBe('https://opensource.org/licenses/MIT');
  });

  it('uses ogImageUrl as contentUrl when available', () => {
    const ld = buildSkinJsonLd(BASE);
    expect(ld.contentUrl).toBe(BASE.ogImageUrl);
  });

  it('falls back to storageUrl when ogImageUrl is null', () => {
    const ld = buildSkinJsonLd({ ...BASE, ogImageUrl: null });
    expect(ld.contentUrl).toBe(BASE.storageUrl);
  });

  it('uses thumbnailUrl when available, else storageUrl', () => {
    const withThumb = buildSkinJsonLd(BASE);
    expect(withThumb.thumbnailUrl).toBe(BASE.thumbnailUrl);

    const noThumb = buildSkinJsonLd({ ...BASE, thumbnailUrl: null });
    expect(noThumb.thumbnailUrl).toBe(BASE.storageUrl);
  });

  it('emits creator as nested Person with profile URL', () => {
    const ld = buildSkinJsonLd(BASE);
    expect(ld.creator).toEqual({
      '@type': 'Person',
      name: 'ryanssareen',
      url: `${SITE_ORIGIN}/u/ryanssareen`,
    });
  });

  it('omits creator entirely when ownerUsername is empty', () => {
    const ld = buildSkinJsonLd({ ...BASE, ownerUsername: '' });
    expect(ld.creator).toBeUndefined();
  });

  it('emits datePublished as ISO string when createdAtMs is present', () => {
    const ld = buildSkinJsonLd(BASE);
    expect(ld.datePublished).toBe(new Date(BASE.createdAtMs!).toISOString());
  });

  it('omits datePublished when createdAtMs is null', () => {
    const ld = buildSkinJsonLd({ ...BASE, createdAtMs: null });
    expect(ld.datePublished).toBeUndefined();
  });

  it('emits keywords as comma-joined tag string', () => {
    const ld = buildSkinJsonLd(BASE);
    expect(ld.keywords).toBe('hoodie, shading');
  });

  it('omits keywords when tags array is empty', () => {
    const ld = buildSkinJsonLd({ ...BASE, tags: [] });
    expect(ld.keywords).toBeUndefined();
  });

  it('always emits interactionStatistic, even at likeCount=0', () => {
    const ld = buildSkinJsonLd({ ...BASE, likeCount: 0 });
    expect(ld.interactionStatistic).toEqual({
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/LikeAction',
      userInteractionCount: 0,
    });
  });
});

describe('serializeJsonLd (script-tag escape)', () => {
  it('produces parseable JSON', () => {
    const ld = buildSkinJsonLd(BASE);
    const serialized = serializeJsonLd(ld);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });

  it('round-trips back to the same object', () => {
    const ld = buildSkinJsonLd(BASE);
    const serialized = serializeJsonLd(ld);
    expect(JSON.parse(serialized)).toEqual(ld);
  });

  it('escapes `<` so a skin name containing </script> cannot break out', () => {
    const hostile = buildSkinJsonLd({
      ...BASE,
      name: 'Evil </script><script>alert(1)</script>',
    });
    const serialized = serializeJsonLd(hostile);
    // No raw `<` characters should appear in the output — each is
    // escaped to `\u003c`. `>` is intentionally left alone since the
    // HTML tokenizer can't close a script tag using `>` alone.
    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<script>');
    expect(serialized).toContain('\\u003c/script');
    expect(serialized).toContain('\\u003cscript');
    // Parse should still succeed and recover the original string.
    expect(JSON.parse(serialized).name).toBe(
      'Evil </script><script>alert(1)</script>',
    );
  });
});
