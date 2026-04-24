/**
 * M14: single source of truth for the canonical site origin and related
 * constants used across SEO helpers, OG image URLs, and share intents.
 *
 * Hardcoded rather than read from env so preview deploys (on their own
 * `*-xyz.vercel.app` subdomains) still emit canonical URLs pointing at
 * production — Google should not index preview deploys, and social
 * platforms should not cache preview OG cards.
 */

export const SITE_ORIGIN = 'https://threditor.vercel.app';

export const SITE_NAME = 'threditor';

export const DEFAULT_LOCALE = 'en_US';

/** Canonical permalink for a skin's detail page. */
export function skinPermalink(skinId: string): string {
  return `${SITE_ORIGIN}/skin/${skinId}`;
}

/** Canonical permalink for a user's profile page. */
export function userPermalink(username: string): string {
  return `${SITE_ORIGIN}/u/${username}`;
}
