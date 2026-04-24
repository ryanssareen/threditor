# Social Preview Testing Runbook

**Purpose:** canonical "how do I check my share card?" reference. Use
after any change to `lib/seo/*`, `generateMetadata` on permalink
routes, or the OG image pipeline. Social platforms cache OG data for
7–30 days — validating on the preview deploy (or the first request
after merge) is the only way to avoid shipping a broken card to every
shared URL for the next month.

## When to run this

- Before landing any PR that touches `lib/seo/skin-metadata.ts`,
  `lib/seo/skin-jsonld.ts`, `generateMetadata` in
  `/skin/[skinId]/page.tsx` or `/u/[username]/page.tsx`, or
  `lib/editor/og-image.ts`.
- After deploying to production, on one known-good and one known-bad
  (OG missing) sample skin.
- Whenever a user reports that a shared link looks wrong on a specific
  platform.

## Sample inputs

Pick one skin from Firestore that has a populated `ogImageUrl` (tier-1
path). If you want to exercise the fallback ladder, pick (or
temporarily patch) a skin with `ogImageUrl: null` + a populated
`thumbnailUrl` (tier-2 path), and one with both null (tier-3).

```
tier-1 (healthy): https://threditor.vercel.app/skin/<id-with-og>
tier-2 (thumb):   https://threditor.vercel.app/skin/<id-og-null>
tier-3 (raw):     https://threditor.vercel.app/skin/<id-thumb-null>
```

## Validator checklist

For each permalink, run every validator below. Record pass/fail in the
PR description (or the post-deploy monitoring section of the PR). A
short `[P]` or `[F]` with a one-line note per row is enough.

### 1. Twitter / X Card Validator

- URL: `https://cards.x-dev.pages.dev/validate`
  (the classic `cards-dev.twitter.com/validator` redirects here).
- Expected (tier 1): `summary_large_image` card renders with the
  1200×630 OG image, the full title, and the description.
- Expected (tier 2/3): `summary` card with a small square image.

### 2. Facebook Sharing Debugger

- URL: `https://developers.facebook.com/tools/debug/`
- Paste the permalink, click **Scrape Again** if the fetch looks stale.
- Expected: every `og:*` property detected; no warnings in the
  "Warnings That Should Be Fixed" box. `og:type=article`,
  `og:image:width=1200`, `og:image:height=630` on tier-1 skins.

### 3. LinkedIn Post Inspector

- URL: `https://www.linkedin.com/post-inspector/`
- Expected: preview renders with image + title + description.
  LinkedIn is the pickiest about image dimensions — tier-2 / tier-3
  may be rejected.

### 4. Discord

- Paste the URL in any Discord channel or DM-to-self. Expected:
  embed with large image, title, description; left sidebar color
  matches the page's accent (`#00E5FF` — we don't explicitly set
  `theme-color` yet, so Discord falls back to a default).
- DM-to-self is the fastest way to test iteratively without spamming
  a real channel.

### 5. Slack

- Paste the URL in a test channel. Expected: unfurl with large image,
  title, description. Slack caches aggressively; use the three-dot
  menu → **Remove attachment** to force a re-unfurl after edits.

### 6. Meta Tags (metatags.io)

- URL: `https://metatags.io/`
- Expected: all platforms' cards render side-by-side in the preview
  pane. Useful for a one-shot visual sanity check before going to
  each platform individually.

### 7. Google Rich Results Test

- URL: `https://search.google.com/test/rich-results`
- Expected: one detected `ImageObject`, zero errors, zero warnings.
- Google doesn't show `ImageObject` as a rich-result snippet in SERPs
  today, but validating ensures the JSON-LD is well-formed.

## Force-refresh cheat sheet

| Platform | How to invalidate its cache |
|---|---|
| Twitter / X | First tweet containing the URL re-scrapes. No manual tool — old tweets keep the stale card. |
| Facebook | Sharing Debugger → **Scrape Again** button. |
| LinkedIn | Post Inspector pulls fresh each run; live posts keep stale card until re-shared. |
| Discord | Delete + re-post the message. |
| Slack | Remove attachment + re-post the link, or wait ~1 hour. |

## Known quirks

- **Safari on macOS** doesn't always expose `navigator.share`;
  `canShare({ url })` returns false for `http:` origins. Test on HTTPS.
- **Twitter's image cache is CDN-side and takes 5–10 minutes** to
  refresh after a validator run. Don't panic if the first tweet shows
  the previous image.
- **LinkedIn rejects `image/webp`** on some enterprise tenants. Not
  observed in our production tenant, but documented here in case it
  surfaces.
- **Discord's preview widget doesn't re-fetch OG on edit** — edit the
  message and the preview stays, even if the target URL's tags
  changed. Paste a fresh copy instead.
