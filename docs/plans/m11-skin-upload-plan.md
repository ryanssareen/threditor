---
title: "M11: Skin Upload + OG Image Generation"
type: feat
status: completed
date: 2026-04-23
---

# M11: Skin Upload + OG Image Generation — Plan

> **Milestone posture:** first real write path to Firebase + Supabase. Turns a painted skin into a shared gallery entry with a preview card. Every downstream milestone (M12 gallery, M13 profile, M14 social) depends on M11's `/skins/{skinId}` documents being well-formed and safely produced.

## Overview

M11 ships a single end-to-end flow: **signed-in user clicks "Publish" → dialog collects name + tags → client composites the skin PNG + generates an OG preview image → POSTs everything to a server route → server validates, uploads to Supabase Storage, writes the Firestore doc, increments the user's skinCount, returns the shareable URL**.

Seven units:

| # | Unit | New / modified files |
|---|---|---|
| 0 | Dependencies check | `package.json` (probably unchanged) |
| 1 | `PublishDialog` component | `app/_components/PublishDialog.tsx` + tests |
| 2 | Client-side OG image generator | `lib/editor/og-image.ts` + tests |
| 3 | Server-side Supabase upload module | `lib/supabase/storage-server.ts` + tests |
| 4 | Server-side Firestore write module | `lib/firebase/skins.ts` + tests |
| 5 | `/api/skins/publish` API route | `app/api/skins/publish/route.ts` + tests |
| 6 | Editor integration — Publish button + flow wiring | `EditorHeader.tsx` updates |
| 7 | Production deployment + manual QA | no code; operational checklist |

## Problem Frame

Phase 1 was a complete local editor. M9 + M10 scaffolded the backend and identified users. M11 is the first feature that *produces user-generated content the product actually owns* — a skin lives in Supabase Storage, its metadata lives in Firestore, and its URL is shareable. Every write-path mistake here becomes a class of mistake future milestones inherit: how orphaned uploads are cleaned up, how authorship is enforced, how atomicity fails, how quota is managed, how PII travels through logs.

Get the write pipeline right once, cheaply, and M12–M14 just query and annotate.

## Requirements Trace

- **R1 (DESIGN §11.3 + §4.1).** A signed-in user can publish a skin, producing a `/skins/{skinId}` Firestore document whose shape matches the `SharedSkin` type: `{ id, ownerUid, ownerUsername, name, variant, storageUrl, thumbnailUrl, ogImageUrl, tags, likeCount: 0, createdAt, updatedAt }`.
- **R2 (DESIGN §11.5 + M9 COMPOUND).** Uploads land at `skins/{uid}/{skinId}.png` in Supabase Storage. The server uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) but enforces `{uid}` matches the authenticated session via `getServerSession()`.
- **R3 (DESIGN §11.6).** A 1200×630 WebP OG image is generated **client-side** via `THREE.WebGLRenderer` using three-point lighting and a 3/4 isometric camera. Uploaded alongside the skin PNG. Quality 0.85.
- **R4 (DESIGN §11.3 firestore.rules, M9 residual).** Unauthenticated requests to `/api/skins/publish` return 401 without partial side effects.
- **R5 (DESIGN §11.5).** The Firestore `skins.create` rule enforces `ownerUid == auth.uid`, `likeCount == 0`, `tags.size() <= 8`. M11's server-side write uses Admin SDK (which bypasses rules) but still honors these as invariants in the data it writes. A future M12 client-side update (e.g., rename) will trip the rule if violated — so M11 seeds the doc in the rule-compliant shape from day one.
- **R6 (DESIGN §4.1).** The user's `/users/{uid}` document's `skinCount` counter increments atomically with the skin create. If either write fails, the caller must see a clear failure and the orphaned side-effects must be reverted.
- **R7 (M10 COMPOUND §Pinned facts).** The `/editor` client-bundle First Load JS stays within **+5 kB** of M10's 478 kB baseline. All Supabase writes + Admin SDK code runs server-side.
- **R8 (DESIGN §11.7).** Quota-safe: at most 3 Firestore writes per publish (skin create + user update + optional timestamp), ≤200 KB total Storage upload per publish.
- **R9 (M9 security review residual #3).** The `storageUrl` field in the created `/skins` doc references a path under `{uid}/` — so even though the Firestore `skins.create` rule has no storageUrl regex today, the server route verifies it before writing. Closes one of the M9 open security items.
- **R10 (UX).** Publish flow works for a first-time publisher whose `/users/{uid}` document does not yet exist — the server route creates it inline if missing.

## Scope Boundaries

- **No** gallery page. M11 returns the published skin's permalink as a toast + copy button; no `/gallery` route, no `/skin/[id]` detail page. Those are M12.
- **No** client-side Firestore writes for skins. All skin-related writes go through `/api/skins/publish`. Like-toggle (DESIGN §11.4) stays deferred to M12 where its own route lives — M11 does not implement likes.
- **No** edit-after-publish. The published skin is immutable in M11; the `updatedAt` field is set at create time and is wasted bytes until M13 adds rename. Accepted.
- **No** delete flow. Unpublish is M13.
- **No** Firebase Storage. M9 + M10 committed to Supabase Storage for the PNG + OG; DESIGN §11.5's `storage.rules` block is for a Firebase-Storage variant that we are not shipping. Plan will leave that DESIGN section as-is and note the divergence in COMPOUND.
- **No** Cloud Function for `skinCount`. M11 increments it server-side via Admin SDK as part of the same route's work. If this becomes a bottleneck (it won't at Phase 2 scale) a CF takeover lands in a later milestone.
- **No** background OG image regeneration. OG is generated synchronously in the publish flow. If it fails, publish still succeeds with `ogImageUrl: null`; the skin page gracefully falls back to the thumbnail. Flagged as a documented acceptable degradation, not a bug.
- **No** username-picker / profile-setup wizard. The `/users/{uid}` document is created inline with a generated username (`user-<base36 uid slice>`), editable in M13.
- **No** moderation / abuse pipeline. Every signed-in user can publish. Manual moderation + terms-of-service flagging is M14+.

## Context & Research

### Relevant Code and Patterns

- **`lib/editor/export.ts::exportLayersToBlob`** — the M8 canonical composite→PNG path. M11 reuses this *unchanged* to build the 64×64 atlas PNG the server uploads. No second compositor.
- **`lib/firebase/admin.ts::getAdminFirebase`** — M9 Admin SDK singleton. M11's Firestore writes go through this. `server-only` import guarantees no client-bundle leakage.
- **`lib/firebase/auth.ts::getServerSession`** — M10's server auth helper. M11's `/api/skins/publish` calls this to resolve the uid before any write.
- **`lib/supabase/client.ts::getStorageBucket`** — M9's browser client helper. M11 **does not use it on the server** because it ships with the anon key. M11 creates a separate server-side client using the service-role key.
- **`app/_components/AuthDialog.tsx`** — hand-rolled ARIA dialog pattern. PublishDialog mirrors its structure (backdrop click, Escape key, X button, focus trap, z-50, bg-ui-surface).
- **`app/_components/EditorHeader.tsx`** — the header into which the Publish button lands. M10 establishes the loading/signed-out/signed-in triage; M11 extends with a new action when signed in.
- **`lib/editor/templates.ts`** — normalization pattern for user-provided strings (the manifest loader). M11's tags validator mirrors this: reject/normalize before server call, trust server to re-validate.
- **`lib/three/PlayerModel.tsx`** — the existing humanoid mesh factory. M11's OG renderer builds a fresh standalone scene but reuses the same variant-aware UV-mapped BoxGeometry factory logic.
- **`lib/three/geometry.ts` + `lib/three/constants.ts`** — the UV maps + atlas constants M11's OG scene needs.
- **`tests/export.test.ts`** — the M8 test pattern for composite→blob pipelines: real PNG signature bytes, pixel-parity, edge cases for empty/hidden. OG tests mirror the shape.
- **`tests/export-dialog.test.tsx`** — the M8 ExportDialog test pattern. PublishDialog tests inherit the mock-firebase-client + global.fetch + `HTMLInputElement.prototype.value` setter trick for React 19 form inputs.
- **`app/api/auth/__tests__/session.test.ts`** — M10's API-route test pattern. `/api/skins/publish` tests inherit the `vi.hoisted` + `vi.mock` + `server-only` shim.

### Institutional Learnings

- **M9 §Gotchas:** Supabase RLS doesn't see Firebase Auth. Upload MUST be server-side with `SUPABASE_SERVICE_ROLE_KEY`. **This plan honors that precisely.**
- **M9 §Security review residuals:** The Firestore `skins.create` rule doesn't validate `storageUrl` ownership. M11's server-side Admin-SDK write path closes this loophole because the client never writes Firestore directly for skins — the rules become a belt-and-suspenders layer, not the primary enforcement.
- **M10 §Invariants:** (a) session-cookie + `checkRevoked=true` is the canonical auth surface for every new route. (b) Use `import 'server-only'` on anything that touches service-role / admin credentials. (c) `getServerSession()` returns `{uid, email, emailVerified}` — M11's writes use `uid`.
- **M10 §What didn't:** `firebase/auth` is webpack-bundle-indivisible under Next 15 → M11 must stay off the client's critical import graph for any Supabase server helpers. Only `@supabase/supabase-js` browser client (already in M9 bundle) is acceptable on the client.
- **M10 §React 19 + jsdom form submit gotcha:** `required` inputs block submit when empty + value setter needs to use the native descriptor. PublishDialog tests inherit the `fillCredentials`-style helper.
- **M8 §Invariants:** `canvas.toBlob(cb, 'image/png')` — no quality arg; `canvas.toBlob(cb, 'image/webp', 0.85)` — quality honored. OG output is WebP so quality arg applies.
- **M6 §Invariants:** Session-scoped non-serializable instances live in `useRef`, not zustand. The OG generator's temporary `THREE.WebGLRenderer` is created per-publish inside the handler function and disposed synchronously — no ref needed because there's no cross-render lifetime.

### External References

- Supabase JS v2 Server-side storage upload pattern — `createClient(url, serviceRoleKey, { auth: { persistSession: false } })` + `storage.from(bucket).upload(path, blob)`. Confirmed stable in 2.45+.
- Next.js 15 API route body size — default 4.5 MB, which covers our 64 KB PNG + 200 KB WebP + JSON metadata with 3 orders of magnitude to spare. No `bodyParser` config needed.
- Firebase Admin SDK Firestore `WriteBatch` — atomic multi-doc writes, all-or-nothing on commit. 500-doc cap (we need 2). Canonical for the "create skin + increment user" atomic write.
- three.js `WebGLRenderer({ preserveDrawingBuffer: true })` — required so `canvas.toBlob` sees the rendered pixels. Known-good; used by every three.js screenshot library.

## Key Technical Decisions

- **D1. OG image is client-side, not server-side.** DESIGN §11.6 already committed to this. Rationale: zero server cost + reuses the existing client three.js infrastructure + no new deps. Tradeoff: 200-500 ms of UI latency in the publish flow + requires WebGL on the client (near-universal; mobile Safari has supported it since 2012). Alternative rejected: server-side with `sharp` + satori — 40+ MB of cold-start dependency, requires maintaining a server-side three.js render surface, doubles the Vercel function size, blows the +5 kB bundle budget's spirit even if it stays off the client bundle.
- **D2. All skin-creation writes go through `/api/skins/publish`, not from the client.** Supabase RLS can't enforce ownership against Firebase Auth, so the only way to verify `{uid}` on upload is a server route that reads the session cookie. Since the server is already doing the Supabase upload, it also does the Firestore doc creation via Admin SDK — atomically, in one request. Rejected alternative: client uploads via anon key + client writes /skins via SDK (failed because Supabase RLS would reject the upload). Rejected alternative 2: client uploads via signed URL from a separate /api/skins/sign-url route (adds latency, doesn't solve the atomicity question).
- **D3. Firestore writes use `WriteBatch`, not a transaction.** We write two docs (`/skins/{skinId}` create + `/users/{uid}` update). Neither read depends on the other's value: skinId is server-generated, skinCount increment uses the Admin SDK's FieldValue.increment sentinel which is lock-free. Batch is lighter than transaction. The `/users/{uid}` write uses `.set({ …defaults, skinCount: increment(1) }, { merge: true })` so the user's profile is created-if-missing in the same op (closes R10). Rejected alternative: Firestore transaction — unnecessary overhead since we don't need to read-then-write.
- **D4. Partial-failure rollback is Storage-first, Firestore-second.** Order: upload PNG → upload OG → run Firestore WriteBatch. If Firestore fails, delete both Storage objects. If OG upload fails after PNG succeeded, delete the PNG and abort (surface error to client). If the PNG upload itself fails, nothing has been written — just return 500. The Firestore commit is the "point of no return" — once it commits, the skin is published; if Storage had somehow been deleted between the upload and the commit (it wasn't — Storage is write-once + no intermediate delete), we'd have a broken URL, but the failure mode is cosmetic (broken image), not a security incident. Accepted.
- **D5. OG image generation failure does not block publish.** If `generateOGImage` throws (e.g., WebGL context lost on a mobile browser), the client sends the request with `ogImageUrl: null`. The server accepts null, stores the Firestore doc with the field absent. Downstream consumers (M12 gallery) treat missing OG as "fallback to thumbnail". Rationale: blocking publish on OG is a worse UX than a slightly-less-rich social card. Documented as acceptable degradation.
- **D6. The Storage path convention is `skins/{uid}/{skinId}.png` and `skins/{uid}/{skinId}-og.webp`.** Derived from DESIGN §11.5 storage.rules. Both files under the user's `{uid}` prefix → the Supabase RLS policies (even though bypassed by service-role) stay semantically aligned. skinId is a server-generated UUID v7 so natural lexicographic sort = creation-time sort (useful for M12 gallery).
- **D7. `skinId` generation: UUID v7 on the server.** Not `nanoid` — uuid v7 embeds a sortable timestamp in the first 6 bytes, letting a future `ORDER BY skinId` approximate `ORDER BY createdAt` without needing the composite index (R8 quota). Library: Node's `crypto.randomUUID()` emits v4 in Node 20+, NOT v7. Need an external package OR hand-roll v7 (32 LOC). **Decision: hand-roll v7 in `lib/firebase/uuid-v7.ts`** (same shape as M7's hand-rolled PNG encoder) to avoid a new dep. Rejected alternatives: `uuid` npm package (+ ~2 KB server), nanoid (no timestamp sort), firestore's auto-ID (non-sortable).
- **D8. Client reuses `lib/editor/export.ts::exportLayersToBlob` unchanged.** The 64×64 skin PNG is produced by the M8 pipeline. The publish flow wraps it in a multipart-form-data body with the OG blob.
- **D9. The `/api/skins/publish` route returns `{ skinId, permalinkUrl, ogImageUrl }`.** `permalinkUrl` is `<origin>/skin/{skinId}` (path not yet implemented — M12). Returning it now lets the PublishDialog show a "copy link" affordance even before the detail page exists. Dead link = acceptable (user copies a link they can test once M12 ships; the gallery listing in M12 also lists it).
- **D10. Tag normalization: lowercase, trim, dedupe, 8 max, 32 chars each.** Client enforces at form submit; server re-enforces on receipt and 400s on violation. This matches DESIGN §11.5 `tags.size() <= 8` exactly; DESIGN doesn't specify per-tag length but 32 is generous. DESIGN §11.3's composite index on `tags` (CONTAINS) doesn't care about length.
- **D11. PublishDialog's "name" field is required, min 1, max 50 chars.** No profanity filter in M11 (deferred with moderation to M14). Trim + collapse whitespace runs client + server. Empty after trim → 400.
- **D12. The PublishDialog always opens over the current editor state; does NOT validate "has edits."** The M8 0 ms-edit export guardrail is a separate contract for export; publish is its own action. A user MAY publish an unedited template → that's fine; the gallery will end up with many "blank base" entries if anyone abuses this, but that's an ecosystem-level problem M14 moderation handles, not a write-path concern.
- **D13. Server env var validation is fail-fast at route invocation time.** Same pattern as M10's `/api/auth/session`. `validateEnv` checks `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_BUCKET_NAME`, `FIREBASE_ADMIN_*`. Missing → 500 with "Service not configured" message; the client shows a generic error.
- **D14. Server uses `@supabase/supabase-js` createClient with `auth: { persistSession: false, autoRefreshToken: false }` and the service-role key.** Stateless per-request client. No singleton — cold starts instantiate fresh, warm starts reuse closure-scope if possible but not required for correctness.
- **D15. Name collisions allowed.** Two users can publish two skins both named "Cool Dog". `skinId` is the unique key; name is just display metadata. The M12 gallery can show both.
- **D16. No ETag / If-None-Match / dedupe of identical uploads.** A user publishing the same pixel-identical skin twice gets two `/skins` docs. Accepted — fighting this would require a SHA over the PNG on every upload, which adds a server dep for near-zero user value.

## Open Questions

### Resolved During Planning

- **How does `/users/{uid}` get created on first publish?** Via `set(…, { merge: true })` in the same WriteBatch. Default username is `user-<base36 slice of uid>` (12 chars). User can rename in M13 (no-op placeholder for now).
- **What happens if skinCount increment lands but skin create fails?** Can't happen with WriteBatch — both succeed or both fail atomically. Documented in D3.
- **What's the OG image's exact camera angle?** DESIGN §11.6 specifies: camera at `(2.5, 1.5, 3.5)` looking at `(0, 0.8, 0)`, 35° FOV. Lighting: 1 dir at `(5,5,5)` 1.2 intensity + 1 dir at `(-3,2,4)` 0.4 rim + 1 dir at `(0,3,-5)` 0.6 back + ambient 0.3. All verbatim from DESIGN — no new decisions.
- **Does the editor need to block UI during publish?** Yes — PublishDialog shows a spinner + disabled form; Escape and backdrop click are ignored while `state === 'loading'`. Matches M10 AuthDialog's pattern.
- **Mobile browsers: does WebGL screenshot work?** iOS Safari 14+, Chrome Android, all modern mobile browsers support `preserveDrawingBuffer`. Edge case: Safari Private Browsing has WebGL but may throttle offscreen canvases. Covered by D5 fallback: OG generation failure → publish proceeds with null OG.
- **Do we need a separate API route to delete a publish?** No — out of scope per "No delete flow" in Scope Boundaries.
- **Where does the "Publish" button live?** In `EditorHeader`, between the home link and the UserMenu. When signed out, the button either (a) is hidden OR (b) opens AuthDialog with a "Sign in to publish" pre-filled hint. **Decision: (b)** — discoverability beats tidiness. Clicking Publish while signed out opens the same AuthDialog M10 uses. The button is always visible.
- **Does publish trigger the M8 first-paint-pulse?** No — first-paint is about onboarding an empty editor, not congratulating a publish. Separate UX moments. Accepted.

### Deferred to Implementation

- **The exact timing of the "publish successful" toast.** Fits in a shared Toast component we don't have yet. M11 either (a) adds a minimal inline toast in PublishDialog (fades out in 3s before closing), or (b) just closes the dialog + relies on the url-copy affordance as the success signal. Decide at /ce:work time based on how the dialog code reads.
- **The URL-copy affordance's exact shape.** Button that copies `permalinkUrl` to clipboard, shows "Copied!" for 2s, then resets. Falls back to `document.execCommand('copy')` on browsers without `navigator.clipboard.writeText`? Check at implementation time whether we support old Safari.
- **Whether to emit a Firestore server timestamp for `createdAt` vs a client-generated timestamp.** DESIGN §11.3 implies server timestamp. Admin SDK exposes `FieldValue.serverTimestamp()`. Use it — the field is Timestamp type and server-source is correct. Defer to implementation because I want to double-check the Admin SDK import path doesn't conflict with the client-SDK's `serverTimestamp` helper.
- **Whether `generateOGImage` uses the existing texture atlas from the TextureManager or composites fresh.** Reading the TextureManager's canvas directly saves a composite pass but creates a `WebGLTexture` from a `CanvasTexture`. Building fresh from Layer[] uses M8's export pipeline but costs a redundant composite. Both work; decide during /ce:work based on whether `THREE.CanvasTexture` converts cleanly.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Publish flow — sequence diagram

```text
 PublishDialog          Client helpers              /api/skins/publish           Supabase       Firestore
 ────────────           ───────────────             ───────────────────          ──────         ─────────
      │                        │                            │                      │              │
 [User fills                    │                            │                     │              │
  form, clicks                  │                            │                     │              │
  Publish]                      │                            │                     │              │
      │                        │                            │                      │              │
      │──build skin PNG───────►│                            │                      │              │
      │                  exportLayersToBlob(layers)         │                      │              │
      │◄──blob(64×64 PNG)──────│                            │                      │              │
      │                        │                            │                      │              │
      │──render OG image──────►│                            │                      │              │
      │               generateOGImage(texture, variant)     │                      │              │
      │◄──blob(1200×630 WebP) or null on error─────────────│                      │              │
      │                        │                            │                      │              │
      │──POST multipart/form─ ─►─────────────────────────► │                     │              │
      │   { name, tags, variant, skinPng, ogWebp }         │                     │              │
      │                        │                            │                      │              │
      │                        │                            │─verify session──► getServerSession
      │                        │                            │◄────{uid}──────────│              │
      │                        │                            │                      │              │
      │                        │                            │─generate skinId (UUID v7)─┐        │
      │                        │                            │                      │    │        │
      │                        │                            │─upload skinPng──────►│ (path: skins/{uid}/{skinId}.png)
      │                        │                            │◄── storageUrl ───────│    │        │
      │                        │                            │                      │    │        │
      │                        │                            │─upload ogWebp──────► │ (path: skins/{uid}/{skinId}-og.webp)
      │                        │                            │◄── ogImageUrl ──────│    │        │
      │                        │                            │                      │    │        │
      │                        │                            │─WriteBatch:                         │
      │                        │                            │   skins/{skinId}.set(SharedSkin)────►│
      │                        │                            │   users/{uid}.set({…,skinCount+1},merge)►│
      │                        │                            │◄─────── commit ok ──────────────────│
      │                        │                            │                      │              │
      │◄──200 {skinId, permalink, ogUrl}── ────────────────│                     │              │
      │                        │                            │                      │              │
 [Show "Copied!"                │                            │                     │              │
  toast + close]                │                            │                     │              │
      │                        │                            │                      │              │

Failure branches (rollback):

 If Firestore WriteBatch fails:
   server deletes skins/{uid}/{skinId}.png and skins/{uid}/{skinId}-og.webp
   returns 500 "Publish failed, please retry"
 If og upload fails:
   server deletes skin png, returns 500
 If skin png upload fails:
   server returns 500 (nothing to clean up)
 If session is invalid:
   server returns 401, no writes attempted
```

### Storage + Firestore write boundary

```text
┌─────────────── server route (/api/skins/publish) ────────────────┐
│                                                                  │
│   getServerSession  ─►  Supabase service-role upload  ─►  Firestore WriteBatch
│        │                      │                              │   │
│       uid                 {storageUrl, ogUrl}           created/   │
│                                                         incremented│
│                                │                              │   │
│                                └──────── rollback ──────────► │   │
│                                        (on batch fail)            │
└──────────────────────────────────────────────────────────────────┘
```

## Implementation Units

- [ ] **Unit 0: Dependencies audit**

**Goal:** confirm no new npm packages are needed; document any that are.

**Requirements:** R7.

**Dependencies:** none.

**Files:**
- Modify (conditionally): `package.json`, `package-lock.json`

**Approach:**
- Audit: we already have `firebase` (client + admin), `@supabase/supabase-js`, `firebase-admin`, `three` + R3F, `zustand`, `idb-keyval`.
- UUID v7 hand-rolled in `lib/firebase/uuid-v7.ts` → no new dep.
- OG image is pure three.js → no new dep.
- Tags validation is a ~20-LOC helper → no new dep.
- Expected result: **zero new deps**. If Unit 2 discovers three.js's OffscreenCanvas path needs something, document and justify before adding.

**Test scenarios:** *(none — config-only)*

**Verification:** `npm install` is a no-op. `npm run build` unchanged.

---

- [ ] **Unit 1: PublishDialog component**

**Goal:** ship the UI surface that collects publish metadata.

**Requirements:** R10, R11 (name validation), R12 (tags validation).

**Dependencies:** Unit 0.

**Files:**
- Create: `app/_components/PublishDialog.tsx`
- Create: `app/_components/__tests__/PublishDialog.test.tsx`

**Approach:**
- Copy the ARIA/focus-trap shape from `AuthDialog.tsx` (M10) and `TemplateBottomSheet.tsx` (M7). `role="dialog"`, `aria-modal="true"`, Escape closes, backdrop click closes.
- Form fields: name (required, trimmed, 1–50 chars), tags (optional, comma-separated, normalized to lowercase + deduped + trimmed, max 8 tags × 32 chars each).
- State machine matches AuthDialog: `idle | loading | success | error`. During `loading`, disable all inputs + show spinner on the submit button; Escape + backdrop-click become no-ops.
- On successful publish: show a success state with the permalink + a "Copy link" button (clipboard API with `document.execCommand('copy')` fallback for old Safari). Auto-close after 3 s.
- On error: show inline error message in a muted box, keep form populated so user can retry.
- Props: `isOpen`, `onClose`, `onPublish(skinMeta)` where `skinMeta = { name, tags, variant }`. The actual fetch happens in the integration layer (Unit 6), not the dialog — keeps the dialog testable against a mocked handler.

**Patterns to follow:** `app/_components/AuthDialog.tsx` (state machine + focus trap + ARIA).

**Test scenarios:**
- **Happy path:** open → type valid name → submit → `onPublish` called with normalized payload → loading state displayed.
- **Happy path:** open → success callback → permalink visible → copy button present.
- **Edge case:** empty name → submit disabled (or 400 on submit attempt).
- **Edge case:** name = "   " (whitespace only) → rejected after trim.
- **Edge case:** name = 51 chars → rejected with per-field error.
- **Edge case:** tags = "Cool, Cool, cool ,   BLUE" → normalized to `["cool", "blue"]`.
- **Edge case:** tags = 9 items → rejected with "max 8 tags" error.
- **Edge case:** single tag > 32 chars → rejected.
- **Edge case:** tags field empty → submit succeeds with `tags: []`.
- **Error path:** `onPublish` rejects → error message shown, form re-enabled with user's input preserved.
- **Edge case:** Escape + backdrop click both no-op while `state === 'loading'`.
- **Integration:** focus moves to the first input on open; focus trap cycles within dialog on Tab / Shift-Tab.

**Verification:** 11+ tests pass; dialog is keyboard-navigable; visual inspection in `npm run dev` matches AuthDialog's styling.

---

- [ ] **Unit 2: Client-side OG image generator**

**Goal:** ship the 1200×630 WebP renderer.

**Requirements:** R3, D1.

**Dependencies:** Unit 0.

**Files:**
- Create: `lib/editor/og-image.ts`
- Create: `tests/og-image.test.ts`

**Approach:**
- `'use client'` module exports a single async function `generateOGImage(texture: THREE.CanvasTexture | HTMLCanvasElement, variant: SkinVariant): Promise<Blob | null>`.
- Allocate a fresh offscreen `HTMLCanvasElement` 1200×630. Create a `THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })`.
- Build a single-shot scene: 3 `DirectionalLight`s + 1 `AmbientLight` exactly per DESIGN §11.6 code. Camera: PerspectiveCamera(35, 1200/630, 0.1, 100) positioned at (2.5, 1.5, 3.5) looking at (0, 0.8, 0).
- Build a simplified player mesh (head + body + arms + legs) using the same `partDims` + `getUVs` + `mapBoxUVs` functions from `lib/three/geometry.ts`. This is essentially a static snapshot of `PlayerModel`'s mesh tree — no paint handlers, no animation, no hover state.
- Apply the `CanvasTexture` (or a `Texture` wrapped around the HTMLCanvasElement) to each mesh's material with `magFilter=NearestFilter`, `minFilter=NearestFilter`.
- Render once. Call `canvas.toBlob(cb, 'image/webp', 0.85)`. Dispose renderer + geometries.
- Wrap the whole function body in try/catch. On failure, `console.warn` + return `null` — caller treats null as "publish without OG".

**Patterns to follow:** `lib/three/PlayerModel.tsx` (mesh factory) + `lib/editor/export.ts` (composite→blob pattern).

**Technical design:** *directional only — actual implementation mirrors DESIGN §11.6's code sketch but structured as a pure async function.*

**Test scenarios:**
- **Happy path:** given a 64×64 atlas HTMLCanvasElement + variant='classic', returns a Blob of type `image/webp` with non-zero size.
- **Happy path:** blob starts with WebP signature bytes (`RIFF....WEBP`).
- **Edge case:** given a 64×64 CanvasTexture that's still on a detached canvas (from a unit-test offscreen scenario), renders without throwing.
- **Edge case:** variant='slim' produces a valid blob (different geometry → different UV mapping).
- **Error path:** WebGLRenderer creation throws (no WebGL context) → returns null, console.warn'd.
- **Error path:** `canvas.toBlob` yields null → returns null, not a rejected promise.
- **Integration:** repeated invocations don't leak WebGL contexts (test 10 calls in a loop, assert they all resolve — exact GPU-memory check is hard in vitest/jsdom; the signal is "no errors after N calls").
- **Edge case:** disposed renderer is gone after the function returns — future three.js ops against the same canvas don't see old state.

**Verification:** 6+ tests pass. Manual QA: `npm run dev` → paint → publish → see an OG preview in the success dialog before closing.

---

- [ ] **Unit 3: Server-side Supabase upload module**

**Goal:** encapsulate service-role upload + delete helpers behind a clean API.

**Requirements:** R2, R6 (partial-failure rollback helper).

**Dependencies:** Unit 0.

**Files:**
- Create: `lib/supabase/storage-server.ts` — `server-only` module exporting `uploadSkinAssets`, `deleteSkinAssets`, type helpers.
- Create: `lib/supabase/__tests__/storage-server.test.ts`

**Approach:**
- `import 'server-only'` at top.
- Env read at invocation time (not module load) — `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET_NAME`.
- `createClient` per call (no module-scope singleton for server-side — serverless cold starts don't benefit, warm starts recreate in ~1 ms). Options: `{ auth: { persistSession: false, autoRefreshToken: false } }`.
- `uploadSkinAssets({ uid, skinId, pngBlob, ogBlob })` → uploads PNG first, then OG (if non-null), returns `{ storageUrl, ogImageUrl | null }`. On OG upload failure AFTER png succeeded: deletes png, throws.
- `deleteSkinAssets({ uid, skinId })` → removes both possible files; no-ops if either is already gone. Used by `/api/skins/publish`'s rollback path when Firestore commit fails.
- Both functions throw on env-misconfig with a typed error the caller can map to a 5xx response.

**Test scenarios:**
- **Happy path:** upload PNG + OG → both succeed → returns full URLs under `/storage/v1/object/public/skins/{uid}/{skinId}.png` + `...-og.webp`.
- **Happy path:** upload PNG without OG (ogBlob=null) → returns `{ storageUrl, ogImageUrl: null }`.
- **Error path:** Supabase rejects PNG upload → function throws, no cleanup needed (nothing written).
- **Error path:** Supabase accepts PNG but rejects OG → function deletes PNG and then throws.
- **Error path:** env var missing (SUPABASE_SERVICE_ROLE_KEY unset) → throws "Supabase not configured".
- **Happy path:** `deleteSkinAssets` deletes both files cleanly.
- **Edge case:** `deleteSkinAssets` when one file doesn't exist → no throw (Supabase returns 404 which we swallow).
- **Integration:** tests mock `@supabase/supabase-js`'s `createClient` to simulate success + failure branches without hitting real Supabase.

**Verification:** 7+ tests pass. `tsc --noEmit` passes. Server-only import blocks client bundle — `next build` green.

---

- [ ] **Unit 4: Server-side Firestore skin writes**

**Goal:** the `/skins/{skinId}` create + `/users/{uid}` skinCount increment as an atomic batch.

**Requirements:** R1, R5, R6, R10.

**Dependencies:** Unit 0 (uuid-v7 helper). Unit 3 indirectly via caller flow.

**Files:**
- Create: `lib/firebase/skins.ts` — `server-only` module.
- Create: `lib/firebase/uuid-v7.ts` — hand-rolled UUID v7 generator.
- Create: `lib/firebase/__tests__/skins.test.ts`
- Create: `lib/firebase/__tests__/uuid-v7.test.ts`

**Approach:**
- `uuid-v7.ts` exports `generateUuidV7(): string`. Hand-rolled per RFC 9562 §5.7: 48-bit Unix-millis timestamp, 4-bit version (7), 12-bit random, 2-bit variant (10), 62-bit random. Format as lowercase 36-char hyphenated string. ~30 LOC. Compatible with Node 20 `crypto.getRandomValues`.
- `skins.ts` exports `createSkinDoc({ uid, skinId, name, variant, tags, ownerUsername, storageUrl, ogImageUrl, thumbnailUrl })` → returns `{ skinId, createdAt }`. The function builds the WriteBatch: `skins/{skinId}.set(SharedSkin shape)` + `users/{uid}.set({ createdAt: (if missing), username: (default if missing), skinCount: increment(1) }, { merge: true })`. Commits.
- Uses Admin SDK from `getAdminFirebase()` (M9).
- `createdAt` and `updatedAt` are `FieldValue.serverTimestamp()` on the skin doc; `createdAt` on users is a conditional (only sets on first-publish because merge doesn't overwrite if present).
- Type matches `SharedSkin` from M9's `lib/firebase/types.ts`.
- Since this is Admin-SDK driven, it bypasses firestore.rules — the rule still applies for any M12+ client-side updates, but for M11's server-side create it's the function's responsibility to honor the rule's invariants (R5).

**Test scenarios:**
- **Happy path:** valid inputs → batch commits → Admin SDK's `batch.set` called twice, `batch.commit` called once.
- **Happy path:** skinCount increment uses `FieldValue.increment(1)` (assertable via mock).
- **Happy path:** missing /users/{uid} → merge:true creates it with the default username (`user-<base36>`) and skinCount:1.
- **Happy path:** existing /users/{uid} → merge:true leaves existing fields untouched, only bumps skinCount.
- **Edge case:** name contains emoji / unicode → passes through verbatim (Firestore handles UTF-8 natively).
- **Edge case:** tags = [] → Firestore stores empty array.
- **Error path:** Admin SDK `batch.commit` throws → error propagates to caller (doesn't silently swallow).
- **Edge case:** skinId already exists (duplicate UUID v7 — astronomically unlikely but) → `set` overwrites silently; document this as known behavior since the plan's D7 decision accepts the tradeoff.
- `uuid-v7.test.ts`: 4+ tests — format (36 chars, hyphens in right places), version nibble = 7, variant bits = 10, timestamp monotonicity across rapid calls, uniqueness across 1000 sequential calls.

**Verification:** 8+ tests in skins.test.ts + 4+ in uuid-v7.test.ts. `tsc --noEmit` clean.

---

- [ ] **Unit 5: `/api/skins/publish` API route**

**Goal:** orchestrate auth → upload → Firestore with rollback on failure.

**Requirements:** R2, R4, R6, R10, R13.

**Dependencies:** Units 3 + 4. Indirectly Unit 2 (the client sends the OG blob).

**Files:**
- Create: `app/api/skins/publish/route.ts`
- Create: `app/api/skins/__tests__/publish.test.ts`

**Approach:**
- `import 'server-only'` + `export const runtime = 'nodejs'` explicitly.
- POST body is multipart/form-data with fields: `name`, `tags[]`, `variant`, `skinPng` (File/Blob), `ogWebp` (File/Blob | undefined).
- Flow: (1) `getServerSession()` — return 401 if null. (2) Parse + validate body: name length, tags count + shape, variant ∈ {classic, slim}, skinPng size ≤ 100 KB + content-type == image/png, ogWebp (if present) ≤ 300 KB + content-type == image/webp. Return 400 on any violation with a specific field error. (3) Generate skinId via uuid-v7. (4) Call `uploadSkinAssets` from Unit 3. (5) Call `createSkinDoc` from Unit 4. (6) On any failure between (4) and (5) success: call `deleteSkinAssets` for cleanup. (7) Return `{ skinId, permalinkUrl: `/skin/${skinId}`, storageUrl, ogImageUrl, thumbnailUrl: storageUrl }` with 200.
- `thumbnailUrl === storageUrl` for M11 — future milestone may add a dedicated thumbnail resize pipeline.
- `ownerUsername`: derived from the session's email local-part OR the existing /users/{uid}.username if it exists. Server-side read before the batch commit.
- All logs use structured format: `console.log({ route: '/api/skins/publish', uid, skinId, phase: 'upload|firestore|rollback', ok: true|false })`. No PII in logs beyond uid.
- Response headers: `Content-Type: application/json`. No cache headers needed (POST isn't cached).

**Patterns to follow:** `app/api/auth/session/route.ts` (M10) — env validation, try/catch shape, session-cookie reading, 401/500 partitioning.

**Test scenarios:**
- **Happy path:** signed-in user POSTs valid multipart → 200 with `{skinId, permalinkUrl, storageUrl, ogImageUrl}` where skinId matches UUID v7 regex.
- **Error path:** no session cookie → 401, no side effects.
- **Error path:** expired session → 401 (use `checkRevoked=true` through getServerSession's config).
- **Error path:** missing name → 400 field-error response.
- **Error path:** 9 tags → 400.
- **Error path:** oversized PNG (>100 KB) → 400.
- **Error path:** wrong content-type on skinPng (JPEG, WebP, etc.) → 400.
- **Error path:** Supabase upload throws → 500, no Firestore writes attempted.
- **Error path:** Firestore commit throws → 500, Supabase assets cleaned up (assert `deleteSkinAssets` called).
- **Happy path:** no OG blob → 200, Firestore doc has `ogImageUrl: null`, only PNG uploaded.
- **Integration:** uses same `vi.hoisted` + `vi.mock` pattern as M10 session tests — mock `getServerSession`, `uploadSkinAssets`, `createSkinDoc`.
- **Edge case:** user publishes their first skin → /users/{uid} doc is created by the WriteBatch (asserted on createSkinDoc's mock call).

**Verification:** 11+ tests pass. `tsc --noEmit` clean.

---

- [ ] **Unit 6: Editor integration — Publish button + flow wiring**

**Goal:** wire the button, the dialog, and the POST into EditorHeader.

**Requirements:** R7 (no client bundle growth), R10.

**Dependencies:** Units 1, 2, 5.

**Files:**
- Modify: `app/_components/EditorHeader.tsx`
- Create: `app/_components/__tests__/EditorHeader-publish.test.tsx` (separate file because the existing EditorHeader test file is already layered with next/dynamic + auth mocks; another test file for the publish path keeps each concern isolated).

**Approach:**
- Add a "Publish" button in `EditorHeader`, visible when `!loading`. Position: between the home link and the right-side auth UI (left-aligned group has home + Publish; right-aligned has UserMenu / Sign-In).
- On click:
  - If not signed in → open AuthDialog with a pre-set intent hint ("Sign in to publish"). The existing AuthDialog already handles both signin and signup via state machine; a prop `initialHint?: string` adds a muted line above the form. Backward-compat: prop is optional.
  - If signed in → open PublishDialog.
- PublishDialog's `onPublish(meta)` handler:
  - Read the current layers + active variant from the store (use the same `layersRef` pattern from EditorLayout).
  - Call `exportLayersToBlob(layers)` → png blob.
  - Call `generateOGImage(textureManagerCanvas, variant)` → og blob or null.
  - Build FormData: name, tags (multiple tag fields), variant, skinPng, ogWebp (if non-null).
  - `fetch('/api/skins/publish', { method: 'POST', body: formData, credentials: 'include' })`.
  - On 200: hand result back to PublishDialog's success state.
  - On non-200: hand error message back.
- **Lazy-load both PublishDialog and generateOGImage via dynamic import() inside the click handler** — same pattern as M10's `firebase/auth` inside UserMenu. Keeps the heavy three.js code path (OG generator creates a fresh WebGLRenderer) out of the editor's critical-path bundle. PublishDialog is also lazy because it's only rendered on open.
- No changes to existing UserMenu or AuthDialog (except for adding the optional `initialHint` prop on AuthDialog).

**Patterns to follow:** `EditorHeader.tsx` (M10) — conditional rendering by auth state + the lazy-dialog opening pattern.

**Test scenarios:**
- **Happy path:** signed-in user clicks Publish → PublishDialog opens.
- **Happy path:** signed-out user clicks Publish → AuthDialog opens with "Sign in to publish" hint text.
- **Happy path:** after signing in, user's next Publish click opens PublishDialog (not AuthDialog).
- **Integration:** PublishDialog's onPublish handler calls `exportLayersToBlob` then `generateOGImage` then `fetch('/api/skins/publish', ...)` in order.
- **Error path:** fetch rejects → error flows back into PublishDialog's error state.
- **Error path:** `exportLayersToBlob` throws → PublishDialog shows error, publish not attempted.
- **Edge case:** `generateOGImage` returns null → FormData is built without `ogWebp` field.
- **Edge case:** Publish clicked while loading=true (auth resolving) → button is disabled.
- **Integration:** existing EditorHeader tests continue to pass (no regression in signin/signout/loading states).

**Verification:** 8+ tests pass. Existing EditorHeader tests green. Manual QA via `npm run dev`: sign in → click Publish → submit → verify success state → verify Firestore doc exists + Supabase objects created.

---

- [ ] **Unit 7: Production deployment + manual QA**

**Goal:** ship to Vercel production and verify end-to-end on the deployed URL.

**Requirements:** R1–R10 (all must pass in prod).

**Dependencies:** Units 1–6.

**Files:**
- Modify: `docs/COMPOUND.md` (append M11 entry).
- Modify: `docs/plans/m11-skin-upload-plan.md` (status → completed).

**Approach:**
- `npm run build` clean → open PR → review → merge.
- Verify Vercel deploy succeeds.
- Verify Vercel has `SUPABASE_SERVICE_ROLE_KEY` env var set (Supabase dashboard → Settings → API → `service_role` key → Vercel project → env vars → add as "Sensitive"). M10 already set the anon key; service-role is new for M11.
- Verify Supabase `skins` bucket exists + has the M9-documented RLS policies.
- Run through the full manual QA checklist (see below).

**Test scenarios:** *(none — operational)*

**Manual QA checklist (run against production URL):**
- [ ] Sign in (Google or Email/Password).
- [ ] Paint a skin (any edits — doesn't have to be impressive).
- [ ] Click "Publish" in the header → PublishDialog opens.
- [ ] Type a name + 2 tags → Submit.
- [ ] See the success state with a permalink URL + Copy button.
- [ ] Click Copy → clipboard has the permalink.
- [ ] Navigate to https://supabase.com/dashboard/project/hpuqdgftumcfngxkzdah/storage/buckets/skins → verify `skins/{your-uid}/{new-skinid}.png` exists.
- [ ] Verify `skins/{your-uid}/{new-skinid}-og.webp` exists.
- [ ] Navigate to https://console.firebase.google.com/project/threditor-2ea3c/firestore/data/~2Fskins~2F{new-skinid} → verify the doc exists with correct fields.
- [ ] Navigate to `/users/{your-uid}` doc → verify skinCount is 1 (or N+1 if you had prior skins).
- [ ] Sign out → click Publish → AuthDialog opens with "Sign in to publish" hint.
- [ ] Sign back in → publish a second skin → skinCount is now 2.
- [ ] Publish a third skin with 8 tags → succeeds.
- [ ] Publish with 9 tags → dialog shows validation error, no network call.
- [ ] Publish with empty name → validation error.
- [ ] Open DevTools → Network → observe POST /api/skins/publish succeeds with 200 + sane response body.
- [ ] Open DevTools → Application → Cookies → session cookie still present after publish.

**Verification:** all 16 checklist items green. PR merged. M11 COMPOUND entry captures what was learned.

## System-Wide Impact

- **Interaction graph:** new `/api/skins/publish` route. New client-side call chain: EditorHeader → PublishDialog → (lazy) OG generator + (existing) export.ts → fetch. Existing AuthDialog gets an optional `initialHint` prop — backward-compatible.
- **Error propagation:** client network error → PublishDialog error state. 401 from server → PublishDialog closes + AuthDialog reopens (re-authenticate). 400 (validation) → PublishDialog inline error. 500 → PublishDialog generic error.
- **State lifecycle risks:** partial-write between Supabase and Firestore is the main risk. Mitigated by Unit 3's rollback helper and Unit 5's explicit error-branch calling it. Additional risk: `/users/{uid}` may not exist before publish → mitigated by `set({...}, { merge: true })` in Unit 4's WriteBatch.
- **API surface parity:** `/api/skins/publish` is new. Future M13 (rename skin) + M14 (delete skin) will add sibling routes; their contracts can mirror this one's shape.
- **Integration coverage:** the end-to-end manual QA in Unit 7 is the canonical integration proof; unit tests alone can't verify Supabase's real behavior nor Firestore's batch commit against a live project.
- **Unchanged invariants:**
  - M6 narrow-selector store access — unchanged.
  - M7 TIMING + apply-template flow — unchanged.
  - M8 export pipeline — reused unchanged.
  - M10 session cookie + getServerSession — reused unchanged.
  - M9 firestore.rules — rules are unchanged by this plan; the `skins.create` rule still applies for any future client-side create path, but M11's server path is Admin-SDK (rules bypass). Security is stricter, not looser.
  - M10 /editor First Load JS (478 kB) — target: +5 kB max from the PublishDialog + FormData build; OG generator and server modules are code-split away.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Orphaned Supabase uploads after Firestore commit failure. | Explicit `deleteSkinAssets` call in Unit 5's error branch. Tests assert this path. |
| `SUPABASE_SERVICE_ROLE_KEY` leaked to client bundle. | `server-only` import on Unit 3's module. Import graph verified by `next build` (the package throws at build time if a client component imports it). |
| UUID v7 hand-roll is wrong → non-sortable IDs or collision. | `crypto.getRandomValues` is cryptographically random; version/variant bits are tested explicitly in Unit 4; monotonicity test across 1000 calls in Unit 4. |
| Client OG generation fails on mobile Safari Private Browsing. | Documented acceptable degradation — publish proceeds with `ogImageUrl: null`. D5. |
| Firestore rules change between plan + implementation invalidates assumption that rules are bypassed by Admin SDK. | Admin SDK is documented by Firebase as bypassing rules. Plan re-validates this at Unit 4 test time (the `batch.commit` mock is stubbed; the actual Admin-bypass behavior is a Firebase platform invariant). |
| `/users/{uid}` doc's `createdAt` gets overwritten on re-publish by `merge:true`. | Use `FieldValue.serverTimestamp()` only on the first-publish create via a conditional in Unit 4 — if the doc doesn't exist when the batch commits, Firestore's serverTimestamp lands; if it does, `{ merge: true }` preserves the original. Test with an existing-user fixture. |
| `firebase-admin`'s gaxios transitive vulns (M9-accepted) expand attack surface because we're now making real writes. | Server-only scope + short-lived request handlers. Revisit if a specific CVE publishes an RCE for gaxios in the installed version range; for now, accept the M9 decision. |
| Clipboard API failure on old Safari. | Fallback to `document.execCommand('copy')` (deprecated but universal). Doc'd as acceptable in Unit 1. |
| First-time publisher has no username + the server-generated default collides with another user's chosen username. | Default is `user-<12-char-base36-uid-slice>` which has a collision space of ~10¹⁸. Collisions are astronomically unlikely. If one does occur, the rename flow in M13 lets the user fix it. |
| Publish button takes too much visual real estate on mobile. | Use `hidden sm:inline` on the label text; icon-only on mobile. |
| `/api/skins/publish` hit by spam bots doing 20K writes/day. | Quota-level mitigation lives in Firestore rules (not M11) + future rate-limiting middleware (not M11). For M11, the session-cookie requirement + Firebase Auth's rate limits on sign-in are the control surface. Accepted. |

## Documentation / Operational Notes

- **Vercel env var update required before first deploy:** `SUPABASE_SERVICE_ROLE_KEY` must be added to all three environments (Production, Preview, Development). Not a `NEXT_PUBLIC_*` — this is the server-only service role key, never in the client bundle. Mark as Sensitive in the Vercel dashboard.
- **Supabase bucket policies must exist** per `docs/supabase-storage-policies.md`. Service-role uploads bypass RLS, but if RLS is missing entirely the bucket isn't functional. Re-verify during Unit 7.
- **Firestore Admin SDK writes bypass rules** — this is a deliberate architectural choice. M11's invariants (R5) must be enforced at the write function level, not relied on from rules. Future reviewers: don't assume firestore.rules is the complete security boundary for skins.
- **Supabase service-role key rotation:** if the key is ever rotated, Vercel env var must be updated AND a `vercel --prod` redeploy triggered. Old deployments stay working until scaled down.
- **No new ops monitoring:** the existing Firebase + Supabase dashboards cover usage. Write-rate dashboards on both are the first place to look if quota becomes a concern.

## Sources & References

- **DESIGN.md §3, §4.1, §11.3, §11.5, §11.6, §11.7** — primary design document.
- **`docs/COMPOUND.md` §M9 + §M10** — pinned facts (Supabase RLS divergence, session cookie pattern, bundle baseline, server-only barrier).
- **`docs/supabase-storage-policies.md`** — RLS policies (manual Supabase dashboard setup).
- **`lib/editor/export.ts`** — the M8 compositor reused.
- **`lib/firebase/admin.ts`** — M9 Admin SDK singleton.
- **`lib/firebase/auth.ts`** — M10 getServerSession.
- **`app/api/auth/session/route.ts`** — M10 API route pattern.
- **`app/_components/AuthDialog.tsx`** — M10 dialog pattern.
- **RFC 9562 §5.7** — UUID v7 format.
- **Supabase JS v2 storage docs** — `createClient` + `.from(bucket).upload` API.

## Estimated Complexity

**T-shirt: L (large).** Cross-cutting: two external services, new API route, new client UI, new server modules, OG image rendering. 7 units, ~1000 LOC of production code, ~600 LOC of tests.

Solo-sequential estimate: 8–12 hours. With parallel-agent dispatch on Units 1 + 2 + 3 + 4 (no shared dependencies), compressible to 5–7 hours of wall-clock.
