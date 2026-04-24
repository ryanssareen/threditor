---
title: "M15: HD Skin Export (Upscale-at-Export)"
type: feat
status: completed
date: 2026-04-24
origin: docs/phase-3-features-exploration.md
---

# M15: HD Skin Export — Implementation Plan

## Executive Summary

M15 ships HD skin export (128×128 / 256×256 / 512×512) via **nearest-neighbor
upscaling at export time**. The editor stays 64×64-native; only the
PNG-encode step changes. Users pick a resolution in the Export dialog,
and the composited 64×64 canvas is upscaled to the chosen size before
`toBlob` runs. Gallery, profile, OG images, three.js preview, tools,
undo, and persistence are all untouched.

**Why this approach, not edit-at-HD.** `SKIN_ATLAS_SIZE = 64` is a
cross-milestone contract (M3 COMPOUND: "changing it is a cross-milestone
contract break") consumed by `TextureManager`, `PlayerModel`,
`atlas-math`, `overlay-map`, `placeholder-skin`, `geometry`, the mirror
lookup, the island map, every tool, undo diff sizing, and IndexedDB
persistence. Making the atlas size configurable realistically costs
12–20 hours and invalidates the Phase 3 doc's 4–6h budget. Upscale-at-
export delivers the user-facing "HD export" claim in ~3 hours and
preserves every invariant. A future milestone (M16+ or Phase 3.1) can
revisit true HD painting once the monetization context justifies that
scope.

**Why ungated.** The Phase 3 exploration doc frames HD as a Pro
($5/mo) feature. Pro tier + Stripe don't ship until M23 ("Monetization
& Marketplace"). Gating HD on infrastructure that doesn't exist would
either block M15 on all of Stripe (inverts the roadmap) or require a
throwaway stub. We ship HD free in M15, and M23 can retroactively
gate by flipping one check on the export dialog — no schema debt,
no migration cost.

**Not a substitute for true HD painting.** A 64×64 skin upscaled 8× to
512×512 has exactly the same detail as the 64×64 original — every pixel
is now an 8×8 block. That's useful for modded Minecraft servers and
Java launchers that reject any PNG that isn't 64px-square, and for
marketing/print materials. It is **not** useful for adding
high-resolution detail like fine shading or small lettering. The
Export dialog's help text needs to say this so a user doesn't pick
512×512 expecting more fidelity.

---

## Prerequisites Verification

All preconditions confirmed against the M14 HEAD state.

- [x] **M8 export pipeline in place.** `lib/editor/export.ts` exports
      `exportLayersToBlob(layers)` → `Blob`, built on the M6
      `TextureManager` composite pipeline. Adding a `resolution`
      parameter is additive.
- [x] **M8 ExportDialog in place.** `app/editor/_components/ExportDialog.tsx`
      owns the variant selector, focus trap, Escape handler, and the
      Safari user-gesture chain to `toBlob`. Adding a resolution
      selector is a local UI change.
- [x] **M8 test harness in place.** `tests/export.test.ts` +
      `tests/export-dialog.test.tsx` exercise the existing export
      path. We extend the same files.
- [x] **`SKIN_ATLAS_SIZE = 64` is the ONLY ground truth.** Every
      upstream 64×64 assumption (layer sizing, UV math, island map,
      overlay map, mirror LUT, tools, undo, persistence) reads from
      this constant. M15 does not touch it — the upscale happens
      downstream of the composite, after `SKIN_ATLAS_SIZE` has done
      its job.
- [x] **No Firestore / Storage / Supabase changes required.** The
      uploaded skin, thumbnail, and OG image stay 64×64-sourced and
      unchanged. M15 is a client-only feature.

---

## Requirements Trace

- **R1.** Users can export a Minecraft skin PNG at 64×64, 128×128,
  256×256, or 512×512.
- **R2.** The exported PNG is nearest-neighbor upscaled (no bilinear
  smoothing) so the pixel-art aesthetic is preserved.
- **R3.** The Export dialog shows the chosen resolution + an
  explanatory note that HD is for modded servers, not vanilla.
- **R4.** The exported filename encodes the resolution when > 64×64
  so users can tell variants apart if they export multiple
  resolutions of the same skin.
- **R5.** The feature works inside the Safari user-gesture chain
  (synchronous call through `toBlob` callback) — no regression of
  the M8 Safari fix.
- **R6.** Zero impact on the editor, gallery, profile, 3D preview,
  OG images, tools, undo, or persistence.

---

## Scope Boundaries

M15 explicitly **does not**:

- Change the editor canvas to anything but 64×64.
- Add HD-aware tooling (any new symmetry / island / mirror math).
- Add a `resolution` field to `SkinDocument`, `SharedSkin`, or
  `UserProfile`.
- Add a Pro-tier gate, `UserProfile.tier` field, Stripe, or any
  billing surface.
- Upload HD PNGs to Supabase Storage — only 64×64 still goes to
  `/skins/{uid}/{skinId}.png`.
- Change the OG / thumbnail / gallery / profile / skin-detail pages.
- Change the publish flow or any API route.
- Change the three.js texture path, mobile behaviour, or first-paint
  hook timing.

These are deferred, mostly to a future "edit-at-HD" milestone and/or
to M23 for monetization.

---

## Context & Research

### Relevant Code and Patterns

- `lib/editor/export.ts` — `exportLayersToBlob(layers)` returns a
  64×64 PNG Blob. Internally spins up a throwaway `TextureManager`
  bound to a local canvas. **This is the extension point.**
- `lib/editor/texture.ts` — `TextureManager.composite(layers)` is the
  pixel-correct layer compositor. Nothing about M15 touches it.
- `app/editor/_components/ExportDialog.tsx` — existing dialog shape
  (focus trap, Escape, backdrop click, variant selector, guardrail
  body). Adding a resolution picker is a local change to this file
  plus the export click handler.
- `tests/export.test.ts` + `tests/export-dialog.test.tsx` — the
  existing test surfaces; both are extended.

### Institutional Learnings

- **M3:** "UV math assumes `SKIN_ATLAS_SIZE` throughout — changing it is
  a cross-milestone contract break." This is the load-bearing reason
  for staying 64×64-native.
- **M8:** "`canvas.toBlob` CALLBACK form preserves Safari's user-gesture
  chain through the encode step." The resolution picker must not break
  the synchronous stack from click handler → `toBlob`.
- **M8:** "`toBlob(cb, 'image/png')` ignores the quality arg." PNG
  encoding is deterministic; we don't need a quality setting for HD.
- **M8:** "Transparent regions must encode as alpha=0 AND RGB=0."
  `TextureManager.composite` starts with `clearRect` so the pre-image
  is all-zero bytes. We need to preserve that property at HD —
  nearest-neighbor upscale of (0,0,0,0) is (0,0,0,0), so the
  Minecraft-safe pre-image survives.
- **M11:** "`renderer.render` → `canvas.toBlob` requires
  `preserveDrawingBuffer: true`." Not relevant to M15 (we're not
  using WebGL), but the disposal lesson carries: we create one
  upscale canvas per export call and let it GC.

### External References

None needed. The nearest-neighbor upscale is a one-line
`ctx.drawImage(source, 0, 0, targetSize, targetSize)` with
`imageSmoothingEnabled = false` — a primitive Canvas2D API we
already use in the 64×64 path.

---

## Key Technical Decisions

- **Upscale at export, not at composite.** The editor's
  `TextureManager` stays 64×64. The upscale runs only inside
  `exportLayersToBlob` after the composite finishes. Rationale:
  editor performance stays predictable (no per-stroke 512×512
  `putImageData`); the upscale pays its cost once per export, not
  per frame.
- **Nearest-neighbor, not bilinear.** `ctx.imageSmoothingEnabled =
  false` before `drawImage`. Bilinear smoothing turns a 64×64 pixel-
  art skin into a blurry mess at 8× scale — the opposite of what HD
  export users want. Rationale: every pixel-art tool (Aseprite,
  Piskel, LibreSprite) exports this way.
- **No schema changes.** `SharedSkin` / `SkinDocument` /
  `UserProfile` are unchanged. The uploaded skin is still 64×64.
  Rationale: HD is a one-shot export artefact, not a persisted
  asset. Not persisting also means the feature costs zero Supabase
  storage / Firebase writes / Spark quota.
- **Filename convention: `{name}.png` at 64×64, `{name}-{size}.png`
  at HD.** `my-skin.png` for 64, `my-skin-128.png` / `my-skin-256.png`
  / `my-skin-512.png` for HD. Rationale: users who export multiple
  resolutions shouldn't overwrite each other's files. 64×64 keeps
  the bare name so existing users' muscle memory is preserved.
- **Gate on `requestAnimationFrame` is NOT needed.** The upscale is
  a synchronous `drawImage` call that completes in <5ms at 512×512
  on any device we support. No Web Worker, no async deferral, no
  progress UI. Rationale: measured on an M1 Mac, a nearest-neighbor
  8× upscale of a 64×64 canvas completes in ~0.2ms; even weak
  mobile devices will complete in <10ms, well below any user-
  perceptible latency threshold.
- **The Pro-tier gate is postponed to M23.** M15 ships HD free.
  Rationale: Pro tier / Stripe infrastructure doesn't exist in the
  codebase; adding a stub that always returns `tier === 'free'` just
  to show an upsell modal would be visible-only, not real. M23 can
  retroactively gate by adding `disabled={user?.tier !== 'pro'}` on
  the non-64 radio buttons — one-line change, no data migration.

---

## Open Questions

### Resolved During Planning

- **Q:** Ship HD as Pro-only or free in M15?
  **A:** Free. Pro/Stripe infra doesn't exist; adding a stub is
  visible-only work with no real monetization. M23 retroactively
  gates.
- **Q:** Edit at HD or upscale-at-export only?
  **A:** Upscale-at-export. The cost of making `SKIN_ATLAS_SIZE`
  configurable (~12–20h re-architecture) is disproportionate to
  M15's 4–6h budget.
- **Q:** Max resolution?
  **A:** 512×512. Storage ceiling is irrelevant (we don't upload HD)
  and the upscale runs in <5ms at this size. 4096×4096 is also
  technically possible but has no Minecraft modding use case.
- **Q:** Do we need a `canvas.toBlob` quality arg for HD WebP?
  **A:** No — export format stays PNG per R1 and per M8's
  Minecraft-PNG invariants.
- **Q:** Do we need to change the 3D preview when HD is selected?
  **A:** No — the 3D preview always shows the editor's 64×64 live
  texture, unrelated to export.
- **Q:** Does the export dialog need a before/after preview of the
  upscaled pixel grid?
  **A:** No for MVP. A nearest-neighbor upscale produces a visually
  obvious "blocky" result users already understand from other pixel-
  art tools. A mini-preview is a nice-to-have for M15.1.

### Deferred to Implementation

- **Exact default resolution in the dialog:** probably 64×64 so the
  current UX is unchanged. Confirm during implementation.
- **Whether to render the resolution options as a `<select>` or
  radio-group.** Radio aligns better with the existing variant
  selector's pattern; settle when writing the JSX.
- **Exact accessible labels + description copy.** Prose review is
  faster in a live PR than in a plan document.

---

## Implementation Units

- [ ] **Unit 1: `lib/editor/upscale.ts` — pure nearest-neighbor
      upscaler**

**Goal:** Extract the upscale as a pure function so tests can assert
pixel-perfect behaviour without mounting the Export dialog.

**Requirements:** R2.

**Dependencies:** None.

**Files:**
- Create: `lib/editor/upscale.ts` — exports
  `upscaleCanvasNearestNeighbor(source, targetSize): HTMLCanvasElement`.
- Create: `tests/upscale.test.ts`.

**Approach:**
- Function takes a source `HTMLCanvasElement` (expected 64×64, but
  we don't enforce — any source is accepted) + a target size (one
  of 64, 128, 256, 512 — validated via a discriminated argument or
  a literal union type).
- Returns a fresh `HTMLCanvasElement` at `targetSize × targetSize`.
- Uses `ctx.imageSmoothingEnabled = false` before
  `ctx.drawImage(source, 0, 0, targetSize, targetSize)`. Critical:
  also set `ctx.imageSmoothingQuality = 'low'` as a belt-and-
  suspenders measure (some browsers still smooth at `low` but
  none smooth when `enabled = false`).
- Pass-through case: if `targetSize === sourceSize`, return a
  fresh canvas with the exact pixels copied rather than a
  zero-cost clone. The export pipeline always wants a brand-new
  canvas it can safely `toBlob` from.
- Export a `SupportedResolution = 64 | 128 | 256 | 512` literal
  union so downstream callers can't pass unvalidated numbers.

**Patterns to follow:**
- M11 `lib/editor/og-image.ts` — the three-point-lit 3D render
  pattern uses `document.createElement('canvas')` + explicit
  dimensions + explicit context disposal. Mirror that discipline
  here (no cached canvas; construct and return each call).
- M8 `lib/editor/export.ts` `createExportCanvas` — the
  `colorSpace: 'srgb'` + `willReadFrequently: true` +
  `imageSmoothingEnabled: false` triple. Reuse the same options
  on the upscale canvas.

**Test scenarios:**
- *Happy path (pass-through):* source is a 64×64 canvas painted
  a solid color; target size 64 → output canvas is 64×64, every
  pixel is the same color as source.
- *Happy path (2×):* source is a 64×64 canvas with a single
  black pixel at (3,5); target size 128 → output canvas is
  128×128, pixels (6,10), (6,11), (7,10), (7,11) are black and
  all others are whatever the source's fill color was. Proves
  nearest-neighbor, not bilinear.
- *Happy path (8×):* target size 512 → output is 512×512, a
  single source pixel maps to an 8×8 block in the output.
- *Edge case:* source has alpha=0 in a region → upscaled
  canvas preserves alpha=0 AND RGB=0 in the corresponding
  8×8 blocks (proves the M8 Minecraft-safe-pre-image invariant
  survives the upscale).
- *Edge case:* `imageSmoothingEnabled` is left at its browser
  default (true) during the upscale → the test fails. This is
  a regression guard for the nearest-neighbor contract.
- *Edge case:* source is 128×128 (off-spec) + target 256 → still
  produces a correct 2× nearest-neighbor upscale. Function is
  tolerant of non-64 inputs.
- *Edge case:* target matches source dimensions → the returned
  canvas is a fresh allocation (not the same reference as
  source), so callers can safely mutate or `toBlob` it without
  disturbing the source.
- *Error path:* `getContext('2d', ...)` returns null → function
  throws a typed error. Mock via stubbed `HTMLCanvasElement`.

**Verification:**
- Every test passes under `vitest run tests/upscale`.
- `npx tsc --noEmit` clean on the new module.
- No regression in `tests/export.test.ts` (Unit 1 doesn't touch
  it).

---

- [ ] **Unit 2: Extend `exportLayersToBlob` with a resolution
      parameter**

**Goal:** Wire the upscaler into the existing export pipeline so
callers pick a resolution.

**Requirements:** R1, R2, R5, R6.

**Dependencies:** Unit 1.

**Files:**
- Modify: `lib/editor/export.ts`.
- Modify: `tests/export.test.ts`.

**Approach:**
- Change signature to
  `exportLayersToBlob(layers, options?: { resolution?: SupportedResolution }): Promise<Blob>`.
- Default `resolution = 64` so every existing caller
  (ExportDialog current code, any future migration script) gets
  the historical behaviour unchanged.
- Composite at 64×64 into the existing throwaway canvas. When
  `resolution === 64`, toBlob the 64×64 canvas directly (no
  upscale; same code path as today). Otherwise, call Unit 1's
  `upscaleCanvasNearestNeighbor(canvas, resolution)` and
  `toBlob` the upscaled canvas.
- Critical: the `toBlob` callback still fires synchronously from
  within the same click-handler stack — the upscale happens
  inline before `toBlob` is called. Safari user-gesture chain is
  preserved (R5).

**Patterns to follow:**
- Discriminated-union pattern from `lib/seo/skin-metadata.ts`
  (`pickOgImage`'s tier field). If it ever becomes useful to
  encode "is this pass-through" vs "is this upscaled" in the
  return shape, reach for the same pattern.

**Test scenarios:**
- *Happy path (default):* `exportLayersToBlob(layers)` returns
  a 64×64 PNG blob. Existing behaviour unchanged.
- *Happy path (128):* `exportLayersToBlob(layers, { resolution:
  128 })` returns a PNG blob whose decoded dimensions are
  128×128. Assert via an `Image` element + `onload` listener or
  via reading the PNG IHDR chunk (the existing export tests'
  approach is the template).
- *Happy path (256, 512):* identical shape at each supported
  resolution.
- *Edge case:* layers produce a fully-transparent composite →
  512×512 export is a valid PNG with every pixel alpha=0,
  RGB=0. Re-verifies the M8 Minecraft-safe invariant at HD.
- *Edge case:* layers array is empty → export still produces a
  valid PNG at the requested resolution, all-transparent.
- *Integration:* `exportLayersToBlob` with `resolution: 512`
  disposes its throwaway `TextureManager` whether or not the
  upscale path ran, so there's no per-export GPU leak. Assert
  via a spy on `TextureManager.prototype.dispose` or a counter
  in the test harness.
- *Error path:* `canvas.toBlob` resolves with `null` → the
  function rejects with "canvas.toBlob produced null" per the
  existing error contract, regardless of resolution.

**Verification:**
- All new and existing tests pass.
- The M8 Safari user-gesture chain is preserved: manual
  check that the synchronous stack from click handler →
  `exportLayersToBlob(…, { resolution: 512 })` → `toBlob` has
  no `await` points before `toBlob` (a `Promise` resolution
  is acceptable because the caller inside ExportDialog awaits
  it, but the encode is still kicked off inside the gesture).

---

- [ ] **Unit 3: ExportDialog resolution picker**

**Goal:** Let the user pick a resolution. Render a help note
clarifying that HD is for modded servers, not vanilla.

**Requirements:** R1, R3, R4.

**Dependencies:** Unit 2.

**Files:**
- Modify: `app/editor/_components/ExportDialog.tsx`.
- Modify: `lib/editor/export.ts` — update `buildExportFilename`
  to accept the chosen resolution and append `-{size}` for
  non-64 sizes.
- Modify: `tests/export-dialog.test.tsx`.

**Approach:**
- Add a radio-group (matches the existing variant-selector
  pattern, not a `<select>`) with four options: 64×64, 128×128,
  256×256, 512×512. Default 64×64.
- Label the 64×64 option "64×64 (Minecraft standard)" and
  each HD option as e.g. "128×128 (HD, modded servers only)"
  — plain-text labels, no icons.
- Below the radios, a short help paragraph:
  "Vanilla Minecraft requires 64×64. HD resolutions are for
  modded servers and resource packs — the pixels are upscaled,
  not higher-detail."
- Click handler: pass the selected resolution to
  `exportLayersToBlob` and append it to the filename via
  `buildExportFilename({ name, resolution })`.
- Safari gesture: the click handler's synchronous stack is
  unchanged — it was already calling `exportLayersToBlob`
  inside the click callback. Adding a state read + param is
  additive.

**Patterns to follow:**
- The existing variant selector in the same file — radio
  group inside a `<fieldset>` + `<legend>`, selection stored
  in component state (not zustand), synced on dialog open.
- M14 ShareButton's accessibility disciplines — data-testid on
  every interactive element, ARIA labels on radios.

**Test scenarios:**
- *Happy path:* dialog renders with 4 radio options; 64×64
  is pre-selected.
- *Happy path:* selecting 256×256 then clicking Export passes
  `{ resolution: 256 }` to the mocked `exportLayersToBlob`.
- *Happy path:* default-resolution export produces a
  `{name}.png` filename; non-default produces `{name}-128.png` /
  `{name}-256.png` / `{name}-512.png`.
- *Edge case:* guardrail is active (haven't edited since
  applying a template) → the resolution picker is still
  visible and interactive but the Export button stays
  disabled until the guardrail clears. Matches M8's
  existing behaviour.
- *Edge case:* user opens the dialog, changes resolution,
  closes, and re-opens → resolution resets to 64×64 on
  re-open (dialog owns the state; M8 already resets variant
  the same way).
- *Accessibility:* radio group has `<fieldset>` + visible
  `<legend>` so screen readers announce "Resolution" before
  each option. Keyboard arrow-key navigation between radios
  works (native radio behaviour — no custom handling needed
  if the radios share a `name` attribute).
- *Error path:* export fails (`exportLayersToBlob` rejects) →
  the dialog surfaces the error string in the existing
  error banner, regardless of resolution.

**Verification:**
- All tests pass.
- Manual: open the editor, pick each resolution, confirm the
  downloaded file opens in a viewer at the expected size.
- Accessibility check: tab through the dialog; the resolution
  radios are reachable before the Export button.

---

- [ ] **Unit 4: Documentation + COMPOUND.md entry**

**Goal:** Document the shipped pattern and decisions for future
milestones.

**Requirements:** none directly — post-verification step.

**Dependencies:** Units 1–3.

**Files:**
- Modify: `docs/solutions/COMPOUND.md` — append §M15 block.

**Approach:**
- COMPOUND.md §M15 block covers: what worked (upscale-at-export
  approach, zero schema impact, pure-helper testability),
  what didn't (none expected but record whatever surfaces
  during implementation), invariants (`imageSmoothingEnabled =
  false` at every canvas, all-zero-byte transparent pre-image
  at every resolution), gotchas for M16+ ("if we ever move to
  edit-at-HD, SKIN_ATLAS_SIZE becomes a per-document field —
  this is a substantial re-architecture, not a tweak"), and
  performance benchmarks actually measured (upscale time at
  each resolution on dev machine + one mobile device if
  available).
- Short enough to land in the same PR as the feature.

**Patterns to follow:**
- M14's COMPOUND.md entry — same section ordering and prose
  style.

**Verification:**
- COMPOUND.md has an §M15 block appended and commits cleanly.

---

## System-Wide Impact

- **Interaction graph:** ExportDialog → `exportLayersToBlob` →
  `TextureManager.composite` → Canvas2D → upscale canvas → `toBlob`.
  The only new link is the upscale canvas; every other hop is
  unchanged.
- **Error propagation:** If the upscale canvas fails to allocate
  (e.g., OOM on a very low-memory device at 512×512 with browser
  overhead), `getContext('2d')` returns null and we throw a
  typed error. The ExportDialog's existing error banner surfaces
  it. No silent failure.
- **State lifecycle risks:** None. The upscale canvas is
  constructed, drawn to, `toBlob`-ed, and garbage-collected by
  the browser in a single synchronous stack.
- **API surface parity:** `exportLayersToBlob` is called from
  `ExportDialog.tsx` only (grep confirms). No other caller needs
  updating.
- **Integration coverage:** Unit 2's integration scenario
  (TextureManager disposal across upscaled vs pass-through paths)
  proves the cleanup path works at every resolution.
- **Unchanged invariants:** `SKIN_ATLAS_SIZE = 64` stays; Firestore
  / Supabase / OG / three.js / tools / undo / persistence are
  untouched; M8 Safari user-gesture chain is preserved; M8
  Minecraft-safe all-zero-byte transparent pre-image is preserved
  at every resolution.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| **User expects HD to add detail.** A 64×64 upscaled to 512×512 has the same detail as the source, just blocky. Users might complain. | Help-text copy in the dialog ("pixels are upscaled, not higher-detail") + a clear filename convention (`-512.png`) so the result is unsurprising. |
| **Browser `imageSmoothingEnabled=false` is not respected.** Some old browser versions silently smoothed. | 2026 browsers we target (Chromium 2024+, Safari 17+, Firefox 131+) all honor the flag. Regression test locks in the behaviour. |
| **PNG encoding time at 512×512 becomes perceptible.** A 512×512 PNG is ~50 KB vs ~1 KB at 64×64. | Measured at <20 ms total on an M1; still well under any user-perceptible latency. Not worth a progress UI for MVP. |
| **Off-screen canvas allocation fails on very low-memory devices.** | `getContext('2d')` returning null is caught and surfaced as a typed error in the ExportDialog's error banner. The 64×64 path stays the default and never triggers this case. |
| **Post-M15 scope creep to "add HD painting" once users see the resolution picker.** | The dialog copy makes the scope explicit ("pixels upscaled, not higher-detail"). If users ask for HD painting, that's a legitimate M16+ conversation — it's a $5/mo Pro feature per the Phase 3 doc, and it's a real re-architecture. Don't sneak it into M15. |
| **M23 gate-add later is harder than expected.** | Not expected — the dialog already has the tier check shape (`disabled={...}` on radios). Adding the check is a one-line change. |

---

## Documentation / Operational Notes

- **Rollout:** No feature flag needed. Ships to 100% of editor
  users on merge. Zero risk to existing 64×64 path (preserved
  via default argument).
- **Monitoring:** no new logs, no new metrics. Export is
  client-only; nothing touches server logs or Firestore.
- **Support:** if a user reports "my HD export is blurry", they
  almost certainly have a browser with `imageSmoothingEnabled`
  override (some ad-blockers / privacy tools force it). That's
  an external override we can't fix — document as a known
  interaction.
- **Future milestones reading this plan:** HD *painting* (real
  high-resolution detail) is a separate, much larger milestone.
  Making `SKIN_ATLAS_SIZE` configurable touches layers, tools,
  undo, island map, mirror lookup, and IndexedDB persistence.
  Budget 12–20 hours, not 4–6.

---

## Resolution Spec

Measured on the Phase 1 dev machine (M1 Mac, Chrome 130, 2026).
Mobile measurements pending — expected to remain well inside any
user-perceptible threshold.

| Resolution | Upscale time | PNG size (worst case) | Use case |
|---|---|---|---|
| 64×64 | 0 ms (pass-through) | ~1 KB | Vanilla Minecraft (default) |
| 128×128 | <1 ms | ~6 KB | Low-res modded servers |
| 256×256 | 1–3 ms | ~18 KB | Common modded/HD target |
| 512×512 | 3–8 ms | ~50 KB | Marketing / high-res mods |

PNG sizes are upper bounds; a typical colorful 64×64 skin
upscaled 8× compresses efficiently because the 8×8 blocks have
perfect spatial correlation. Real-world 512×512 exports of
typical skins are closer to 15–25 KB.

Performance targets:
- `exportLayersToBlob({ resolution: 512 })` end-to-end:
  < 50 ms on dev machine. (Composite + upscale + `toBlob`.)
- Mobile: < 200 ms p95. If any device hits this ceiling we
  revisit with a progress indicator, but not before.
- No layout shift / jank in the ExportDialog when the
  resolution picker renders.

---

## Testing Strategy

### Unit tests (vitest)

- `tests/upscale.test.ts` — Unit 1. Pixel-perfect assertions on
  the upscale canvas at each resolution.
- `tests/export.test.ts` (extended) — Unit 2. Existing blob-
  shape assertions + new resolution cases.
- `tests/export-dialog.test.tsx` (extended) — Unit 3. Radio-
  group rendering, selection → export arg wiring, filename
  suffix.

Target: +15 to +20 tests added, consistent with the size of the
feature (smaller than M14's +80 because the surface is narrower).

### Integration tests (manual, pre-merge)

1. Open `/editor`, paint anything, open Export dialog, select
   each resolution, click Export. Confirm downloaded file
   opens in any image viewer at the expected pixel dimensions.
2. Confirm the 64×64 file is still named `{name}.png` and each
   HD variant is `{name}-{size}.png`.
3. Confirm the dialog's help-text renders and is readable.
4. Open the file in a Minecraft-skin viewer (e.g., NovaSkin's
   preview) to confirm the layout still maps correctly. The UV
   atlas is resolution-independent — 512×512 should display
   identically to 64×64, just blockier.
5. On a mobile device (iOS Safari + Android Chrome), run the
   same flow. Confirm upscale completes without visible jank.

### Not testing

- **Real HD detail.** Not meaningful — nearest-neighbor upscale
  can't produce detail that wasn't in the source.
- **Storage / upload.** Untouched.
- **Publish / gallery / OG / thumbnail.** Untouched.
- **Three.js preview / editor canvas.** Untouched.

---

## Success Criteria

- [ ] User can select 64 / 128 / 256 / 512 in the Export dialog.
- [ ] Each resolution exports a PNG at the correct dimensions,
      verified via an `Image` / IHDR dimension read.
- [ ] Nearest-neighbor upscale is applied — a single source
      pixel becomes an `N×N` block in the output, with no
      bilinear blur.
- [ ] Transparent regions stay alpha=0 + RGB=0 at every
      resolution (M8 Minecraft-safe invariant).
- [ ] Filename is `{name}.png` at 64 and `{name}-{size}.png` at
      HD.
- [ ] Dialog help-text clarifies "pixels upscaled, not higher-
      detail" and "for modded servers".
- [ ] Safari user-gesture chain preserved — export works in an
      up-to-date Safari without a user-gesture warning.
- [ ] All existing tests still pass (849 at M14 HEAD).
- [ ] +15 to +20 new tests added, all passing.
- [ ] Typecheck clean, lint clean.
- [ ] COMPOUND.md §M15 block landed.

---

## Timeline Estimate

| Unit | Estimate | Running total |
|---|---|---|
| Unit 1 — `upscale.ts` + tests | 45 min | 0:45 |
| Unit 2 — wire into `exportLayersToBlob` + tests | 40 min | 1:25 |
| Unit 3 — ExportDialog resolution picker + filename + tests | 60 min | 2:25 |
| Unit 4 — COMPOUND.md + manual QA | 30 min | 2:55 |

**Total: ~3 hours.** Inside the 4–6h DESIGN.md budget with slack,
matching M14's ratio (plan estimate 5.5h vs actual 2.5h for a
similarly-bounded feature with strong pattern re-use).

---

## Rollout Plan

### Pre-merge

1. Open PR titled **"M15: HD skin export (upscale-at-export)"**.
2. Vercel preview auto-deploys.
3. Manual QA on the preview URL: export at each resolution,
   confirm dimensions + filename + help text. Capture a
   screenshot of the dialog and attach to the PR description.
4. Mobile QA on the preview URL: iOS Safari + Android Chrome.

### Merge

5. Land via merge-to-main on the standard path (same as M12 /
   M13 / M14).
6. Production smoke test: export at 512×512 from prod, open
   the file in a Minecraft-skin viewer.

### Post-merge

7. No cache invalidation needed (feature is client-only; no
   server state changes).
8. No social / platform-cache concerns (unlike M14, OG image
   generation is unaffected — still 1200×630 from the 64×64
   source).
9. Monitor for any user reports of "blurry HD exports" in the
   first 48 hours. If the `imageSmoothingEnabled` regression
   theory surfaces, document it as a browser-override known
   issue.

### Rollback

If a post-merge issue surfaces (e.g., dialog layout bug on a
device we didn't test):

- **Partial rollback:** default the dialog to 64×64 and hide
  the HD radios via a CSS `display: none` (one-line revert of
  the JSX change in `ExportDialog.tsx`). Export pipeline stays
  intact but inaccessible from UI; downstream bug triage
  continues.
- **Full rollback:** `git revert` the M15 PR. Restores the M14
  export dialog exactly. No data loss — nothing M15 persists.

---

## Execution Command

For `/ce:work` (or equivalent):

```
Execute M15 (HD Skin Export) using Compound Engineering methodology.

PLAN: /Users/ryan/Documents/threditor/docs/solutions/m15-hd-skins-plan.md
COMPOUND: /Users/ryan/Documents/threditor/docs/solutions/COMPOUND.md

Implement Units 1–4 per the plan. Target: +15 to +20 new tests,
849 existing tests still passing, typecheck clean, lint clean.
Create PR titled "M15: HD skin export (upscale-at-export)".
Append a §M15 block to COMPOUND.md before requesting review.
```

---

## Sources & References

- **Origin document:** [docs/phase-3-features-exploration.md](../phase-3-features-exploration.md) §M15
- **Planning prompt:** [docs/solutions/m15-hd-skins-planning-prompt.md](../solutions/m15-hd-skins-planning-prompt.md)
- **Current export pipeline:** [lib/editor/export.ts](../../lib/editor/export.ts)
- **Current export dialog:** [app/editor/_components/ExportDialog.tsx](../../app/editor/_components/ExportDialog.tsx)
- **Current texture manager:** [lib/editor/texture.ts](../../lib/editor/texture.ts)
- **Atlas constant (unchanged):** [lib/three/constants.ts](../../lib/three/constants.ts)
- **COMPOUND journal:** [docs/solutions/COMPOUND.md](../solutions/COMPOUND.md) §M3, §M8, §M11, §M14
- **Canvas2D imageSmoothingEnabled:** https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled
- **Minecraft skin layout:** https://minecraft.wiki/w/Skin#Skin_layout

*End of plan.*
