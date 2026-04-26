/**
 * M14: canonical share-text builder.
 *
 * Two forms:
 *   .short — ≤ 100 chars. Used by Twitter/X intents (the platform eats
 *            the URL + card out of a tweet, so only the prose counts
 *            toward the user's ~280-char composer).
 *   .long  — ≤ 200 chars. Used for `og:description`, `twitter:description`,
 *            LinkedIn share previews, and the native Web Share sheet's
 *            `text` field.
 *
 * Keep deterministic (no `Date.now()`, no RNG) so tests can assert the
 * returned strings directly.
 */

type Skin = {
  name: string;
  ownerUsername: string;
  variant: 'classic' | 'slim';
  likeCount: number;
  tags: readonly string[];
};

export type SkinShareText = {
  short: string;
  long: string;
};

const SHORT_MAX = 100;
const LONG_MAX = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Trim to max-1 then append ellipsis. Trim trailing space so we don't
  // end up with "word …" — keep it snug as "word…".
  return text.slice(0, max - 1).trimEnd() + '…';
}

function pluralise(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function buildSkinShareText(skin: Skin): SkinShareText {
  const hasOwner = skin.ownerUsername.length > 0;
  const ownerPhrase = hasOwner ? ` by ${skin.ownerUsername}` : '';

  const short = truncate(
    `${skin.name}${ownerPhrase} — a ${skin.variant} Minecraft skin`,
    SHORT_MAX,
  );

  // Tag suffix is optional; only render the first 3 so we don't blow
  // past LONG_MAX on tag-heavy skins.
  const topTags = skin.tags.slice(0, 3);
  const tagSuffix = topTags.length > 0 ? ` Tagged ${topTags.join(', ')}.` : '';

  const likeSuffix = ` ${skin.likeCount} ${pluralise(skin.likeCount, 'like', 'likes')}.`;

  const long = truncate(
    `A ${skin.variant} Minecraft skin${ownerPhrase}.${likeSuffix}${tagSuffix}`,
    LONG_MAX,
  );

  return { short, long };
}
