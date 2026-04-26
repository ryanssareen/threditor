---
title: "M14: Share Metadata & Social Previews"
type: feat
status: active
date: 2026-04-24
origin: docs/solutions/m14-share-metadata-planning-prompt.md
---

# M14: Share Metadata — Implementation Plan

## Executive Summary

Threditor's skin-permalink route already emits a minimal `generateMetadata()`
(title, description, a single `og:image`, a `summary_large_image` twitter
card). Everything downstream of that minimum — the Open Graph properties
that make Facebook/LinkedIn/Discord/Slack render a rich card, the
dimension hints Twitter needs to pick a large card, the canonical URL
that prevents duplicate-URL penalties, structured data for SEO, and an
affordance to share the URL itself — is missing. M14 fills that gap and
adds a first-class Share button to the detail page.

**Why it matters.** Threditor has no paid acquisition. Organic loops
(Discord embeds, Twitter/X quote posts, Reddit cross-posts) are the only
distribution surface. Every unshared permalink is a missed loop. M14
makes the permalink self-selling: the OG card pitches the skin; the
share button closes the gap between "nice skin" and "post this".

**Key technical approach.** All work happens inside Next.js 15
`generateMetadata()` on the existing `/skin/[skinId]` route — no new
routes, no new storage fields (the Firestore `ogImageUrl` field already
exists from M11, and is populated for all non-legacy skins). The share
button is a small client component that prefers the Web Share API on
touch devices and falls back to a desktop menu of platform-specific
intent URLs plus copy-to-clipboard. Zero server cost, zero new
infrastructure — consistent with the Vercel Hobby + Firebase Spark
$0-budget constraint.

---

## Prerequisites Verification

Confirmed during research before plan was written. Each box is a
precondition M14 relies on; if any one flips false, the affected unit's
approach changes.

- [x] **M11 OG pipeline ships OG images.** `lib/editor/og-image.ts`
      exists, generates 1200×630 WebP @ 0.85 client-side, uploads to
      Supabase Storage at `{uid}/{skinId}-og.webp`. Confirmed in
      COMPOUND.md §M11 and `lib/supabase/storage-server.ts:61-140`.
- [x] **Firestore `SharedSkin.ogImageUrl` field exists and is
      populated.** `lib/firebase/types.ts:51` types it as `string`
      (non-null), but both `lib/firebase/skins.ts:36` and
      `lib/firebase/gallery.ts:36` relax to `string | null` at the
      runtime layer to handle WebGL-failure fallbacks. Plan treats it
      as nullable on the consumer side (detail page).
- [x] **Supabase `skins` bucket is public** (M13.1 fix). Public URLs of
      the form `https://<project>.supabase.co/storage/v1/object/public/skins/<uid>/<skinId>-og.webp`
      resolve without authentication — required for social crawlers
      (no auth tokens, no cookies).
- [x] **M13 SSR + CDN caching pattern exists.** `/u/[username]` uses
      `force-dynamic` + middleware-owned `Cache-Control` headers.
      Same pattern transfers to `/skin/[skinId]` if/when we need CDN
      caching here (currently `force-dynamic` without middleware — see
      §Technical Architecture for whether to add it).
- [x] **M13 JSON-LD pattern exists.** `/u/[username]/page.tsx:155-180`
      embeds a `ProfilePage` JSON-LD script via
      `dangerouslySetInnerHTML`. M14 reuses this shape for the skin
      with `@type: ImageObject` + nested `Person` for the creator.
- [x] **Site origin is stable.** `https://threditor.vercel.app` is
      hardcoded in `/u/[username]/page.tsx:53` as `SITE_ORIGIN`. M14
      extracts this into `lib/seo/site.ts` so the skin page, profile
      page, and any future route all agree. No custom-domain plans in
      DESIGN.md that would invalidate this.

Nothing else needs to ship before M14 starts.

---

## Technical Architecture

### Meta-tag generation flow

```
Request → /skin/[skinId]
     ↓
generateMetadata({ params })
     ↓
loadSkin(skinId)                   (1 Firestore read, admin SDK, nodejs runtime)
     ↓
buildMetadata(skin)                (pure, lib/seo/skin-metadata.ts)
     ↓                              ├─ title
     ↓                              ├─ description
     ↓                              ├─ keywords    (from tags)
     ↓                              ├─ alternates.canonical
     ↓                              ├─ openGraph   (type/url/siteName/images…)
     ↓                              ├─ twitter     (card/site/creator/images…)
     ↓                              └─ robots
     ↓
<head> emitted by Next.js SSR
     +
Inline <script type="application/ld+json">   (dangerouslySetInnerHTML)
```

**Separation of concerns.** The page stays a thin orchestration layer:
read skin → call `buildMetadata(skin)` → render. The *shape* of the
metadata lives in `lib/seo/skin-metadata.ts` so it can be unit-tested
without mounting the page, and so future routes (e.g., a `/gallery`
OG card when M15 lands) can share the helper.

### Share-button flow

```
Click "Share"  ──┬── navigator.share supported?
                 │        yes → native sheet (mobile, modern Safari)
                 │        no  → platform menu (desktop)
                 │
                 └── Menu items:
                        ├─ Copy link         (navigator.clipboard.writeText)
                        ├─ Twitter / X       (intent URL)
                        ├─ Facebook          (share dialog URL)
                        ├─ Reddit            (submit URL)
                        ├─ LinkedIn          (share-offsite URL)
                        └─ Discord           (copy link + toast "Paste in Discord")
```

**Client/server boundary.** The button is a client component
(`'use client'`) colocated with the skin detail page at
`app/skin/[skinId]/_components/ShareButton.tsx` — mirrors the existing
`SkinDetailPreview.tsx` pattern. The page (a Server Component) passes
pre-computed `shareUrl` + `shareText` down as props, so the client never
has to know anything about `generateMetadata` or the site origin.

### OG image fallback ladder

Three tiers, evaluated in order:

| Rank | Source | Dimensions | Card kind | When used |
|------|--------|-----------|-----------|-----------|
| 1 | `skin.ogImageUrl` | 1200×630 | `summary_large_image` | Normal publish |
| 2 | `skin.thumbnailUrl` | 128×128 | `summary` | OG gen failed at publish time; thumbnail exists |
| 3 | `skin.storageUrl` | 64×64 | `summary` | Both above missing (legacy pre-M12 rows) |

Tier-1 is the desired path for ~100% of recent skins. Tier-2/3 exist so
that a crawler gets *something* rather than a broken preview. We **do
not** emit `og:image:width`/`og:image:height` when we fall back to
tiers 2 or 3 — a 64×64 image lying about being 1200×630 is worse than
no dimension hint at all.

### Why we do NOT add middleware CDN caching to `/skin/[skinId]` in M14

M13 added `Cache-Control: s-maxage=300, stale-while-revalidate=600` to
`/u/:path*` via middleware because profiles are low-traffic-per-URL +
per-user (N URLs). Skin permalinks have the same pattern (one URL per
skin, long tail of traffic). But adding CDN caching here touches the
meta-tag invalidation story — if a user edits the skin's name, the
cached HTML has the old name and the old `<title>`/`<meta>`, which
propagates into social caches that are *much* harder to invalidate
than our own CDN. M14 keeps `/skin/[skinId]` as `force-dynamic` (no
middleware). A future M15 "edit skin metadata" unit can revisit this
once we have an invalidation story (`revalidatePath` from the PATCH
route).

### Runtime & caching constraints

- `runtime: 'nodejs'` — required by Admin SDK. Unchanged.
- `dynamic: 'force-dynamic'` — unchanged. Skin detail stays per-request
  (see above) until we have an invalidation story.
- No middleware entry added to `middleware.ts` for this route.
- The `metadataBase` field in `layout.tsx` will be set once so relative
  URLs in `openGraph.images` resolve against the canonical origin —
  removes an invisible footgun when staging/preview deploys produce
  `vercel.app` subdomain OG URLs.

---

## Implementation Units

Unit 0 is exploration-only (no code). Units 1–5 each land as one atomic
commit. Unit 6 is documentation + a manual QA sweep.

- [ ] **Unit 0: Research & verification (no code)**

**Goal:** Confirm every prerequisite above still holds on the
branch-of-day, and capture a concrete "sample skin" for Unit-6 manual
QA. Produces no code — consumes 20 minutes of Firestore + Supabase
inspection.

**Dependencies:** None.

**Files:**
- Read-only: `lib/firebase/skins.ts`, `lib/firebase/gallery.ts`,
  `lib/supabase/storage-server.ts`, three production skin docs in
  Firestore (check each has `ogImageUrl` populated + the URL returns
  a 200).

**Approach:**
- Pull the three most-recent `/skins/*` docs via the Firebase Console.
- For each, `curl -I` the `ogImageUrl`. Expect 200 OK + `content-type:
  image/webp`. If any is null or 404s, document the gap and expand
  Unit 5's fallback unit-test matrix.
- Record one skinId with a healthy OG image → Unit 6 uses it as the
  "known-good sample" for the social validators.
- Confirm `SITE_ORIGIN` literal matches `vercel.json`'s production
  alias (it's `threditor.vercel.app` per `/u/[username]/page.tsx:53`).

**Verification:**
- All three sampled skins have reachable OG images, OR the gap is
  documented as a deliberate Unit-5 test case.

---

- [ ] **Unit 1: Shared SEO helpers — `lib/seo/`**

**Goal:** Extract a single source of truth for `SITE_ORIGIN`, a
pure `buildSkinMetadata(skin)` function that returns a Next.js
`Metadata` object, and a pure `buildSkinShareText(skin)` helper used
by both the meta-tag description and the share button's intent URLs.

**Dependencies:** Unit 0.

**Files:**
- Create: `lib/seo/site.ts` — exports `SITE_ORIGIN`, `SITE_NAME`,
  `DEFAULT_LOCALE`, `skinPermalink(skinId)`.
- Create: `lib/seo/skin-metadata.ts` — exports `buildSkinMetadata()`.
- Create: `lib/seo/share-text.ts` — exports `buildSkinShareText()`.
- Test: `lib/seo/__tests__/skin-metadata.test.ts`.
- Test: `lib/seo/__tests__/share-text.test.ts`.
- Modify: `app/u/[username]/page.tsx` — replace inline `SITE_ORIGIN`
  with import from `lib/seo/site.ts` (only if the modification is a
  single-line change; otherwise defer to M15 to avoid scope creep).
- Modify: `app/layout.tsx` — add `metadataBase: new URL(SITE_ORIGIN)`
  to the exported `metadata` so relative image URLs resolve.

**Approach:**
- `buildSkinMetadata(skin, { shareUrl })` takes the loaded skin and
  the already-computed share URL (so the page owns URL construction
  once), returns the full `Metadata` shape including:
  - `title` — `${skin.name} by ${skin.ownerUsername}`
  - `description` — via `buildSkinShareText(skin).long`
  - `keywords` — `skin.tags` + `['minecraft', 'skin', skin.variant]`
  - `alternates.canonical` — `shareUrl`
  - `openGraph` — full payload (see Meta Tag Schema)
  - `twitter` — full payload (see Meta Tag Schema)
  - `robots` — `{ index: true, follow: true }`
- The OG image tier (tier-1/2/3 from §Technical Architecture) is
  selected inside `buildSkinMetadata` via a small `pickOgImage(skin)`
  helper that returns `{ url, width, height, card }`. Width/height are
  only emitted when the tier provides them.
- `buildSkinShareText` returns an object with two keys:
  - `.short` — ≤ 100 chars, for Twitter/X intent URLs (Twitter eats
    the URL out of a share so we only count the prose).
  - `.long` — up to 200 chars, used for `description` and LinkedIn.
- Keep the helpers deterministic — no `Date.now()`, no random — so
  tests are straightforward snapshot-style asserts on the returned
  object shape.

**Patterns to follow:**
- `generateMetadata` pattern in `/u/[username]/page.tsx:108-142`.
- Pure-helper-with-unit-tests pattern in `lib/firebase/profile.ts` +
  `lib/firebase/__tests__/profile.test.ts`.

**Test scenarios:**
- *Happy path* — skin with all fields populated (ogImageUrl, tags,
  displayName): emits `summary_large_image` card with
  `og:image:width=1200, og:image:height=630`, canonical URL equals
  `${SITE_ORIGIN}/skin/${id}`, keywords include every tag.
- *Edge case* — skin with empty tags array: `keywords` falls back to
  the static minecraft/skin/variant trio, does not include trailing
  empty string or "undefined".
- *Edge case* — `ogImageUrl === null` + thumbnail present: tier-2
  path, emits `summary` card (not `summary_large_image`), does NOT
  emit `og:image:width`/`height`.
- *Edge case* — `ogImageUrl === null` + `thumbnailUrl === null`
  (pre-M12 legacy row): tier-3 path, uses `storageUrl` as the image,
  emits `summary` card.
- *Edge case* — `skin.name` contains quotes / `<` / angle brackets:
  `buildSkinShareText` returns a string that, when interpolated into
  an HTML `<meta content="...">` attribute by React, escapes correctly.
  (React auto-escapes — test asserts no manual escape double-application.)
- *Edge case* — `skin.name.length > 60`: title truncates to 60 chars
  with `…` suffix (Twitter clips at 70, Discord at ~256; 60 is
  conservative).
- *Edge case* — `skin.tags` includes a tag with emoji / mixed case:
  `keywords` lowercases (tags are already lowercased in Firestore per
  M11 invariant, but the helper is defensive).
- *Edge case* — `skin.ownerUsername === ''` (defensive; shouldn't
  happen per M13 fixes): title falls back to just `skin.name`,
  description omits the "by {owner}" suffix.

**Verification:**
- All listed test scenarios pass via `npx vitest run lib/seo`.
- `npx tsc --noEmit` clean.

---

- [ ] **Unit 2: Wire new metadata helper into `/skin/[skinId]`**

**Goal:** Replace the five-field `generateMetadata` currently on the
skin detail page with a one-line call into `buildSkinMetadata`.

**Dependencies:** Unit 1.

**Files:**
- Modify: `app/skin/[skinId]/page.tsx`.
- Test: `app/skin/[skinId]/__tests__/metadata.test.ts` (new).

**Approach:**
- `generateMetadata` becomes: load the skin, build `shareUrl` via
  `skinPermalink(skinId)`, return `buildSkinMetadata(skin, {shareUrl})`.
  The "skin not found" branch still returns `{ title: 'Skin not found
  · Threditor', robots: { index: false } }` — unchanged.
- The page body (rendered HTML) is not modified in this unit — only
  `<head>`. Leaving the body alone keeps the commit small and the
  review focused.

**Patterns to follow:**
- The `/u/[username]` generateMetadata landing pattern (loads profile
  once in metadata, once in body; both call the same `loadProfile`
  that returns `null` on miss — Next dedupes the Firestore read
  across `generateMetadata` + page). We get this dedup for free with
  React's `cache()` on `loadSkin`; add it if not already.

**Test scenarios:**
- *Happy path* — calling the exported `generateMetadata` with a stub
  that returns a full skin returns a `Metadata` object with
  `openGraph.images[0].url === skin.ogImageUrl`.
- *Integration* — the loader is called exactly once when both
  `generateMetadata` and the page body run in the same request (React
  `cache()` dedup).
- *Error path* — loader returns `null`: metadata has
  `robots.index === false` so 404s don't get indexed.

**Verification:**
- `/skin/<known-good-id>` rendered in `preview_start` + fetched via
  `curl -s ...` contains: `og:title`, `og:description`, `og:image`,
  `og:image:width`, `og:image:height`, `og:type=article`,
  `og:site_name=threditor`, `twitter:card=summary_large_image`,
  `link rel=canonical`, and the JSON-LD script (Unit 3 — tested
  after Unit 3 lands).
- Existing skin-detail tests still pass.

---

- [ ] **Unit 3: JSON-LD structured data on `/skin/[skinId]`**

**Goal:** Inline a `<script type="application/ld+json">` that
represents the skin as a schema.org entity, mirroring the `/u/[username]`
pattern.

**Dependencies:** Unit 2.

**Files:**
- Modify: `app/skin/[skinId]/page.tsx`.
- Create: `lib/seo/skin-jsonld.ts` — exports `buildSkinJsonLd(skin)`.
- Test: `lib/seo/__tests__/skin-jsonld.test.ts`.

**Approach:**
- Emit a single `ImageObject` node:
  - `@context: https://schema.org`
  - `@type: ImageObject` (better than `CreativeWork` for a paintable
    texture; validated against Google's Rich Results test)
  - `contentUrl: skin.ogImageUrl ?? storageUrl`
  - `thumbnailUrl: skin.thumbnailUrl ?? storageUrl`
  - `name: skin.name`
  - `keywords: skin.tags.join(', ')`
  - `datePublished: new Date(createdAtMs).toISOString()` when
    available
  - `creator: { @type: Person, name: ownerUsername, url:
    ${SITE_ORIGIN}/u/${ownerUsername} }`
  - `license: https://opensource.org/licenses/MIT` (project LICENSE;
    user's implicit grant is "published to the public gallery")
  - `interactionStatistic: { @type: InteractionCounter,
    interactionType: https://schema.org/LikeAction, userInteractionCount:
    skin.likeCount }` — Google's Rich Results picks this up for
    engagement-surfaced cards.
- Render inside the page body (top of `<main>`) via
  `dangerouslySetInnerHTML`. React JSX inside `<script>` doesn't work
  — `dangerouslySetInnerHTML` is unavoidable for JSON-LD and the
  data we interpolate is server-controlled.

**Patterns to follow:**
- `/u/[username]/page.tsx:155-180` ProfilePage JSON-LD.

**Test scenarios:**
- *Happy path* — full skin → returns a parseable JSON-LD object with
  every expected key.
- *Edge case* — `createdAt === null`: `datePublished` omitted (not
  emitted as `null` or `undefined`).
- *Edge case* — `likeCount === 0`: `interactionStatistic` still
  emitted with count 0 (Google accepts 0).
- *Integration* — rendered page HTML contains exactly one
  `<script type="application/ld+json">` and its JSON parses without
  error.
- *Edge case* — skin name contains `</script>`: the serializer
  escapes it (via `JSON.stringify` + a final `.replace(/</g, '\\u003c')`
  pass so a malicious name can't break out of the script tag).

**Verification:**
- `curl -s $URL | grep -A1 ld+json` returns valid JSON.
- Paste the skin URL into Google's Rich Results test
  (https://search.google.com/test/rich-results) — expects zero
  errors, one detected `ImageObject`.

---

- [ ] **Unit 4: Share button component**

**Goal:** Add a visible "Share" button to the skin detail page that
either opens the native share sheet (Web Share API) or reveals a
menu of platform-specific share intents.

**Dependencies:** Unit 1 (needs `buildSkinShareText`).

**Files:**
- Create: `app/skin/[skinId]/_components/ShareButton.tsx`.
- Create: `app/skin/[skinId]/_components/ShareMenu.tsx` (co-located;
  controlled by ShareButton).
- Create: `lib/seo/share-intents.ts` — pure helpers that build the
  platform intent URLs.
- Test: `lib/seo/__tests__/share-intents.test.ts`.
- Test: `app/skin/[skinId]/_components/__tests__/ShareButton.test.tsx`.
- Modify: `app/skin/[skinId]/page.tsx` — render `<ShareButton
  shareUrl={...} shareText={...} skinName={skin.name} />` next to
  the existing Download PNG anchor.

**Approach:**
- `ShareButton` is a client component. Props:
  - `shareUrl: string` (the full permalink — `${SITE_ORIGIN}/skin/${id}`)
  - `shareText: { short: string; long: string }` (from
    `buildSkinShareText`)
  - `skinName: string` (used for native share sheet's `title` field)
- On mount, feature-detect `navigator.share` **and**
  `navigator.canShare({ url: shareUrl })` — the latter is what
  Safari/iOS returns for "this URL is shareable". If both truthy:
  clicking the button calls `navigator.share({ title: skinName,
  text: shareText.short, url: shareUrl })` and short-circuits the menu.
- On platforms without Web Share (desktop Chrome/Firefox): clicking
  opens a dropdown anchored below the button. Menu items:
  - **Copy link** — `navigator.clipboard.writeText(shareUrl)` →
    inline check-mark + "Copied" label for 2 seconds, then revert.
  - **X / Twitter** — opens `https://twitter.com/intent/tweet?text=
    {encoded short}&url={encoded shareUrl}` in a new tab.
  - **Facebook** — opens
    `https://www.facebook.com/sharer/sharer.php?u={encoded shareUrl}`.
  - **Reddit** — opens `https://www.reddit.com/submit?url={encoded}&
    title={encoded skinName}`.
  - **LinkedIn** — opens
    `https://www.linkedin.com/sharing/share-offsite/?url={encoded}`.
- Dismiss on: click outside, Escape, selecting an item, or unmounting
  the page.
- Accessibility: `aria-haspopup="menu"`, `aria-expanded`, menu items
  are `role="menuitem"`, arrow-key navigation between items, `Tab`
  closes and restores focus to the trigger.
- Visual: matches the existing "Download PNG" button style (rounded,
  `bg-accent`, `text-canvas` on the primary action). Share is a
  *secondary* action — use `border border-ui-border text-text-primary`
  styling, similar to the gallery's like button outline.

**Patterns to follow:**
- AuthDialog / PublishDialog modal + focus-trap conventions
  (`app/_components/AuthDialog.tsx`) — though Share is a menu, not a
  modal, so copy the click-outside/Escape patterns, not the full focus
  trap.
- Optimistic-toast-via-console pattern from M12 SkinCard (no toast
  library yet; use ephemeral in-component state for the "Copied"
  label).

**Test scenarios:**
- *Happy path* — on a jsdom environment where `navigator.share` is
  stubbed, clicking "Share" invokes `navigator.share` once with
  `{ title, text, url }` and does not open the menu.
- *Happy path* — on a jsdom without `navigator.share`, clicking
  "Share" toggles `aria-expanded="true"` and renders 5 menu items
  (Copy, Twitter, Facebook, Reddit, LinkedIn).
- *Happy path* — clicking "Copy link" calls
  `navigator.clipboard.writeText(shareUrl)` and swaps the label to
  "Copied" (then restores after 2s via `vi.useFakeTimers`).
- *Happy path* — clicking "Twitter" opens a URL matching the
  `twitter.com/intent/tweet` pattern with both `text` and `url`
  query params encoded.
- *Edge case* — Web Share API present but `canShare` returns false:
  falls through to the menu (doesn't throw).
- *Edge case* — clicking outside the menu closes it.
- *Edge case* — pressing Escape closes the menu and restores focus
  to the trigger.
- *Edge case* — skin name contains spaces, `#`, `&`, emoji: every
  intent URL's query string round-trips through `decodeURIComponent`
  to the original value.
- *Integration* — on the rendered page, the Share button is a
  sibling of the Download PNG anchor inside the metadata panel's
  action row.

**Verification:**
- `npx vitest run` green.
- Manual: on the dev server, click Share → native sheet appears on
  mobile viewport, menu appears on desktop.
- All intent URLs open the correct platform's share page
  (verify during Unit 6 manual QA).

---

- [ ] **Unit 5: OG image fallback hardening**

**Goal:** Make the tier-2/tier-3 fallback path (see §Technical
Architecture) explicit in the helper and cover it with tests. No UI
changes.

**Dependencies:** Unit 1.

**Files:**
- Modify: `lib/seo/skin-metadata.ts` — `pickOgImage(skin)` helper
  extracted into its own named export.
- Test: `lib/seo/__tests__/skin-metadata.test.ts` — expanded matrix.

**Approach:**
- `pickOgImage(skin)` returns one of three discriminated shapes:
  - `{ tier: 'og', url, width: 1200, height: 630, card: 'summary_large_image' }`
  - `{ tier: 'thumbnail', url, card: 'summary' }`   — no width/height
  - `{ tier: 'storage', url, card: 'summary' }`     — no width/height
- `buildSkinMetadata` switches on `.tier` to decide whether to emit
  `og:image:width`/`og:image:height` and which `twitter.card` value
  to use.

**Patterns to follow:**
- Discriminated-union pattern used throughout the codebase's undo
  `Command` type (`lib/editor/undo.ts`) — typed with a `kind` / `tier`
  discriminator, exhaustive switches.

**Test scenarios:**
- *Happy path* — `{ ogImageUrl: "…og.webp", thumbnailUrl: "…thumb.webp",
  storageUrl: "…skin.png" }` → tier 'og'.
- *Fallback path* — `{ ogImageUrl: null, thumbnailUrl: "…thumb.webp",
  storageUrl: "…skin.png" }` → tier 'thumbnail', no width/height.
- *Fallback path* — `{ ogImageUrl: null, thumbnailUrl: null, storageUrl:
  "…skin.png" }` → tier 'storage'.
- *Edge case* — `{ ogImageUrl: '', thumbnailUrl: '', storageUrl: '' }`:
  treat empty strings as missing (defensive; Firestore normally stores
  null, but a bad migration could produce empty strings).
- *Integration* — calling `buildSkinMetadata` with a tier-2 skin
  produces `twitter.card === 'summary'` (not `summary_large_image`)
  and does NOT include `openGraph.images[0].width`.

**Verification:**
- `npx vitest run lib/seo` green.
- The tier-2/3 paths can be exercised by temporarily patching the
  sample skin's `ogImageUrl` to null in Firestore and hitting the
  page (deferred to Unit 6 manual QA).

---

- [ ] **Unit 6: Documentation, COMPOUND.md entry, manual validator sweep**

**Goal:** Validate the shipped tags against real social platform
crawlers; capture learnings. No production code changes.

**Dependencies:** Units 1–5 merged.

**Files:**
- Create: `docs/solutions/social-preview-testing.md` — runbook for
  validating OG / Twitter / Discord / LinkedIn / Slack previews on a
  new skin. Becomes the canonical "how do I check my share card?"
  reference for future milestones.
- Modify: `docs/solutions/COMPOUND.md` — append §M14 block covering
  what worked, what didn't, invariants, gotchas for M15.

**Approach:**
- Execute every entry in the testing runbook against the Unit-0
  sample skin on production (`threditor.vercel.app/skin/<id>`):
  - Twitter Card Validator / the modern X equivalent
    (`https://cards.x-dev.pages.dev/validate`) — expect
    `summary_large_image` card renders with image + title + description.
  - Facebook Sharing Debugger
    (`https://developers.facebook.com/tools/debug/`) — expect
    every OG property detected + `og:type=article`.
  - LinkedIn Post Inspector
    (`https://www.linkedin.com/post-inspector/`) — expect preview
    matches.
  - Discord — paste URL in a test server or DM-to-self; expect
    sidebar color + large image embed.
  - Slack — paste URL in a test channel; expect unfurl with
    large image.
  - Meta Tags (`https://metatags.io/`) — expect all platforms' cards
    render in the preview.
  - Google Rich Results Test
    (`https://search.google.com/test/rich-results`) — expect one
    `ImageObject` detected, zero errors.
- Capture screenshots of each preview + a pass/fail table in the
  COMPOUND.md entry (embed none — just the pass/fail table).
- If any validator reports a warning, file follow-up in
  `docs/solutions/` under the appropriate category.

**Patterns to follow:**
- COMPOUND.md §M13 entry structure (What worked / What didn't /
  Invariants / Gotchas / Performance / Tests added).

**Verification:**
- Runbook committed.
- COMPOUND.md §M14 block committed.
- Every validator pass/fail row filled.

---

## Meta Tag Schema

Complete list of tags emitted for a canonical skin (tier-1 OG image).
Assumes a skin named `"Shaded Hoodie"` by user `ryanssareen`, with
tags `["hoodie", "shading"]`, variant `classic`, `likeCount: 17`,
created `2026-04-20T14:32:00Z`, ID `019dbb09-c521-7665-945f-06fc0de1b27b`.

### Basic tags (from Next.js `metadata`)

| Tag | Example value |
|---|---|
| `<title>` | `Shaded Hoodie by ryanssareen · threditor` |
| `<meta name="description">` | `A classic Minecraft skin by ryanssareen. 17 likes. Tagged hoodie, shading.` |
| `<meta name="keywords">` | `hoodie, shading, minecraft, skin, classic` |
| `<link rel="canonical">` | `https://threditor.vercel.app/skin/019dbb09-c521-7665-945f-06fc0de1b27b` |
| `<meta name="robots">` | `index, follow` |

### Open Graph (Facebook, LinkedIn, Discord, Slack)

| Tag | Example value |
|---|---|
| `og:title` | `Shaded Hoodie by ryanssareen` |
| `og:description` | `A classic Minecraft skin by ryanssareen. 17 likes.` |
| `og:url` | `https://threditor.vercel.app/skin/019dbb09-…` |
| `og:type` | `article` (schema.org's `ImageObject` is not a valid `og:type`; `article` is the closest broadly-supported value for "a user-created piece of content") |
| `og:site_name` | `threditor` |
| `og:locale` | `en_US` |
| `og:image` | `https://<supabase>.supabase.co/storage/v1/object/public/skins/<uid>/<id>-og.webp` |
| `og:image:width` | `1200` *(only emitted at tier 1)* |
| `og:image:height` | `630` *(only emitted at tier 1)* |
| `og:image:type` | `image/webp` |
| `og:image:alt` | `Shaded Hoodie — a classic Minecraft skin by ryanssareen` |
| `article:author` | `https://threditor.vercel.app/u/ryanssareen` |
| `article:published_time` | `2026-04-20T14:32:00.000Z` |
| `article:tag` | `hoodie`, `shading` *(one tag per `article:tag` element)* |

### Twitter / X

| Tag | Example value |
|---|---|
| `twitter:card` | `summary_large_image` *(tier 1)* / `summary` *(tier 2–3)* |
| `twitter:site` | `@threditor` *(if/when we claim the handle; otherwise omit)* |
| `twitter:creator` | *(omitted — we don't know the user's Twitter handle)* |
| `twitter:title` | `Shaded Hoodie by ryanssareen` |
| `twitter:description` | `A classic Minecraft skin by ryanssareen.` |
| `twitter:image` | *(same URL as `og:image`)* |
| `twitter:image:alt` | *(same text as `og:image:alt`)* |

### JSON-LD (SEO)

```json
{
  "@context": "https://schema.org",
  "@type": "ImageObject",
  "contentUrl": "https://.../019dbb09-…-og.webp",
  "thumbnailUrl": "https://.../019dbb09-…-thumb.webp",
  "name": "Shaded Hoodie",
  "keywords": "hoodie, shading",
  "datePublished": "2026-04-20T14:32:00.000Z",
  "creator": {
    "@type": "Person",
    "name": "ryanssareen",
    "url": "https://threditor.vercel.app/u/ryanssareen"
  },
  "license": "https://opensource.org/licenses/MIT",
  "interactionStatistic": {
    "@type": "InteractionCounter",
    "interactionType": "https://schema.org/LikeAction",
    "userInteractionCount": 17
  }
}
```

### Validation checklist (Unit 6)

- [ ] `og:image` URL returns 200 OK + `image/webp`.
- [ ] `og:image` URL is publicly accessible (no auth header needed).
- [ ] `og:image:width` / `og:image:height` match the actual bytes
      (use `curl | file -` or `identify`).
- [ ] Canonical URL has no query string, trailing slash, or protocol
      mismatch.
- [ ] JSON-LD parses with `JSON.parse` — script tag is not truncated.
- [ ] `robots` is `index, follow` on every non-404 skin URL.
- [ ] 404 skin URLs emit `robots: noindex`.

---

## Share Button Spec

### Component API

```ts
type ShareButtonProps = {
  shareUrl: string;                           // full permalink
  shareText: { short: string; long: string }; // from buildSkinShareText
  skinName: string;                           // for native sheet title
};
```

### Platform configurations

Each platform's intent URL is built by a pure helper in
`lib/seo/share-intents.ts`:

| Platform | Helper | URL pattern |
|---|---|---|
| X / Twitter | `twitterIntent({ text, url })` | `https://twitter.com/intent/tweet?text={text}&url={url}` |
| Facebook | `facebookIntent({ url })` | `https://www.facebook.com/sharer/sharer.php?u={url}` |
| Reddit | `redditIntent({ url, title })` | `https://www.reddit.com/submit?url={url}&title={title}` |
| LinkedIn | `linkedinIntent({ url })` | `https://www.linkedin.com/sharing/share-offsite/?url={url}` |
| Clipboard | `navigator.clipboard.writeText(url)` | *(no URL)* |

Every query-string value is `encodeURIComponent`-wrapped exactly once.
Tests round-trip via `decodeURIComponent` to guard against
double-encoding regressions.

### Desktop menu vs mobile sheet

| Input | Behavior |
|---|---|
| `navigator.canShare({ url })` returns true | Native sheet (`navigator.share`) — bypasses the custom menu entirely |
| No Web Share API OR `canShare` returns false | Custom menu renders below the trigger, anchored via `absolute top-full left-0 mt-2 w-56` (matches existing dropdown patterns in the repo once any land — currently none do, so M14 creates the first; future milestones can standardize) |

### Visual / interaction spec

- **Trigger button:** same height as "Download PNG" (py-2), `border
  border-ui-border text-text-primary bg-ui-surface`, hover adds
  `hover:border-accent/60`. Icon-free — text label "Share" only
  (keeps the bundle lean; lucide-react was explicitly rejected in M12).
- **Menu backdrop:** none. Click-outside closes. Menu is *not* a modal
  (no focus trap, no body scroll lock).
- **Focus management:** trigger receives focus back on close. Arrow
  keys cycle menu items. Home/End jump to first/last. Escape closes.
- **Copied state:** the "Copy link" item replaces its label with
  "Copied ✓" for 2 seconds (uses `setTimeout` cleared on unmount).
- **Mobile:** `navigator.share` opens the OS sheet. If the user
  dismisses the sheet, no fallback appears (matches platform
  convention).

---

## Edge Cases & Gotchas

### Meta tag edge cases

- **Missing OG image (tier-2 fallback).** `summary_large_image` card
  with a 128×128 thumbnail looks *terrible* on Twitter — it stretches
  the thumb. The fix is to switch to `summary` card (small, square
  image on the right) when we fall back. Unit 5 enforces this via the
  discriminated union.
- **Missing OG + missing thumbnail (tier-3 fallback).** The raw 64×64
  PNG is what crawlers get. Discord/Slack render it tiny but readable.
  Twitter's `summary` card shows it acceptably. No crash path, just
  degraded preview.
- **Skin renamed after publish.** Firestore `SharedSkin.name` mutates;
  our meta tags re-render on next request (force-dynamic). Social
  platforms cache OG for 7–30 days — we accept the stale cards.
  Documented in §Technical Architecture.
- **Skin deleted.** `loadSkin` returns null → `generateMetadata`
  emits `robots: noindex` + "Skin not found" title. The 404 page
  still renders with meta tags that explicitly ask crawlers to drop
  the URL.
- **Name contains `</script>`.** JSON-LD serializer escapes `<` →
  `\u003c`. Covered in Unit 3 test scenarios.
- **Very long skin name.** Title truncates to 60 chars + ellipsis.
  Description keeps the full name. Twitter + Discord + LinkedIn all
  handle truncation gracefully below 200 chars.
- **Tag with special char.** Tags are lowercased + `[a-z0-9_-]+` at
  write time (M11 invariant). No escape needed; M14 can trust the
  shape.
- **Empty tags array.** `keywords` falls back to the static trio
  (minecraft, skin, classic|slim). `article:tag` is simply not emitted.
- **`metadataBase` not set.** Without it, Next.js logs a warning +
  refuses to resolve relative OG image URLs. Unit 1 sets it in
  `app/layout.tsx`.

### Share button edge cases

- **`navigator.clipboard` not available (Safari < 13.1, insecure
  origin).** Feature-detect; fall back to a hidden textarea +
  `document.execCommand('copy')`. Caught and logged.
- **`navigator.share` throws AbortError** (user dismissed the
  sheet). Silently ignore — don't toast an error.
- **Popup blocker on intent URLs.** We open intents in a new tab via
  `window.open(url, '_blank', 'noopener,noreferrer')`. If popup is
  blocked, browser shows its native blocker UI. We don't fallback.
- **Touch device with no Web Share API.** Android Firefox historically
  lacked it. The custom menu works fine on touch — it's just slightly
  less polished than a native sheet.
- **User shares on LinkedIn / Twitter while not signed in to that
  platform.** Platform shows its own sign-in modal. Not our problem.
- **Shared URL ≠ canonical URL.** Must match exactly, else social
  platform caches a URL that later redirects. Use
  `skinPermalink(id)` everywhere.
- **Rate-limit on clipboard.** Clicking "Copy link" 100 times in a
  row could hit browser limits. Non-issue in practice.

### Runtime / caching gotchas

- **`force-dynamic` + Firestore on every request.** One read per
  permalink view. At 50K reads/day on Spark, that's 50K pageviews/day
  ceiling. Consider ISR or CDN caching in a future milestone once
  edit-skin lands (see §Technical Architecture "Why we do NOT add
  middleware CDN caching in M14").
- **`runtime: 'nodejs'` required** — firebase-admin can't run in
  Edge. Same constraint as M12/M13.
- **React `cache()` dedup** — `loadSkin` must be wrapped in
  `cache()` so metadata generation + page render share one Firestore
  read. Unit 2 test enforces this.
- **Preview deploys produce `*-xyz.vercel.app` URLs.** The hardcoded
  `SITE_ORIGIN` means canonical URLs on a preview point to the
  production domain. That's correct — we don't want Google indexing
  preview deploys. Unit 1 captures this as a deliberate choice.

---

## Testing Strategy

### Unit tests (vitest, added in Units 1–5)

- `lib/seo/__tests__/skin-metadata.test.ts` — tier selection, title
  truncation, keywords composition, canonical URL shape, empty/null
  field handling.
- `lib/seo/__tests__/share-text.test.ts` — short/long string bounds,
  escape safety.
- `lib/seo/__tests__/share-intents.test.ts` — every platform URL is a
  valid URL, query params round-trip via `decodeURIComponent`.
- `lib/seo/__tests__/skin-jsonld.test.ts` — shape + script-tag
  escape.
- `app/skin/[skinId]/__tests__/metadata.test.ts` — integration: call
  `generateMetadata` with a stubbed skin loader; assert shape.
- `app/skin/[skinId]/_components/__tests__/ShareButton.test.tsx` —
  jsdom, Web Share API stubbed; menu toggles, clipboard called,
  intent URLs opened.

Target: +40 tests, consistent with M13's +40 test delta.

### Integration tests (manual, Unit 6)

Runbook at `docs/solutions/social-preview-testing.md`. Exercises:

1. **Twitter / X Card Validator** — visual inspection of the
   generated card.
2. **Facebook Sharing Debugger** — "Scrape Again" button, expects
   zero warnings.
3. **LinkedIn Post Inspector** — preview renders with image + title +
   description.
4. **Discord** — paste URL in a test server DM; expect embed with
   large image + description.
5. **Slack** — paste URL in a test channel; expect unfurl with large
   image.
6. **Google Rich Results Test** — JSON-LD detected, zero errors.
7. **Meta Tags** — all platforms' preview rendering in one page.

Each entry has a pass/fail column in the COMPOUND.md M14 block.

### Automated tests we are explicitly NOT adding

- **Visual regression of the OG image.** M11 already tests OG
  generation. Re-testing the pixels here would be redundant.
- **End-to-end browser tests hitting real social validators.** Those
  endpoints block bots. Human QA via Unit 6 runbook is the right
  fit.
- **Screenshot-based tests of the share menu.** jsdom doesn't render
  CSS; snapshotting the menu's HTML is fine, which the component test
  already does.

---

## Performance Targets

| Metric | Target | Measurement |
|---|---|---|
| `generateMetadata` execution | < 50 ms | `console.time` in dev; vitest doesn't need to measure |
| Firestore reads per skin-detail pageview | exactly 1 | `loadSkin` wrapped in React `cache()`, asserted in Unit 2 test |
| Page TTFB (cold) | < 500 ms | Same as M13 profile page; dominated by one Firestore read |
| Share button first render | no layout shift | `ShareButton` renders immediately with the fallback menu disabled; no conditional shrinking once feature-detection runs |
| `og:image` load time (crawler-perceived) | < 1 s | Supabase public URL + Vercel edge cache; already in prod via M11 |
| Bundle-size delta (share button) | < 2 KB gzipped | No new dependencies; helpers are ~200 LOC across 3 files |

No GPU / memory-leak concerns — everything added here is plain
JavaScript + DOM.

---

## Success Criteria

M14 is shippable when:

- [ ] Twitter Card Validator renders a `summary_large_image` card
      with OG image, title, description.
- [ ] Facebook Sharing Debugger shows every OG property with zero
      warnings.
- [ ] LinkedIn Post Inspector renders preview with image + title +
      description.
- [ ] Discord message with the permalink unfurls to a rich embed
      (large image + description).
- [ ] Slack unfurls to a rich embed with large image.
- [ ] Google Rich Results Test detects `ImageObject` with zero errors.
- [ ] Copy-link button puts the canonical permalink on the clipboard.
- [ ] Native Web Share sheet opens on mobile Safari.
- [ ] Desktop menu has working links to X, Facebook, Reddit, LinkedIn.
- [ ] All existing tests (769 at the start of M14) still pass.
- [ ] +40 new tests specific to M14 pass.
- [ ] Typecheck clean, lint clean.
- [ ] COMPOUND.md §M14 entry landed.

---

## Timeline Estimate

Per-unit estimates are conservative; they assume "research for ~10
minutes, implement for the rest." DESIGN.md §12.6 budgets 4–6 hours
total for M14.

| Unit | Estimate | Running total |
|---|---|---|
| Unit 0 — Research & verification | 20 min | 0:20 |
| Unit 1 — `lib/seo/` helpers + tests | 90 min | 1:50 |
| Unit 2 — Wire into `/skin/[skinId]` | 30 min | 2:20 |
| Unit 3 — JSON-LD | 40 min | 3:00 |
| Unit 4 — Share button + tests | 90 min | 4:30 |
| Unit 5 — Fallback hardening | 20 min | 4:50 |
| Unit 6 — Validator sweep + COMPOUND | 40 min | 5:30 |

**Total: ~5.5 hours.** Inside the 4–6h DESIGN.md budget; matches
M13's actual 2.5h-vs-5h-plan ratio once reuse of shared helpers
(like the metadataBase fix) compounds.

---

## Rollout Plan

### Pre-merge

1. Open PR titled **"M14: Share metadata & social previews"** from
   the M14 branch to `main`.
2. Vercel preview deploys automatically — grab the preview URL.
3. Run every entry in the Unit 6 runbook against the preview URL
   (not prod). Social validators work fine on `*.vercel.app`
   subdomains — the crawler just fetches the HTML and parses meta
   tags, doesn't care about the domain.
4. Paste screenshots of Twitter + Facebook + Discord previews into
   the PR description.

### Merge

5. Land the PR via merge-to-main. Production deploy happens on merge
   (same flow as M12/M13).
6. Smoke-test on prod: paste the production URL of the Unit-0 sample
   skin into a Twitter tweet draft. Confirm the card renders.

### Post-merge invalidation

7. Social platforms cache OG data for 7–30 days. For the sample skin
   specifically, manually refresh its Facebook cache via the Sharing
   Debugger ("Scrape Again"). Twitter's cache refreshes automatically
   on first tweet; no manual action needed.

### Rollback plan

If a post-merge issue surfaces (e.g., JSON-LD breaks on a real skin):

- **Partial rollback (preferred):** Comment out the JSON-LD block in
  `page.tsx`. Meta tags keep working. Fast, low-risk revert.
- **Full rollback:** `git revert` the M14 PR. Restores the M13
  minimal meta tags. No data loss — nothing M14 writes to Firestore
  or Storage.
- **Cache invalidation after rollback:** Social platforms will
  continue serving cached rich cards for up to 30 days. This is
  fine; the cached card is still accurate.

---

## Execution Command

For `/ce:work` (or equivalent):

```
Execute M14 (Share Metadata) using Compound Engineering methodology.

PLAN: /Users/ryan/Documents/threditor/docs/solutions/m14-share-metadata-plan.md
COMPOUND: /Users/ryan/Documents/threditor/docs/solutions/COMPOUND.md

Implement Units 1–6 per the plan (Unit 0 is research-only and may have already run).
Create PR titled "M14: Share Metadata & Social Previews".
Land every test scenario listed in each unit, typecheck clean, lint clean.
Capture Unit-6 validator pass/fail screenshots in the PR description.
Append a §M14 block to COMPOUND.md before requesting review.
```

---

## Sources & References

- **Origin document:** [docs/solutions/m14-share-metadata-planning-prompt.md](../solutions/m14-share-metadata-planning-prompt.md)
- **Current skin detail page:** [app/skin/[skinId]/page.tsx](../../app/skin/%5BskinId%5D/page.tsx)
- **M11 OG image generator:** [lib/editor/og-image.ts](../../lib/editor/og-image.ts)
- **M11 storage writer:** [lib/supabase/storage-server.ts](../../lib/supabase/storage-server.ts)
- **Firestore types:** [lib/firebase/types.ts](../../lib/firebase/types.ts)
- **M13 SSR + meta tag reference:** [app/u/[username]/page.tsx](../../app/u/%5Busername%5D/page.tsx)
- **M13 middleware CDN pattern:** [middleware.ts](../../middleware.ts)
- **COMPOUND journal (M11, M12, M13):** [docs/solutions/COMPOUND.md](../solutions/COMPOUND.md)
- **DESIGN §11.6 (OG generation spec) + §12.6 (M14 scope):** [docs/DESIGN.md](../DESIGN.md)
- **Open Graph protocol:** https://ogp.me
- **Twitter / X cards:** https://developer.x.com/en/docs/x-for-websites/cards/overview/summary-card-with-large-image
- **Schema.org `ImageObject`:** https://schema.org/ImageObject
- **Next.js 15 `generateMetadata`:** https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- **Web Share API:** https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share

*End of plan.*
