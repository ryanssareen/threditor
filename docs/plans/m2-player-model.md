# M2: Player Model — Plan Inputs

This file accumulates inputs from cross-AI consultation prior to M2's `/ce:plan` invocation. The plan phase will reorganize and pin these inputs; the raw responses live here as audit trail.

## Status

- M1 closed at tag `m1-complete` on `main` (commit `792bc15`)
- M2 plan inputs from round 4 dispatches (Gemini, ChatGPT, Perplexity) integrated below
- M2 `/ce:plan` is unblocked once this file is merged

---

## Section A — In-scope for M2 work phase

### A.1 Font integration (Gemini round 4, M8 deferral REJECTED)

Gemini rejected the M1 plan to defer `next/font` integration to M8. Reasoning: Geist and JetBrains Mono have specific x-heights and letter-spacing metrics that differ from system fonts. Building M2 layouts against system-ui means re-tuning every component once the intended fonts land. Cheaper to integrate now than retrofit later.

**Required `app/layout.tsx` replacement (verbatim from Gemini):**

```tsx
import type { Metadata } from 'next';
import { Geist, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: 'Skin Editor',
  description: 'A free, open-source 3D Minecraft skin editor for the web.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

**Token rename status:** Gemini confirmed `--font-sans` and `--font-mono` (M1 names) are canonical Tailwind v4 names that override default `font-sans` and `font-mono` utilities. The `next/font` `variable:` option still uses `--font-geist` and `--font-jetbrains-mono` to populate upstream CSS vars that the static stack in `--font-sans` references downstream.

**M2 acceptance addition:** the `antialiased` class on `<body>` is required for sharp text on the OLED-dark background (prevents halation).

### A.2 Initial camera position (ChatGPT round 4)

| Property | Value |
|---|---|
| Position | (0, 1.4, 3.2) |
| Look target | (0, 1.2, 0) |
| FOV | 32° |

Result: slight downward angle toward upper torso, head at ~60% vertical viewport height, low FOV minimizes UV distortion.

**On-load:** camera fully static for first 500ms. Micro-orbit begins after.

### A.3 Idle micro-orbit (ChatGPT round 4)

| Property | Value |
|---|---|
| Range | ±3° horizontal orbit |
| Cycle | 8–10 seconds full loop |
| Motion | Sinusoidal (no linear, no endpoints) |
| Easing | Smooth, continuous |

Lives next to model breathing in `useFrame`. Zero allocations inside callback (per M1 COMPOUND invariant).

### A.4 Idle breathing (DESIGN.md §6, ChatGPT round 3)

| Property | Value |
|---|---|
| Frequency | 1.5 Hz |
| Amplitude | 0.01 units on head Y-position only |
| Implementation | sine wave on `state.clock.elapsedTime` |
| Constraint | zero allocations inside `useFrame` |

### A.5 Player model geometry (DESIGN.md §6)

24 UV mappings (6 faces × 4 body parts × 2 variants) in `lib/three/geometry.ts`:
- Head: 8×8×8 plus overlay (head2)
- Body: 8×12×4 plus overlay (jacket)
- Arms: 4×12×4 (classic) or 3×12×4 (slim) plus overlays
- Legs: 4×12×4 plus overlays

Reference: skinview3d (MIT, knowledge-fork only, no code import).

### A.6 Default skin source (Perplexity round 4)

Microsoft `minecraft-samples` GitHub repo:
- Owner: `microsoft/minecraft-samples` (official, confirmed)
- Last commit: ~2022 (inactive maintenance — flag for compound)
- Variant: classic geometry, slim adaptation requires arm resize to 3px

Perplexity did not return raw URL or commit hash. M2 plan: re-dispatch Perplexity for exact path OR use programmatic solid-color placeholder for M2 and source real file during M7.

### A.7 Rim-light constant pinning

ChatGPT specified `#7FD6FF` in round 3 with low-confidence flag. Gemini round-4 validation did not arrive (M8 deferral discussion consumed the response slot). M2 should pin `#7FD6FF` in `lib/three/constants.ts` based on ChatGPT's value, with Gemini re-dispatch if M3 visual review reveals the color reads wrong.

### A.8 Dependency bumps for M2

From M1 COMPOUND gotchas:
1. `next` at 15.5.15. Verify still latest 15.5.x before M2 work.
2. `npm run lint` not executed in M1. Run early in M2. If fails, migrate to `eslint.config.mjs` via `@eslint/eslintrc` FlatCompat. Pin `@eslint/eslintrc` once verified.
3. Two low-severity transitive eslint advisories (`@eslint/plugin-kit <0.3.4` ReDoS) resolve via flat-config eslint bump to 9.39.4+.

---

## Section B — Deferred to M3+ milestones

These are documented but should NOT be implemented in M2. Require painting (M3-M4) or tool palette (M5) infrastructure.

### B.1 Mid-stroke camera lock (M3 or M4)

- Position, rotation, FOV all fixed during stroke
- 150ms ease-out from any prior motion on mouse-down
- No drift, sway, parallax, auto-framing during stroke
- Requires stroke-active state from painting milestone

### B.2 Post-release model rotation (M3 or M4)

- **Model rotates** ~1–2° toward last painted area, 150ms ease-out
- Camera remains locked
- IMPORTANT: model rotates, not camera. Easy to misread
- Triggered by mouse-up event from painting milestone

### B.3 Two-stage camera idle return (M3 or M4)

- Frame 0.0–0.3: camera locked, model reactive rotation (B.2)
- Frame 0.3–0.8: camera locked, breathing resumes partially
- Frame 0.8–2.5: camera locked, cool-down mode
- Frame 2.5+: camera micro-orbit resumes (matches A.3 spec)

### B.4 Mouse-movement parallax (M3)

Activation: cursor over canvas, not painting, not in flow state.

| Axis | Mapping |
|---|---|
| Horizontal | Cursor full L/R → ±0.08 units camera X shift |
| Vertical | Cursor up/down → ±0.05 units camera Y shift |
| Rotation | ±1° max tilt toward cursor |

Smoothing: ~120ms lerp, no jitter, no 1:1 tracking.

Suppression:
- Mouse-down: parallax disables (150ms ease-out)
- During stroke: fully off
- Multi-stroke flow (M5+): disabled
- Cursor leaves canvas: 200ms fade out

Priority: parallax overrides micro-orbit when both active.

### B.5 Hover rim-light (M3)

Per ChatGPT round 3:
- 120ms ease-in on cursor enter bbox
- Color `#7FD6FF` at 12-15% intensity
- ~2-3 cm radius, soft radial gradient
- Tracks cursor with 40ms lag
- 180ms ease-out on cursor leave

### B.6 Contact pulse + breathing dampening (M3 or M4)

- Contact pulse: rim-light tightens 30%, brightens to 20% for 80ms
- Mid-stroke rim-light: fades to 5% residual
- Breathing amplitude: 0.01 → 0.004 during stroke
- Frequency unchanged at 1.5 Hz

### B.7 Multi-stroke flow state (M5)

- Trigger: ≥5 strokes within 3 seconds
- Breathing amplitude: 0.004 → 0.002
- Micro-motions disabled
- Camera stability increased
- Exit: no input for 1.2 seconds

### B.8 Color-blind luminance toggle (M8)

Per Gemini round 3 + DESIGN.md §10:
- Hotkey `L`
- Floating pill indicator at viewport top-center
- Both 2D UV canvas and 3D viewport desaturate
- Color picker, palette, active swatch remain in full color
- Implementation: shader uniform `uGrayscale` + CSS `filter: grayscale(100%)`

---

## Section C — Deferred to M7

### C.1 Microsoft minecraft-samples sourcing (Perplexity round 4)

For `blank-better` template:
- Verify exact file path at plan-phase start (Perplexity did not return URL/hash)
- Owner confirmed `microsoft/minecraft-samples` (official)
- Last commit ~2022, asset stable
- Quote LICENSE permission grant verbatim before commit
- Adapt for both classic and slim variants

### C.2 Thumbnail rendering pipeline (Gemini round 4)

**Renderer: Puppeteer with Chromium SwiftShader.**

Rejected:
- `three-software-renderer` — not compatible with three.js 0.184.0 (Perplexity verified)
- `headless-gl` — WebGL 1.0 wrapper, fails on three.js 0.150+, hard to compile on M-series Macs
- `node-canvas-webgl` — obsolete, crashes on modern BufferGeometry

Why Puppeteer:
- 100% three.js 0.184.0 API compatibility
- SwiftShader provides software WebGL on Vercel build (no GPU required)
- `npm install puppeteer` just works on macOS arm64
- Identical lighting fidelity to live editor

Reference sketch from Gemini:
```js
const browser = await puppeteer.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader']
});
const page = await browser.newPage();
await page.setViewport({ width: 256, height: 256 });
await page.goto(`file://${process.cwd()}/scripts/render-env.html`);

for (const skin of templates) {
  await page.evaluate((url) => window.renderSkin(url), skin.url);
  await page.screenshot({ path: `public/templates/thumbs/${skin.id}.webp`, type: 'webp' });
}
```

### C.3 M7 caching architecture (Claude design, response to delegation)

Thumbnails are **committed artifacts**, not build-time artifacts.

Reasoning: Vercel Hobby = 6,000 build-min/month. Puppeteer + SwiftShader = 2-4s per thumbnail. 12 templates = 30-50s/build = 50-100 build-min/month wasted on immutable assets.

Pattern:
1. `scripts/generate-thumbnails.mjs` runs locally on demand (`npm run thumbnails`)
2. Output WebPs in `public/templates/thumbs/`
3. Both PNGs and WebPs committed to git
4. Vercel serves as static assets — zero build-time generation
5. Hash-based skip in script: compare source PNG hash against `public/templates/thumbs/.manifest.json`
6. CI guard: GitHub Actions on PRs touching `public/templates/classic|slim/` regenerates and fails if `git diff --exit-code public/templates/thumbs/` shows changes

Quota impact: zero added build-min after setup, ~150 KB added repo size.

---

## Section D — Plan-phase checklist for `/ce:plan`

The M2 `/ce:plan` invocation must explicitly address each:

- [ ] A.1: implement Gemini font integration before any M2 component uses font tokens
- [ ] A.2: pin (0, 1.4, 3.2) / (0, 1.2, 0) / FOV 32° as constants in `lib/three/constants.ts`
- [ ] A.3: implement micro-orbit in `useFrame` alongside breathing, starts after 500ms load delay
- [ ] A.4: breathing 1.5 Hz / 0.01 amplitude / zero allocations
- [ ] A.5: derive 24 UV constants for both variants in `lib/three/geometry.ts`
- [ ] A.6: re-dispatch Perplexity for exact URL OR use placeholder for M2
- [ ] A.7: pin `#7FD6FF` in `lib/three/constants.ts` (M2 creates file, doesn't use until M3)
- [ ] A.8: verify next 15.5.x latest, run lint early, plan flat-config migration if needed
- [ ] B.*: explicitly note as deferred to M3-M5 in plan; do not implement
- [ ] C.*: add to M7 backlog file, do not implement

---

## Section E — Cross-references

- DESIGN.md §6: R3F player model code sketch (M1-pinned)
- DESIGN.md §9.2: mirror tool UV mapping (M5)
- DESIGN.md §11.6: OG image rendering parameters (M11, lighting setup carries to M7 thumbnails)
- DESIGN.md §12.5 M2: original M2 milestone spec
- docs/COMPOUND.md: M1 learnings (auto-loaded by `/ce:plan`)

---

*End of M2 plan inputs file.*
