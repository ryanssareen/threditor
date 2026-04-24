/**
 * M14: pure builder for the Next.js 15 `Metadata` object emitted from
 * the skin permalink route's `generateMetadata()`.
 *
 * Contract:
 *   - Input: a loaded skin shape (plain POJO, no Firestore Timestamps).
 *   - Output: a Metadata object + a JSON-LD payload (built separately
 *     in `skin-jsonld.ts`).
 *
 * The three OG image tiers (see docs/solutions/m14-share-metadata-plan.md
 * §Technical Architecture) are chosen here — we emit
 * `og:image:width`/`og:image:height` only at tier 1, and downgrade the
 * Twitter card to `summary` when we fall back to a thumbnail or raw PNG.
 */
import type { Metadata } from 'next';

import { buildSkinShareText } from './share-text';
import { DEFAULT_LOCALE, SITE_NAME, userPermalink } from './site';

export type SkinForMetadata = {
  id: string;
  name: string;
  ownerUsername: string;
  variant: 'classic' | 'slim';
  storageUrl: string;
  thumbnailUrl: string | null;
  ogImageUrl: string | null;
  tags: readonly string[];
  likeCount: number;
  createdAtMs: number | null;
};

export type OgImageTier =
  | {
      tier: 'og';
      url: string;
      width: 1200;
      height: 630;
      card: 'summary_large_image';
    }
  | { tier: 'thumbnail'; url: string; card: 'summary' }
  | { tier: 'storage'; url: string; card: 'summary' };

const TITLE_MAX = 60;
const OG_TYPE = 'article' as const;

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Pick the best available OG image. Exported so it can be unit-tested
 * directly, and so future consumers (e.g. a gallery-level OG feed) can
 * reuse the tier logic.
 */
export function pickOgImage(skin: SkinForMetadata): OgImageTier {
  if (nonEmpty(skin.ogImageUrl)) {
    return {
      tier: 'og',
      url: skin.ogImageUrl,
      width: 1200,
      height: 630,
      card: 'summary_large_image',
    };
  }
  if (nonEmpty(skin.thumbnailUrl)) {
    return { tier: 'thumbnail', url: skin.thumbnailUrl, card: 'summary' };
  }
  return { tier: 'storage', url: skin.storageUrl, card: 'summary' };
}

function buildTitle(skin: SkinForMetadata): string {
  const hasOwner = skin.ownerUsername.length > 0;
  const raw = hasOwner
    ? `${skin.name} by ${skin.ownerUsername}`
    : skin.name;
  if (raw.length <= TITLE_MAX) return raw;
  return raw.slice(0, TITLE_MAX - 1).trimEnd() + '…';
}

function buildKeywords(skin: SkinForMetadata): string[] {
  const base = ['minecraft', 'skin', skin.variant];
  const normalisedTags = skin.tags
    .filter((t) => typeof t === 'string' && t.length > 0)
    .map((t) => t.toLowerCase());
  // Dedupe: tags like `minecraft` or `classic` shouldn't appear twice.
  return Array.from(new Set([...normalisedTags, ...base]));
}

function buildImageAlt(skin: SkinForMetadata): string {
  const hasOwner = skin.ownerUsername.length > 0;
  const ownerPhrase = hasOwner ? ` by ${skin.ownerUsername}` : '';
  return `${skin.name} — a ${skin.variant} Minecraft skin${ownerPhrase}`;
}

export type BuildSkinMetadataOptions = {
  /** Canonical permalink. Pass `skinPermalink(skin.id)` from the caller. */
  shareUrl: string;
};

export function buildSkinMetadata(
  skin: SkinForMetadata,
  opts: BuildSkinMetadataOptions,
): Metadata {
  const title = buildTitle(skin);
  const { long: description } = buildSkinShareText(skin);
  const image = pickOgImage(skin);
  const alt = buildImageAlt(skin);
  const keywords = buildKeywords(skin);
  const authorUrl = skin.ownerUsername.length > 0
    ? userPermalink(skin.ownerUsername)
    : undefined;
  const publishedTime =
    skin.createdAtMs !== null
      ? new Date(skin.createdAtMs).toISOString()
      : undefined;

  const ogImage =
    image.tier === 'og'
      ? {
          url: image.url,
          width: image.width,
          height: image.height,
          alt,
          type: 'image/webp' as const,
        }
      : { url: image.url, alt };

  return {
    title,
    description,
    keywords,
    alternates: {
      canonical: opts.shareUrl,
    },
    robots: { index: true, follow: true },
    openGraph: {
      type: OG_TYPE,
      title,
      description,
      url: opts.shareUrl,
      siteName: SITE_NAME,
      locale: DEFAULT_LOCALE,
      images: [ogImage],
      // Next.js flattens these into `article:*` meta tags.
      ...(authorUrl !== undefined ? { authors: [authorUrl] } : {}),
      ...(publishedTime !== undefined ? { publishedTime } : {}),
      tags: skin.tags.length > 0 ? [...skin.tags] : undefined,
    },
    twitter: {
      card: image.card,
      title,
      description,
      images: [{ url: image.url, alt }],
    },
  };
}
