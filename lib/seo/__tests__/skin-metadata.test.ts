// M14: buildSkinMetadata + pickOgImage unit tests (Units 1 + 5).

import { describe, expect, it } from 'vitest';

import {
  buildSkinMetadata,
  pickOgImage,
  type SkinForMetadata,
} from '../skin-metadata';
import { SITE_NAME, SITE_ORIGIN } from '../site';

const BASE_SKIN: SkinForMetadata = {
  id: '019dbb09-c521-7665-945f-06fc0de1b27b',
  name: 'Shaded Hoodie',
  ownerUsername: 'ryanssareen',
  variant: 'classic',
  storageUrl: 'https://example.test/skins/019dbb09.png',
  thumbnailUrl: 'https://example.test/skins/019dbb09-thumb.webp',
  ogImageUrl: 'https://example.test/skins/019dbb09-og.webp',
  tags: ['hoodie', 'shading'],
  likeCount: 17,
  createdAtMs: Date.UTC(2026, 3, 20, 14, 32, 0),
};

const SHARE_URL = `${SITE_ORIGIN}/skin/${BASE_SKIN.id}`;

describe('pickOgImage', () => {
  it('returns tier "og" when ogImageUrl is present', () => {
    const r = pickOgImage(BASE_SKIN);
    expect(r.tier).toBe('og');
    expect(r.url).toBe(BASE_SKIN.ogImageUrl);
    if (r.tier === 'og') {
      expect(r.width).toBe(1200);
      expect(r.height).toBe(630);
      expect(r.card).toBe('summary_large_image');
    }
  });

  it('falls back to tier "thumbnail" when ogImageUrl is null', () => {
    const r = pickOgImage({ ...BASE_SKIN, ogImageUrl: null });
    expect(r.tier).toBe('thumbnail');
    expect(r.url).toBe(BASE_SKIN.thumbnailUrl);
    expect(r.card).toBe('summary');
    // Thumbnail tier must NOT carry width/height — 128×128 lying about
    // being 1200×630 breaks Twitter layout.
    expect('width' in r).toBe(false);
    expect('height' in r).toBe(false);
  });

  it('falls back to tier "storage" when both ogImageUrl and thumbnailUrl are null', () => {
    const r = pickOgImage({
      ...BASE_SKIN,
      ogImageUrl: null,
      thumbnailUrl: null,
    });
    expect(r.tier).toBe('storage');
    expect(r.url).toBe(BASE_SKIN.storageUrl);
    expect(r.card).toBe('summary');
    expect('width' in r).toBe(false);
  });

  it('treats empty strings as missing (defensive against bad migrations)', () => {
    const r = pickOgImage({
      ...BASE_SKIN,
      ogImageUrl: '',
      thumbnailUrl: '',
    });
    expect(r.tier).toBe('storage');
  });
});

describe('buildSkinMetadata — happy path', () => {
  const meta = buildSkinMetadata(BASE_SKIN, { shareUrl: SHARE_URL });

  it('emits canonical share URL', () => {
    expect(meta.alternates?.canonical).toBe(SHARE_URL);
  });

  it('emits indexable robots', () => {
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it('emits title with name + owner', () => {
    expect(meta.title).toBe('Shaded Hoodie by ryanssareen');
  });

  it('emits description ≤ 200 chars', () => {
    expect(typeof meta.description).toBe('string');
    expect((meta.description as string).length).toBeLessThanOrEqual(200);
    expect(meta.description).toContain('classic');
  });

  it('emits keywords: tags + minecraft/skin/variant trio, deduped', () => {
    expect(Array.isArray(meta.keywords)).toBe(true);
    expect(meta.keywords).toEqual(expect.arrayContaining([
      'hoodie', 'shading', 'minecraft', 'skin', 'classic',
    ]));
  });

  it('emits openGraph with type=article, siteName, locale, url', () => {
    // OpenGraph is a discriminated union; cast to a generic record to
    // probe fields shared across branches (siteName/locale/url) and
    // the discriminant itself.
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.type).toBe('article');
    expect(og.siteName).toBe(SITE_NAME);
    expect(og.locale).toBe('en_US');
    expect(og.url).toBe(SHARE_URL);
  });

  it('emits openGraph image with width/height/alt/type at tier 1', () => {
    const images = meta.openGraph?.images;
    expect(Array.isArray(images) && images.length === 1).toBe(true);
    const img = (images as Array<Record<string, unknown>>)[0];
    expect(img.url).toBe(BASE_SKIN.ogImageUrl);
    expect(img.width).toBe(1200);
    expect(img.height).toBe(630);
    expect(img.type).toBe('image/webp');
    expect(typeof img.alt).toBe('string');
  });

  it('emits twitter card=summary_large_image at tier 1', () => {
    expect(((meta.twitter as Record<string, unknown>)?.card)).toBe('summary_large_image');
  });

  it('emits openGraph authors (for article:author) pointing at profile URL', () => {
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.authors).toEqual([`${SITE_ORIGIN}/u/ryanssareen`]);
  });

  it('emits openGraph publishedTime as ISO string when createdAtMs present', () => {
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.publishedTime).toBe(new Date(BASE_SKIN.createdAtMs!).toISOString());
  });

  it('emits openGraph tags as a copy of the skin tags', () => {
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.tags).toEqual(['hoodie', 'shading']);
  });
});

describe('buildSkinMetadata — tier-2 fallback (ogImageUrl null)', () => {
  const skin: SkinForMetadata = { ...BASE_SKIN, ogImageUrl: null };
  const meta = buildSkinMetadata(skin, { shareUrl: SHARE_URL });

  it('downgrades twitter card to summary', () => {
    expect(((meta.twitter as Record<string, unknown>)?.card)).toBe('summary');
  });

  it('omits og:image:width/height', () => {
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect(images[0].url).toBe(BASE_SKIN.thumbnailUrl);
    expect('width' in images[0]).toBe(false);
    expect('height' in images[0]).toBe(false);
  });
});

describe('buildSkinMetadata — tier-3 fallback (og + thumbnail both null)', () => {
  const skin: SkinForMetadata = {
    ...BASE_SKIN,
    ogImageUrl: null,
    thumbnailUrl: null,
  };
  const meta = buildSkinMetadata(skin, { shareUrl: SHARE_URL });

  it('uses storageUrl as og:image', () => {
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect(images[0].url).toBe(BASE_SKIN.storageUrl);
  });

  it('twitter card remains summary (not summary_large_image)', () => {
    expect(((meta.twitter as Record<string, unknown>)?.card)).toBe('summary');
  });
});

describe('buildSkinMetadata — edge cases', () => {
  it('truncates title over 60 chars with ellipsis', () => {
    const longName = 'A'.repeat(100);
    const meta = buildSkinMetadata(
      { ...BASE_SKIN, name: longName },
      { shareUrl: SHARE_URL },
    );
    const title = meta.title as string;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to just skin name when ownerUsername is empty', () => {
    const meta = buildSkinMetadata(
      { ...BASE_SKIN, ownerUsername: '' },
      { shareUrl: SHARE_URL },
    );
    expect(meta.title).toBe('Shaded Hoodie');
    // No authors emitted when owner is empty.
    const og = meta.openGraph as Record<string, unknown>;
    expect('authors' in og).toBe(false);
  });

  it('emits only static keywords when tags array is empty', () => {
    const meta = buildSkinMetadata(
      { ...BASE_SKIN, tags: [] },
      { shareUrl: SHARE_URL },
    );
    expect(meta.keywords).toEqual(['minecraft', 'skin', 'classic']);
  });

  it('omits openGraph.tags when tags array is empty', () => {
    const meta = buildSkinMetadata(
      { ...BASE_SKIN, tags: [] },
      { shareUrl: SHARE_URL },
    );
    const og = meta.openGraph as Record<string, unknown>;
    expect(og.tags).toBeUndefined();
  });

  it('omits publishedTime when createdAtMs is null', () => {
    const meta = buildSkinMetadata(
      { ...BASE_SKIN, createdAtMs: null },
      { shareUrl: SHARE_URL },
    );
    const og = meta.openGraph as Record<string, unknown>;
    expect('publishedTime' in og).toBe(false);
  });

  it('dedupes tag-keyword overlap (e.g. if someone tagged "classic")', () => {
    const meta = buildSkinMetadata(
      { ...BASE_SKIN, tags: ['classic', 'minecraft', 'custom'] },
      { shareUrl: SHARE_URL },
    );
    const keywords = meta.keywords as string[];
    // "classic" and "minecraft" should appear exactly once.
    expect(keywords.filter((k) => k === 'classic').length).toBe(1);
    expect(keywords.filter((k) => k === 'minecraft').length).toBe(1);
  });

  it('emits slim variant in keywords + alt text', () => {
    const meta = buildSkinMetadata(
      { ...BASE_SKIN, variant: 'slim' },
      { shareUrl: SHARE_URL },
    );
    expect(meta.keywords).toContain('slim');
    const images = meta.openGraph?.images as Array<Record<string, unknown>>;
    expect((images[0].alt as string)).toContain('slim');
  });

  it('lowercases tag values in keywords defensively', () => {
    const meta = buildSkinMetadata(
      { ...BASE_SKIN, tags: ['Hoodie', 'SHADING'] },
      { shareUrl: SHARE_URL },
    );
    expect(meta.keywords).toEqual(expect.arrayContaining([
      'hoodie', 'shading',
    ]));
    // Uppercase forms should NOT appear.
    expect(meta.keywords).not.toContain('Hoodie');
    expect(meta.keywords).not.toContain('SHADING');
  });
});
