/**
 * M14: schema.org JSON-LD payload for a skin permalink.
 *
 * Rendered as a `<script type="application/ld+json">` in the page body.
 * Uses `ImageObject` rather than `CreativeWork` because Google's Rich
 * Results test picks it up more reliably, and a Minecraft skin texture
 * fits the ImageObject model better (it IS an image that happens to be
 * a skin atlas).
 *
 * Interaction statistic (likeCount) is emitted even when count is 0 —
 * Google accepts it and it keeps the schema shape stable across skins.
 */

import { SITE_ORIGIN, userPermalink } from './site';

export type SkinForJsonLd = {
  id: string;
  name: string;
  ownerUsername: string;
  storageUrl: string;
  thumbnailUrl: string | null;
  ogImageUrl: string | null;
  tags: readonly string[];
  likeCount: number;
  createdAtMs: number | null;
};

type Creator = {
  '@type': 'Person';
  name: string;
  url: string;
};

type InteractionStat = {
  '@type': 'InteractionCounter';
  interactionType: 'https://schema.org/LikeAction';
  userInteractionCount: number;
};

export type SkinJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'ImageObject';
  contentUrl: string;
  thumbnailUrl: string;
  name: string;
  url: string;
  license: string;
  keywords?: string;
  datePublished?: string;
  creator?: Creator;
  interactionStatistic: InteractionStat;
};

export function buildSkinJsonLd(skin: SkinForJsonLd): SkinJsonLd {
  const contentUrl = skin.ogImageUrl ?? skin.storageUrl;
  const thumbnailUrl = skin.thumbnailUrl ?? skin.storageUrl;

  const base: SkinJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ImageObject',
    contentUrl,
    thumbnailUrl,
    name: skin.name,
    url: `${SITE_ORIGIN}/skin/${skin.id}`,
    license: 'https://opensource.org/licenses/MIT',
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: 'https://schema.org/LikeAction',
      userInteractionCount: skin.likeCount,
    },
  };

  if (skin.tags.length > 0) {
    base.keywords = skin.tags.join(', ');
  }
  if (skin.createdAtMs !== null) {
    base.datePublished = new Date(skin.createdAtMs).toISOString();
  }
  if (skin.ownerUsername.length > 0) {
    base.creator = {
      '@type': 'Person',
      name: skin.ownerUsername,
      url: userPermalink(skin.ownerUsername),
    };
  }

  return base;
}

/**
 * Serialise a JSON-LD object for embedding in an HTML `<script>` tag.
 *
 * Critical: `</script>` inside the JSON would break out of the script
 * tag. `JSON.stringify` does NOT escape this. We manually replace `<`
 * with the `\u003c` escape sequence, which is valid inside a JSON
 * string but inert inside an HTML tokenizer.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
