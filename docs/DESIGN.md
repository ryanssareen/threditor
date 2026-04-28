# Skin Editor — Design Document

**Version:** 0.4
**Status:** Ready for implementation (Phase 1) + M17 Enhancement
**License:** MIT
**Last updated:** 2026-04-28

---

## 0. Preface

This document consolidates decisions from three rounds of collaborative design with four AI agents (Claude Opus 4.7 as architecture lead, with ChatGPT, Gemini, and Perplexity contributing specialist input). The implementation plan in Section 12 applies Every's **Compound Engineering** methodology, which is the engineering discipline this project will follow end-to-end.

---

## 1. Goals and non-goals

### 1.1 Goals

- Ship a web-based 3D Minecraft skin editor with the "first-paint hook" as the core experience: user paints within 2 seconds of landing on the editor, sees result on a live 3D model, feels competent immediately.
- Maintain zero infrastructure cost across Phase 1 and Phase 2 via Vercel Hobby and Firebase Spark (no billing account linked).
- Keep the codebase MIT-licensed and free of GPL dependencies (no Blockbench code reuse).
- Support both Classic (4px arms) and Slim (3px arms) skin variants from day one.
- Build via Compound Engineering: each milestone makes the next milestone easier through systematic knowledge capture.

### 1.2 Non-goals (Phase 1)

- User accounts, authentication, social features.
- Cloud persistence, sharing URLs, gallery.
- HD skins (>64×64).
- `.bbmodel` import/export — deferred to Phase 3.
- Animation editing — idle and walk poses are preview-only.
- AI-generated content — "Prompt-to-Base" deferred to Phase 2.
- Smart Wear & Tear procedural detailing — deferred to Phase 2 post-M14.

---

## 2. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 App Router | SEO for share pages, static landing, client editor |
| Language | TypeScript strict mode | Catches UV math errors at compile time |
| 3D | three.js + React Three Fiber + drei | Declarative, R3F's event system handles raycasts natively |
| State | Zustand | Lightweight, no provider boilerplate, persistable |
| Styling | Tailwind v4 with OLED-dark token config | Drop-in, high contrast, reduces eye fatigue |
| Local persistence | `idb-keyval` | Minimal IndexedDB wrapper |
| Hosting | Vercel Hobby | Free, native Next.js integration, custom domain via Vercel DNS |
| BaaS (Phase 2) | Firebase Spark plan | Hard $0 cap without billing account, no inactivity pause |
| Auth (Phase 2) | Firebase Authentication | 50K MAU on Spark, email + social |
| Database (Phase 2) | Cloud Firestore | NoSQL document store, fits skin metadata |
| File storage (Phase 2) | Cloud Storage for Firebase | 5 GB stored, ~30 GB/month egress on Spark |

### 2.1 Tailwind token config

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        canvas: '#000000',
        ui: {
          base: '#0A0A0A',
          surface: '#171717',
          border: '#262626',
        },
        accent: {
          DEFAULT: '#00E5FF',
          hover: '#66FFFF',
          muted: 'rgba(0, 229, 255, 0.1)',
        },
        text: {
          primary: '#EDEDED',
          secondary: '#A3A3A3',
          muted: '#525252',
        },
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.5rem',
      },
      boxShadow: {
        panel: '0 20px 25px -5px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(38, 38, 38, 1)',
      },
    },
  },
};
```

WCAG contrast: `text.primary` on `ui.base` = 15.1:1 (AAA), `accent` on `ui.base` = 13.5:1.

---

## 3. File structure

```
skin-editor/
├── app/
│   ├── layout.tsx                    # Root layout, font loading, metadata
│   ├── page.tsx                      # Landing (server component, static)
│   ├── editor/
│   │   ├── page.tsx                  # Thin client wrapper
│   │   └── _components/
│   │       ├── Editor.tsx            # 'use client' root
│   │       ├── Viewport3D.tsx        # R3F canvas + player model
│   │       ├── ViewportUV.tsx        # 2D canvas painting surface
│   │       ├── Toolbar.tsx           # Floating tool selector
│   │       ├── ColorPicker.tsx       # HSL picker + named-color readout
│   │       ├── LayerPanel.tsx        # Layer list, blend modes, opacity
│   │       ├── TemplateGate.tsx      # Ghost Templates picker
│   │       ├── LuminanceToggle.tsx   # Color-blind accessibility mode
│   │       └── ExportDialog.tsx      # PNG export with variant toggle
│   ├── api/                          # Phase 2 only
│   │   ├── auth/session/route.ts     # Firebase session cookie
│   │   └── auth/signout/route.ts     # Revoke session
│   ├── skin/[id]/page.tsx            # Phase 2: shared skin page (SSR)
│   ├── gallery/page.tsx              # Phase 2: browse gallery (ISR)
│   ├── u/[username]/page.tsx         # Phase 2: profile page
│   └── globals.css                   # Tailwind directives, font-faces
├── lib/
│   ├── editor/
│   │   ├── types.ts                  # Core type definitions (§4)
│   │   ├── store.ts                  # Zustand store
│   │   ├── texture.ts                # CanvasTexture management, compositing
│   │   ├── uv-map.ts                 # Static UV island map per variant
│   │   ├── og-image.ts               # Phase 2: 3D render for share previews
│   │   ├── grayscale-shader.ts       # Luminance mode shader patch
│   │   ├── tools/
│   │   │   ├── pencil.ts
│   │   │   ├── eraser.ts
│   │   │   ├── bucket.ts             # Island-aware flood fill
│   │   │   ├── picker.ts
│   │   │   └── mirror.ts             # Stroke duplication transform
│   │   ├── undo.ts                   # Dirty-rect diff stack
│   │   └── persistence.ts            # IndexedDB save/load
│   ├── three/
│   │   ├── PlayerModel.tsx           # 6-box humanoid, R3F native
│   │   ├── geometry.ts               # Box geometries with correct UVs
│   │   └── animations.ts             # Idle, walk, hover-react
│   ├── color/
│   │   ├── palette.ts                # Median-cut extraction
│   │   ├── harmony.ts                # HSL-based harmony generation
│   │   └── named-colors.ts           # Local dictionary for accessibility
│   └── firebase/                     # Phase 2
│       ├── client.ts                 # Browser SDK init
│       ├── admin.ts                  # Admin SDK init
│       ├── auth.ts                   # Session helpers
│       ├── firestore.ts              # Typed Firestore wrappers
│       └── storage.ts                # Skin upload/download
├── public/
│   └── templates/
│       ├── manifest.json             # Catalog metadata
│       ├── thumbs/                   # 256×256 WebPs (pre-rendered)
│       ├── classic/                  # Classic-variant templates
│       └── slim/                     # Slim-variant templates
├── tests/
│   ├── uv-math.test.ts               # Raycast → pixel correctness
│   ├── undo.test.ts                  # Diff/restore round-trip
│   ├── bucket.test.ts                # Island-fill bleed prevention
│   └── export.test.ts                # PNG round-trip fidelity
├── firestore.rules                   # Phase 2 security rules
├── storage.rules                     # Phase 2 storage rules
├── firestore.indexes.json            # Phase 2 composite indexes
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
├── package.json
├── LICENSE                           # MIT
├── README.md
└── docs/
    ├── DESIGN.md                     # This document
    ├── COMPOUND.md                   # Knowledge capture journal (§12.4)
    └── PROMPTS.md                    # Archive of AI consultation prompts
```

**Conventions:**
- `_components/` underscore prefix marks Next.js private folders, never routed.
- Client components explicitly marked `'use client'` at file top.
- Pure logic in `lib/`, never `'use client'`, importable from server components.
- No barrel `index.ts` files — direct imports only, for tree-shaking clarity.

---

## 4. Core data types

```ts
// lib/editor/types.ts

export type SkinVariant = 'classic' | 'slim';

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;              // 0–1
  blendMode: 'normal' | 'multiply' | 'overlay' | 'screen';
  pixels: Uint8ClampedArray;    // RGBA, length = 64 * 64 * 4 = 16384
};

export type SkinDocument = {
  id: string;
  variant: SkinVariant;
  layers: Layer[];              // Bottom-to-top render order
  activeLayerId: string;
  createdAt: number;
  updatedAt: number;
};

export type StrokePatch = {
  bbox: { x: number; y: number; w: number; h: number };
  before: Uint8ClampedArray;    // Length = bbox.w * bbox.h * 4
  after: Uint8ClampedArray;
};

export type Stroke = {
  id: string;
  layerId: string;
  patches: StrokePatch[];       // 1 for non-mirrored; 2 (primary + mirror) for mirrored
  tool: 'pencil' | 'eraser' | 'bucket';
  mirrored: boolean;
};
// Amended M6 per plan D2: mirror strokes produce two disjoint patches rather
// than one spanning bbox. A spanning bbox from rightArm.front (y≈20) to
// leftArm.front (y≈52) would capture a 64×32 padding slab of unchanged
// pixels (~8 KB per stroke); the multi-patch shape is tight. Aseprite and
// Photoshop Paint Symmetry use the same "one command, multiple regions" shape.

export type IslandId = number;  // 0 = unused, 1+ = body part region
export type IslandMap = Uint8Array;  // Length = 64 * 64

export type Point = { x: number; y: number };
export type RGBA = [number, number, number, number];
```

**Memory accounting:**
- One layer: 16 KB
- Typical stroke (20px brush): ~80 bytes diff
- 100-step undo history worst case: ~1.6 MB
- Typical session footprint: under 5 MB

### 4.1 Phase 2 Firestore types

```ts
// lib/firebase/types.ts
import { Timestamp } from 'firebase/firestore';

export type UserProfile = {
  uid: string;                       // Firebase Auth UID, also doc ID
  username: string;                  // Unique, lowercase, [a-z0-9_-]+
  displayName: string;
  photoURL: string | null;
  createdAt: Timestamp;
  skinCount: number;                 // Denormalized
};

export type SharedSkin = {
  id: string;
  ownerUid: string;
  ownerUsername: string;             // Denormalized for query efficiency
  name: string;
  variant: SkinVariant;
  storageRef: string;                // gs:// path to PNG
  thumbnailRef: string;              // gs:// path to 128×128 thumbnail
  ogImageRef: string;                // gs:// path to 1200×630 OG image
  tags: string[];                    // Max 8, lowercase, indexed
  likeCount: number;                 // Denormalized counter
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Like = {
  // Document ID format: `${skinId}_${uid}`
  skinId: string;
  uid: string;
  createdAt: Timestamp;
};
```

Denormalization is mandatory under Firestore's read-per-query billing model.

---

## 5. Templates feature

### 5.1 Locked catalog

Ten templates ship with the MVP. Each maps to either a learning surface or a broad-appeal vector.

| ID | Label | Category | Variant | Teaches | Source |
|---|---|---|---|---|---|
| `classic-hoodie` | Classic Hoodie | Safe Wins | classic | Base fill + simple shading | Original (MIT) |
| `gamer-tee` | Gamer Tee + Jeans | Safe Wins | classic | Flat colors + logo placement | Original (MIT) |
| `minimal-black` | Minimal Black | Safe Wins | slim | Near-black contrast | Original (MIT) |
| `split-color` | Split Character | Technique | classic | Mirror tool discovery | Original (MIT) |
| `shaded-hoodie` | Shaded Hoodie — improve this | Technique | classic | Layered shading | Original (MIT) |
| `armor-lite` | Armor Lite | Technique | classic | Edge highlights | Original (MIT) |
| `cartoon-face` | Cartoon Face | Technique | slim | Pixel precision on face | Original (MIT) |
| `sports-jersey` | Sports Jersey | Identity | classic | Custom text/number | Original (MIT) |
| `hoodie-headphones` | Hoodie + Headphones | Identity | slim | Accessory placement | Original (MIT) |
| `blank-better` | Blank but Better | Base | both | Modern starting point | Microsoft sample (MIT, adapted) |

`shaded-hoodie` is deliberately mid-quality (6/10). Label "improve this" frames mediocrity as the assignment, not the result.

**M7 note (manifest encoding of `variant: both`):** the `blank-better` row above lists `variant: both` as a user-facing concept, but `manifest.json` requires one variant per entry (the schema in §5.2 types `variant` as `'classic' | 'slim'`). Ship as two manifest entries — `blank-better-classic` and `blank-better-slim` — both labeled "Blank but Better" and both tagged `base`. The Base category surfaces whichever matches the current session variant first; both remain selectable.

### 5.2 Manifest format

```json
// public/templates/manifest.json
{
  "version": 1,
  "categories": [
    {
      "id": "safe-wins",
      "label": "Start Simple",
      "templates": [
        {
          "id": "classic-hoodie",
          "label": "Classic Hoodie",
          "variant": "classic",
          "file": "/templates/classic/classic-hoodie.png",
          "thumbnail": "/templates/thumbs/classic-hoodie.webp",
          "license": "MIT",
          "credit": null,
          "tags": ["hoodie", "beginner"],
          "contextualHint": "Try a new color",
          "affordancePulse": "color"
        }
      ]
    }
  ]
}
```

### 5.3 Ghost Templates picker

```
State machine:
  idle → suggestion_chip → bottom_sheet → dismissed

Transitions:
  on mount:
    → idle, schedule 3500ms timer, listen for first stroke
  on (timer elapsed OR first stroke detected):
    → suggestion_chip (floating chip, label: "Try a starting style")
  on chip click:
    → bottom_sheet (3 templates visible, horizontal scroll)
  on template select:
    → dismissed, trigger template-to-edit transition (§5.4)
  on chip dismiss OR bottom_sheet close:
    → dismissed, persist 'templates-dismissed' to localStorage

  if localStorage has 'templates-dismissed' on mount:
    → dismissed (skip entirely; templates remain accessible via menu)
```

### 5.4 Template-to-edit transition

Frame-by-frame after template selection:

| Frame | Time | Action |
|---|---|---|
| 0.0 | 0ms | User clicks template |
| 0.2 | 200ms | Model crossfades to new texture; slight Y-rotation (+0.1 rad, eases back) |
| 0.5 | 500ms | Editable immediately — no lock, no confirmation |
| 0.7 | 700ms | Contextual hint appears anchored to model bounding box |
| 1.0 | 1000ms | Affordance pulse on relevant UI element (color picker, mirror toggle) |
| 1.3 | 1300ms | If idle: cursor glow intensifies subtly |
| 1.6 | 1600ms | If idle: model performs micro idle motion |
| 2.0+ | 2000ms+ | Export attempted without edit → soft-friction dialog: "Edit first" / "Export anyway" |

Guardrail applies only if stroke count is zero. Any edit removes the prompt.

**M7 note (guardrail trigger point):** the 2000ms+ row describes when the guardrail can fire; it is not a timer that shoots a dialog into the UI unprompted. The soft-friction dialog lands in **M8** alongside the PNG export action and is wired to `useEditorStore.getState().hasEditedSinceTemplate`. M7 persists the `hasEditedSinceTemplate` + `lastAppliedTemplateId` flags so M8's export handler has the state it needs without additional plumbing.

**M8 guardrail expression (canonical):** `hasEditedSinceTemplate === false && lastAppliedTemplateId !== null`. Fresh sessions with no template applied (`lastAppliedTemplateId === null`) bypass the guardrail — there is nothing to protect against. Any committed stroke flips `hasEditedSinceTemplate` to `true` via the M7 dispatcher chokepoint, which permanently clears the guardrail for that template.

---

## 6. The R3F player model

```tsx
// lib/three/PlayerModel.tsx
'use client';

import { useRef } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { CLASSIC_UVS, SLIM_UVS } from './geometry';

type Props = {
  texture: THREE.CanvasTexture;
  variant: SkinVariant;
  onPaint: (uv: { x: number; y: number }) => void;
};

export function PlayerModel({ texture, variant, onPaint }: Props) {
  const headRef = useRef<THREE.Mesh>(null);
  const uvs = variant === 'classic' ? CLASSIC_UVS : SLIM_UVS;

  useFrame((state) => {
    if (headRef.current) {
      headRef.current.position.y = 1.4 + Math.sin(state.clock.elapsedTime * 1.5) * 0.01;
    }
  });

  const handlePointerEvent = (e: ThreeEvent<PointerEvent>) => {
    if (!e.uv) return;
    e.stopPropagation();
    onPaint({
      x: Math.floor(e.uv.x * 64),
      y: Math.floor((1 - e.uv.y) * 64),
    });
  };

  return (
    <group>
      <mesh
        ref={headRef}
        position={[0, 1.4, 0]}
        onPointerDown={handlePointerEvent}
        onPointerMove={(e) => e.buttons === 1 && handlePointerEvent(e)}
      >
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial map={texture} transparent />
      </mesh>
      {/* Head overlay, body, arms, legs follow same pattern */}
    </group>
  );
}
```

UV constants in `geometry.ts` derived from the Minecraft skin spec: six faces per box, each mapped to a specific 8×8 (or 4×8 / 4×4) region. Knowledge-forked from `skinview3d` (MIT), reimplemented in our own code to preserve architectural control over raycast events.

---

## 7. Texture write pipeline

```ts
// lib/editor/texture.ts

class TextureManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private dirty = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.ctx.imageSmoothingEnabled = false;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;

    this.startRAFLoop();
  }

  composite(layers: Layer[]) {
    this.ctx.clearRect(0, 0, 64, 64);
    for (const layer of layers) {
      if (!layer.visible) continue;
      // Amended M6 per plan D1: putImageData ignores globalAlpha AND
      // globalCompositeOperation (WHATWG HTML §4.12.5.1.14). Blit into a
      // reused scratch OffscreenCanvas via putImageData, then drawImage
      // the scratch onto this.ctx — drawImage DOES honor both properties.
      const scratch = this.scratchCtx;
      scratch.putImageData(new ImageData(layer.pixels, 64, 64), 0, 0);
      this.ctx.globalAlpha = layer.opacity;
      this.ctx.globalCompositeOperation = mapBlendMode(layer.blendMode);
      this.ctx.drawImage(scratch.canvas, 0, 0);
    }
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.markDirty();
  }

  markDirty() { this.dirty = true; }

  private startRAFLoop() {
    const tick = () => {
      if (this.dirty) {
        this.texture.needsUpdate = true;
        this.dirty = false;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  getTexture() { return this.texture; }
}
```

At 64×64, full texture re-upload is 16 KB. At 60fps, that is 960 KB/s of PCIe traffic. Modern GPUs trivially absorb this. `texSubImage2D` optimization deferred unless texture size increases beyond 256×256.

---

## 8. Undo stack

```ts
// lib/editor/undo.ts

const MAX_HISTORY_COUNT = 100;                 // hard cap, safety net
const MAX_HISTORY_BYTES = 5 * 1024 * 1024;     // primary budget: 5 MB

// Amended M6 per plan D3: the command union covers pixel strokes AND
// layer-lifecycle commands (add/delete/reorder/rename/opacity/blend/
// visibility). Unified stack matches Figma/Linear/Notion 2026 UX norms.
type Command =
  | { kind: 'stroke'; stroke: Stroke }
  | { kind: 'layer-add'; layer: Layer; insertedAt: number }
  | { kind: 'layer-delete'; layer: Layer; removedFrom: number }
  | { kind: 'layer-reorder'; from: number; to: number }
  | { kind: 'layer-rename'; id: string; before: string; after: string }
  | { kind: 'layer-opacity'; id: string; before: number; after: number }
  | { kind: 'layer-blend'; id: string; before: BlendMode; after: BlendMode }
  | { kind: 'layer-visibility'; id: string; before: boolean; after: boolean };

class UndoStack {
  private commands: Command[] = [];
  private cursor = -1;
  private bytesUsed = 0;

  push(cmd: Command) {
    // Amended M6: truncate redo tail, then evict-oldest while over either cap.
    this.truncateRedoTail();
    this.commands.push(cmd);
    this.cursor++;
    this.bytesUsed += sizeOf(cmd);
    while (
      this.commands.length > MAX_HISTORY_COUNT ||
      this.bytesUsed > MAX_HISTORY_BYTES
    ) {
      const evicted = this.commands.shift()!;
      this.bytesUsed -= sizeOf(evicted);
      this.cursor--;
    }
  }

  // Amended M6 per plan D10: undo is ignored while a stroke is active
  // (pointer still down). Paint surfaces bridge strokeActive into the store.
  undo(state: EditorStateActions): boolean {
    if (state.strokeActive) return false;
    if (this.cursor < 0) return false;
    applyCommand(state, this.commands[this.cursor], 'before');
    this.cursor--;
    return true;
  }

  redo(state: EditorStateActions): boolean {
    if (state.strokeActive) return false;
    if (this.cursor >= this.commands.length - 1) return false;
    this.cursor++;
    applyCommand(state, this.commands[this.cursor], 'after');
    return true;
  }
}
```

Amended M6 per plan D2: mirror strokes emit ONE `Stroke` command containing
two disjoint `StrokePatch` entries (primary + mirror). `mirrored: true`.
Undo/redo iterates patches; treats the Stroke as a single atomic step.

Amended M6 per plan D4: dual memory caps. `MAX_HISTORY_BYTES` (5 MB) is the
primary budget; `MAX_HISTORY_COUNT` (100) is the secondary safety net.

Amended M6 per plan D5: only pixel-mutating actions and layer-lifecycle
actions push to the stack. Tool/brush/color/mirror-toggle/view/active-layer
selection are session-ephemeral and never push.

Amended M6 per plan D9: a redo whose `layerId` no longer exists (the target
layer was deleted after the stroke pushed) silently no-ops that entry and
advances the cursor. Rebuilding the whole layer from patches would require
whole-layer snapshots, breaking the memory budget.

---

## 9. Tools

Five tools for MVP. No more. Progressive disclosure on first use.

| Tool | Key | Behavior |
|---|---|---|
| Pencil | B | Paint single pixels at brush size (default 1px) |
| Eraser | E | Sets pixels to transparent on active layer |
| Picker | I | Long-press or Alt-hold samples color under cursor |
| Bucket | G | Island-aware flood fill; cannot bleed across UV seams |
| Mirror | M | Toggles X-axis symmetry on subsequent strokes |

### 9.1 Island-aware flood fill

Pre-compute a static `IslandMap` (Uint8Array length 4096) at init. Each pixel stores an island ID: head-front=1, head-back=2, torso-front=3, etc. Flood fill reads starting pixel's island ID and only spreads to neighbors with matching ID. Zero seam bleed, O(n).

Two maps required: one for Classic variant, one for Slim. Computed once, cached in module scope.

### 9.2 Mirror tool

Symmetry plane is screen-vertical through the character's center. For each painted pixel at `(x, y)`, a mirror pixel is computed at `(mirrorX, y)` where `mirrorX` depends on which body part region contains `(x, y)`. Lookup table in `uv-map.ts` handles left-arm ↔ right-arm and left-leg ↔ right-leg mapping.

Single `Stroke` record; undo restores both sides atomically.

---

## 10. Color-blind mode (luminance toggle)

Hotkey: `L`. Does not conflict with B/E/I/G/M.

Visual indicator: floating pill at top-center of viewport, 500ms slide-down animation, background `ui.surface`, 1px `accent` border, text "👁 Luminance Mode".

Scope: **Both 2D UV canvas and 3D viewport desaturate.** Color picker, palette panel, and active swatch remain in full color. Preserves the user's logical anchor to their chosen colors while checking value contrast.

Implementation:

```ts
// lib/editor/grayscale-shader.ts
// NOTE: three.js r152/r154 renamed `<output_fragment>` to `<opaque_fragment>`
// (migration guide). three 0.184 uses `<opaque_fragment>`; the older token
// silently no-ops because `replace()` matches nothing.
//
// We share ONE uniform object across every patched material so toggling
// `.value` propagates to all meshes without recompile and without needing
// `material.customProgramCacheKey` management.
export const grayscaleUniform = { value: false };

// Patch onto material in PlayerModel:
material.onBeforeCompile = (shader) => {
  shader.uniforms.uGrayscale = grayscaleUniform;
  shader.fragmentShader =
    'uniform bool uGrayscale;\n' +
    shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      #include <opaque_fragment>
      if (uGrayscale) {
        float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor.rgb = vec3(luma);
      }
      `,
    );
};
```

2D canvas: `filter: grayscale(100%)` via CSS class toggle on `<ViewportUV>` container. No underlying pixel data modified.

---

## 11. Phase 2 — Firebase implementation

### 11.1 Initialization

```ts
// lib/firebase/client.ts
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MSG_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let storage: FirebaseStorage;

export function getFirebase() {
  if (!getApps().length) {
    app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
  }
  return { app, auth, db, storage };
}
```

`NEXT_PUBLIC_` prefix is safe: Firebase web config is not a secret. Security is enforced via Security Rules, not API-key secrecy.

### 11.2 Server-side auth

Session-cookie pattern (not stateless JWT):

1. Client signs in via `signInWithPopup` or similar.
2. Client POSTs ID token to `/api/auth/session`.
3. Route handler calls `adminAuth.createSessionCookie()`, sets httpOnly cookie.
4. Subsequent server components call `adminAuth.verifySessionCookie()` to identify user.

```ts
// app/api/auth/session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirebase } from '@/lib/firebase/admin';

const SESSION_DURATION = 60 * 60 * 24 * 5 * 1000;  // 5 days

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();
  const { auth } = getAdminFirebase();
  const sessionCookie = await auth.createSessionCookie(idToken, {
    expiresIn: SESSION_DURATION,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set('session', sessionCookie, {
    maxAge: SESSION_DURATION / 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return response;
}
```

### 11.3 Firestore data model

Three collections:

```
/users/{uid}              → UserProfile
/skins/{skinId}           → SharedSkin
/likes/{skinId_uid}       → Like
```

Required composite indexes in `firestore.indexes.json`:

| Query purpose | Fields |
|---|---|
| Tag filter + recency | `tags` (CONTAINS), `createdAt` (DESC) |
| User's skins | `ownerUid` (ASC), `createdAt` (DESC) |
| Trending | `likeCount` (DESC), `createdAt` (DESC) |

### 11.4 Like-toggle transaction

Client-side transaction updates both the `Like` doc and the denormalized `likeCount`:

```ts
export async function toggleLike(skinId: string, uid: string) {
  const { db } = getFirebase();
  const likeRef = doc(db, 'likes', `${skinId}_${uid}`);
  const skinRef = doc(db, 'skins', skinId);

  await runTransaction(db, async (tx) => {
    const likeDoc = await tx.get(likeRef);
    if (likeDoc.exists()) {
      tx.delete(likeRef);
      tx.update(skinRef, { likeCount: increment(-1) });
    } else {
      tx.set(likeRef, { skinId, uid, createdAt: serverTimestamp() });
      tx.update(skinRef, { likeCount: increment(1) });
    }
  });
}
```

Cost: 2 reads + 2 writes per toggle. At Spark's 20K writes/day ceiling, ~10K toggles/day global.

### 11.5 Security rules

```
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if true;
      allow create: if request.auth != null
                    && request.auth.uid == uid
                    && request.resource.data.uid == uid;
      allow update: if request.auth != null
                    && request.auth.uid == uid
                    && !('skinCount' in request.resource.data.diff(resource.data).affectedKeys());
      allow delete: if false;
    }
    match /skins/{skinId} {
      allow read: if true;
      allow create: if request.auth != null
                    && request.resource.data.ownerUid == request.auth.uid
                    && request.resource.data.likeCount == 0
                    && request.resource.data.tags.size() <= 8;
      allow update: if request.auth != null
                    && resource.data.ownerUid == request.auth.uid
                    && !('likeCount' in request.resource.data.diff(resource.data).affectedKeys())
                    && !('ownerUid' in request.resource.data.diff(resource.data).affectedKeys());
      allow delete: if request.auth != null
                    && resource.data.ownerUid == request.auth.uid;
    }
    match /likes/{likeId} {
      allow read: if true;
      allow create, delete: if request.auth != null
                            && request.resource.data.uid == request.auth.uid;
      allow update: if false;
    }
  }
}
```

```
// storage.rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /skins/{uid}/{filename} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.uid == uid
                   && request.resource.size < 100 * 1024
                   && request.resource.contentType == 'image/png';
    }
    match /og/{skinId}.webp {
      allow read: if true;
      allow write: if request.auth != null
                   && request.resource.size < 200 * 1024
                   && request.resource.contentType == 'image/webp';
    }
  }
}
```

### 11.6 OG image generation

Rendered client-side at publish time. 1200×630 WebP, 3/4 isometric angle, three-point lighting, uploaded alongside the skin PNG.

```ts
// lib/editor/og-image.ts
'use client';

export async function generateOGImage(
  texture: THREE.CanvasTexture,
  variant: SkinVariant
): Promise<Blob> {
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = 1200;
  offscreenCanvas.height = 630;

  const renderer = new THREE.WebGLRenderer({
    canvas: offscreenCanvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(1200, 630);

  const scene = new THREE.Scene();
  scene.add(new THREE.DirectionalLight(0xffffff, 1.2).translateOnAxis(
    new THREE.Vector3(5, 5, 5).normalize(), 1));
  scene.add(new THREE.DirectionalLight(0xaaccff, 0.4).translateOnAxis(
    new THREE.Vector3(-3, 2, 4).normalize(), 1));
  scene.add(new THREE.DirectionalLight(0xffffff, 0.6).translateOnAxis(
    new THREE.Vector3(0, 3, -5).normalize(), 1));
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  const camera = new THREE.PerspectiveCamera(35, 1200 / 630, 0.1, 100);
  camera.position.set(2.5, 1.5, 3.5);
  camera.lookAt(0, 0.8, 0);

  scene.add(buildPlayerModelMesh(texture, variant));
  renderer.render(scene, camera);

  const blob = await new Promise<Blob>((resolve) => {
    offscreenCanvas.toBlob(b => resolve(b!), 'image/webp', 0.85);
  });

  renderer.dispose();
  return blob;
}
```

Cost per publish: +200–500ms latency, +30 KB storage, +1 write op. At 5 GB storage, ~166K OG images possible before ceiling.

### 11.7 Quota analysis

| Operation | Spark limit | Binding constraint? |
|---|---|---|
| Firestore reads | 50K/day | **Yes** — gallery load ~20 reads; caps at ~2,500 page loads/day uncached |
| Firestore writes | 20K/day | Secondary — like toggle uses 2 writes |
| Storage uploads | 20K/day | Not binding |
| Storage downloads | 50K/day | Mitigated by CDN caching |
| Storage egress | 1 GB/day | Not binding at 2 KB/skin |

Read budget is the critical metric. Mitigations:

1. Next.js ISR on `/gallery` with 60s revalidation — one Firestore query serves all viewers in the window.
2. 20 skins per gallery page, not 100.
3. No `onSnapshot` listeners on public pages. `getDocs` one-shot only.

---

## 12. Implementation plan — Compound Engineering

### 12.1 Methodology

This project follows Every's **Compound Engineering** methodology. The core principle: each unit of engineering work makes subsequent units easier, not harder. Traditional development accumulates technical debt; compound engineering accumulates institutional knowledge that feeds back into the system.

**The four-phase loop:**

1. **Plan** — research the codebase and problem, produce a detailed implementation plan with requirements, approach, and edge cases.
2. **Work** — AI agent executes the plan unsupervised, producing a pull request.
3. **Review** — multiple specialized agents review the output in parallel (security, performance, architecture, style). Findings prioritized P1/P2/P3.
4. **Compound** — capture patterns, learnings, and gotchas in a persistent knowledge base that informs future cycles.

**Ratio:** 80% planning and review, 20% execution.

### 12.2 Plugin installation

Install the Compound Engineering plugin in Claude Code:

```bash
/plugin marketplace add EveryInc/compound-engineering-plugin
/plugin install compound-engineering
/ce-setup
```

`/ce-setup` bootstraps project configuration and installs supporting tools (`agent-browser`, `gh`, `jq`).

Available commands:

| Command | Purpose |
|---|---|
| `/ce:brainstorm` | Refine ideas into requirements through interactive Q&A |
| `/ce:plan` | Distill requirements into technical plan |
| `/ce:work` | Execute the plan |
| `/ce:review` | Multi-agent parallel review |
| `/ce:polish` | Human-in-the-loop polish after review |
| `/ce:compound` | Capture learnings to knowledge base |

### 12.3 The three review questions

After any AI-produced output, before accepting it, ask:

1. **"What was the hardest decision you made here?"** — Surfaces judgment calls.
2. **"What alternatives did you reject, and why?"** — Exposes the options considered.
3. **"What are you least confident about?"** — LLMs know their weaknesses if asked directly.

These three questions are applied to every milestone's work phase before moving to review.

### 12.4 The knowledge journal: `docs/COMPOUND.md`

Each milestone's compound phase appends to `docs/COMPOUND.md`. Format:

```markdown
## M[N]: [milestone name] — [date]

### What worked
- Bullet points of patterns that paid off

### What didn't
- Bullet points of mistakes, dead ends, false starts

### Invariants discovered
- Rules the codebase now enforces
- Constants that must not change
- Performance characteristics to preserve

### Gotchas for future milestones
- Things to watch out for when touching this area
- APIs that look similar but behave differently
- Edge cases that bit us
```

This file is loaded into context at the start of every subsequent `/ce:plan` invocation. The agent reads prior learnings before drafting new plans.

### 12.5 Phase 1 milestones — CE-structured

Each milestone follows Plan → Work → Review → Compound. Estimated times assume solo dev with Claude Max plan.

#### M1: Scaffold (2–3 hours)

**Plan (`/ce:plan`):**
- Research Next.js 15 App Router conventions for 2026.
- Identify Tailwind v4 drop-in integration gotchas.
- Resolve three.js + R3F versions known to be stable together.
- Output: `docs/plans/m1-scaffold.md` with package versions pinned.

**Work:**
- Initialize Next.js 15 with TypeScript strict mode.
- Add Tailwind v4 with §2.1 token config.
- Add `three`, `@react-three/fiber`, `@react-three/drei`, `zustand`, `idb-keyval`.
- Create MIT LICENSE and README.
- `/editor` renders rotating cube placeholder.
- `/` landing page as static server component.

**Review (`/ce:review`):**
- P1: All dependencies install cleanly, zero peer warnings.
- P2: TypeScript strict mode catches errors in baseline code.
- P3: README accurately describes project state.

**Compound:**
- Capture: which package versions combined without issues.
- Capture: any deprecations found and worked around.

**Acceptance:** `npm run dev` boots, `/editor` shows rotating cube.

---

#### M2: Player model (4–6 hours)

**Plan:**
- Read `docs/COMPOUND.md` for M1 learnings.
- Research Minecraft skin UV layout spec (from Perplexity round-2 research).
- Enumerate the 24 UV mappings (6 faces × 4 body parts × 2 variants) as constants.
- Specify idle animation parameters (1.5 Hz, 0.01 amplitude).

**Work:**
- Implement `lib/three/geometry.ts` with `CLASSIC_UVS` and `SLIM_UVS`.
- Implement `lib/three/PlayerModel.tsx` per §6.
- Replace M1 cube on `/editor`.
- Load default Steve skin from `public/templates/classic/blank-better.png`.
- Add temporary toggle button for Classic/Slim variant testing.

**Review:**
- P1: Arm width visibly differs between Classic and Slim.
- P1: UVs map correctly — no visible seams or misaligned textures.
- P2: Idle animation does not cause judder at 60fps.
- P3: Memory allocations in `useFrame` minimized.

**Compound:**
- Capture: the exact UV constants used, so future milestones don't re-derive.
- Capture: which R3F event patterns worked for the overlay layer.

**Acceptance:** Default skin renders correctly on both variants; Classic/Slim toggle produces visible arm-width difference.

---

#### M3: 2D paint surface (4–6 hours)

**Plan:**
- Specify canvas configuration for pixel-perfect rendering.
- Define `TextureManager` class contract.
- Pencil tool algorithm — single-pixel stamps at brush position.
- Integrate Zustand store for active tool, active color, active layer.

**Work:**
- Implement `lib/editor/texture.ts` per §7.
- Implement `lib/editor/tools/pencil.ts`.
- Implement `app/editor/_components/ViewportUV.tsx` with `willReadFrequently: true`.
- Wire up Zustand store skeleton.

**Review:**
- P1: Painted pixels are exactly 1×1 at zoom 1.0 — no antialiasing.
- P1: Painting on UV canvas updates `TextureManager`'s internal canvas.
- P2: rAF coalescing measurably reduces redundant `needsUpdate` calls.
- P3: Pointer events handle touch + mouse identically.

**Compound:**
- Capture: the correct canvas context options for pixel art.
- Capture: why `imageSmoothingEnabled = false` alone is insufficient.

**Acceptance:** Pixel-perfect painting on 64×64 UV canvas.

---

#### M4: 2D↔3D bridge (6–8 hours, highest technical risk)

**Plan:**
- Specify the raycast → UV coordinate path.
- Detail the inverse: paint-on-3D writes to same `TextureManager`.
- Edge cases: overlay layer occlusion, mirrored UVs on left/right body parts.
- Performance target: <16ms from pointer event to visible pixel change.

**Work:**
- Wire `onPaint` callback from `PlayerModel` to `TextureManager`.
- Extend Zustand store to share active tool/color across 2D and 3D.
- Implement hover preview (ghost cursor on the other surface).

**Review:**
- P1: Paint on UV → appears on 3D within 16ms.
- P1: Paint on 3D → appears on UV within 16ms.
- P1: No crosstalk between base and overlay layers.
- P2: Hover highlighting works both directions.
- P3: Dragging near UV seams does not produce gaps.

**Compound:**
- Capture: R3F's `intersect.uv` is populated automatically — no barycentric math required.
- Capture: Y-axis must be flipped (`1 - uv.y`) because UV is bottom-up and canvas is top-down.

**Acceptance:** Bidirectional painting at 60fps, no visual glitches.

---

#### M5: Tool palette (6–8 hours)

**Plan:**
- Read M4 compound notes for the raycast pipeline.
- Design the island-map generation algorithm per §9.1.
- Specify mirror tool's left/right lookup table per §9.2.
- Keyboard shortcut mapping: B/E/I/G/M.

**Work:**
- Implement `uv-map.ts` with `IslandMap` generator for both variants.
- Implement `tools/eraser.ts`, `tools/bucket.ts`, `tools/picker.ts`, `tools/mirror.ts`.
- Implement `Toolbar.tsx` with progressive disclosure (Pencil first, others after first use).
- Wire keyboard shortcuts.

**Review:**
- P1: Bucket fill never bleeds across UV island boundaries.
- P1: Mirror tool produces matching left/right strokes.
- P2: Picker respects layer stacking (samples composite color).
- P3: Keyboard shortcuts do not fire when typing in text inputs.

**Compound:**
- Capture: the `IslandMap` generation only needs to run once per variant per session.
- Capture: mirror lookup table per body part, as constant.

**Acceptance:** All five tools functional; keyboard shortcuts; mirror atomic.

---

#### M6: Layers + undo (6–8 hours)

**Plan:**
- Specify `LayerPanel` UX — add/delete/reorder/rename/opacity/blend mode.
- Detail the dirty-rect diff algorithm per §8.
- Edge cases: mirror strokes, bucket fills (full-canvas diff), layer opacity changes (not in history).

**Work:**
- Implement `lib/editor/undo.ts`.
- Implement `app/editor/_components/LayerPanel.tsx`.
- Extend Zustand store to emit `Stroke` records on every edit.
- Wire Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.

**Review:**
- P1: 100 consecutive pencil strokes → 100 undos fully restore blank canvas.
- P1: Bucket fill → single undo step.
- P1: Mirror stroke → single undo step.
- P2: Redo history clears correctly when new stroke interrupts.
- P3: Undo stack memory stays under 5 MB in typical session.

**Compound:**
- Capture: the diff format (bbox + before/after Uint8ClampedArray).
- Capture: why full snapshots were not used (memory).

**Acceptance:** Layer system complete; undo restores per stroke.

---

#### M7: Templates + persistence (4–6 hours)

**Plan:**
- Source or create the 10 template PNGs (Microsoft sample + 9 originals).
- Pre-render 256×256 WebP thumbnails.
- Specify `TemplateGate.tsx` state machine per §5.3.
- Specify IndexedDB schema for document persistence.

**Work:**
- Add template PNGs and thumbnails to `public/templates/`.
- Write `manifest.json`.
- Implement `TemplateGate.tsx` with Ghost Templates pattern.
- Implement `lib/editor/persistence.ts` with `idb-keyval`.
- Auto-save on every stroke (debounced 500ms).

**Review:**
- P1: Closing tab and reopening restores exact last document state.
- P1: First visit shows suggestion chip after 3.5s or first stroke.
- P1: Template selection triggers 2-second transition per §5.4.
- P2: localStorage `templates-dismissed` respected on subsequent visits.
- P3: Template licenses correctly declared in manifest.

**Compound:**
- Capture: `idb-keyval` handles serialization of `Uint8ClampedArray` correctly without conversion.
- Capture: debouncing cadence that balances data safety vs write volume.

**Acceptance:** Template picker works per spec; persistence survives reload.

---

#### M8: Export + onboarding polish (4–6 hours)

**Plan:**
- PNG export pipeline: composite all layers → canvas → `toBlob` → download.
- Onboarding polish per ChatGPT's first-paint hook spec (frame-by-frame).
- Landing page content + CTA.
- Luminance toggle implementation per §10.

**Work:**
- Implement `ExportDialog.tsx` with variant confirmation.
- Implement `grayscale-shader.ts` and `LuminanceToggle.tsx`.
- Polish `/editor` first-paint sequence: cursor glow, idle breathing, hover highlights, mouse-down response.
- Polish `/` landing page.

**Review:**
- P1: Exported PNG opens correctly in any Minecraft skin viewer.
- P1: Export respects both Classic and Slim variants.
- P2: First-paint sequence matches ChatGPT spec within ±100ms tolerance per frame.
- P2: Luminance mode desaturates both viewports, keeps swatches in color.
- P3: Lighthouse score on `/` above 95 for performance.

**Compound:**
- Capture: any renderer quirks when encoding PNG with transparent regions.
- Capture: which parts of the first-paint sequence had the highest perceptual impact.

**Acceptance:** Exportable skins work in-game; hook moment feels alive per spec.

### 12.6 Phase 2 milestones — CE-structured

| Milestone | Plan emphasis | Work | Review emphasis |
|---|---|---|---|
| M9: Firebase scaffolding | env-var setup, Admin SDK init, Spark-plan project | Client + admin SDKs, security rules v0 | Rules block cross-user writes correctly |
| M10: Auth flow | session cookie lifecycle, Next.js 15 async `cookies()` | Sign in / sign out, session route handler | Auth persists reload; server components see user |
| M11: Skin upload | Storage rules, OG image pipeline integration | Publish flow, OG render at publish | Upload respects 100 KB cap, OG renders correctly |
| M12: Gallery + likes | ISR cadence, denormalized counters, composite indexes | `/gallery` page, like toggle transaction | Read budget stays under 50K/day at projected traffic |
| M13: Profile pages | SEO-friendly server rendering | `/u/[username]` page | Indexable, meta tags correct |
| M14: Share metadata | OG tags, social preview testing | Meta tags on `/skin/[id]`, OG image served | Discord/Twitter previews render |

### 12.7 Parallelization: which work can compound engineering run concurrently?

Some milestones are inherently serial (e.g., M4 depends on M3's `TextureManager`). Others can run in parallel branches:

**Parallel-safe:**
- M7 template sourcing can begin during M5 or M6 (independent of core editor work).
- M13 profile pages can be developed in parallel with M12 gallery (different routes, same data model).
- Test suite development can run parallel to any implementation milestone.

**Must-serialize:**
- M1 → M2 → M3 → M4 (each builds on the prior's output).
- M5 requires M4's raycast infrastructure.
- M6 requires M5's tools to exercise the undo stack.
- M11 requires M10's auth.

The compound-engineering principle applies: document which tasks can be parallelized so future agents know which dispatches can safely go concurrent.

### 12.8 Division of labor across AI agents

| Agent | Access | Role |
|---|---|---|
| Claude Code (Opus 4.7) | Max plan | Primary driver. Runs `/ce:plan`, `/ce:work`, `/ce:review`. Architecture decisions. |
| Claude Code (Sonnet 4.6) | Max plan | Bulk feature work to conserve Opus budget. Used for `/ce:work` on straightforward milestones (M1, M3, M7). |
| Codex | Free tier | Isolated utilities (color conversions, math helpers). Second opinion on tricky algorithms. |
| Cursor | Free tier | Tab-completion during manual editing. Small inline refactors. |
| ChatGPT | Web UI | UX decisions, product taste, onboarding flows. Consulted at plan phase when UX is in scope. |
| Gemini | Web UI | Visual design, accessibility, multimodal features. Consulted at plan phase for visual polish. |
| Perplexity | Web UI | Primary-source research, license verification, library scouting. Consulted at plan phase for external facts. |

The Web-UI AIs (ChatGPT, Gemini, and Perplexity) contribute to the `/ce:plan` inputs. Their outputs are summarized into the plan document, which is then fed to Claude Code for the work phase. Multi-agent review during `/ce:review` is performed by the CE plugin's 14 parallel subagents within Claude Code.

### 12.9 The compound effect

By M8 (end of Phase 1), `docs/COMPOUND.md` should contain:

- Confirmed package versions and compatibility matrix (from M1).
- The exact UV layout constants for both variants (from M2).
- The canvas configuration that preserves pixel-art aesthetic (from M3).
- The R3F raycast → UV pattern and the Y-flip gotcha (from M4).
- The island-map algorithm and mirror lookup tables (from M5).
- The undo diff format and memory ceiling (from M6).
- IndexedDB serialization quirks (from M7).
- Any renderer-specific export issues (from M8).

Phase 2 milestones begin with this knowledge already available. M9's Firebase scaffolding does not need to rediscover that Uint8ClampedArray serializes correctly in IndexedDB — it's in the journal. M11's OG image generation does not need to rediscover the 3D rendering parameters — they're in the journal.

This is the compound effect: the codebase grows, but so does the institutional knowledge, and the second growth makes the first growth easier to maintain.

---

## 13. Operational concerns

### 13.1 Vercel Hobby bandwidth ceiling

100 GB/month is the binding constraint for public distribution. Threshold for concern: 50% of monthly quota. If reached:

1. Verify Web Analytics to identify traffic sources.
2. Audit bundle size — ensure three.js is lazy-loaded via `next/dynamic({ ssr: false })` only on `/editor`.
3. If organic growth exceeds quota, migration plan: move to Cloudflare Pages. Phase 1 is a static export; migration cost is low.

Cloudflare-in-front-of-Vercel was evaluated and rejected: Vercel officially recommends against it, ISR caching breaks, double-CDN adds ~50ms latency per request.

### 13.2 Firebase cost guarantee

No Cloud Billing account linked → Spark plan only → hard $0 cap. The path to Blaze is a deliberate one-click action, not a silent drift. Risk factors to monitor:

- Do not enable App Hosting (requires Blaze).
- Do not enable Cloud Functions (requires Blaze).
- Do not create new Cloud Storage buckets beyond the default `*.appspot.com` bucket.
- Do not enable phone authentication.

### 13.3 License hygiene

- Project LICENSE: MIT.
- `skinview3d` (MIT): read as spec only, knowledge-forked, not imported as dependency.
- Blockbench `.bbmodel` (GPL-3.0): clean-room parser implementation deferred to Phase 3. No Blockbench code imported.
- Template assets: Microsoft `minecraft-samples` (MIT) for one entry, originals for the other nine. No NovaSkin or Skindex user uploads (TOS prohibits redistribution).

---

## 14. Appendices

### 14.1 AI consultation archive

All prompts sent to ChatGPT, Gemini, and Perplexity, with their responses, are archived in `docs/PROMPTS.md`. This serves as:

- Audit trail for design decisions.
- Template library for future Phase 3+ consultations.
- Training data for the compound engineering knowledge journal.

### 14.2 Glossary

- **BaaS** — Backend-as-a-Service. Managed infrastructure providing database, auth, storage via SDK.
- **Blaze** — Firebase's pay-as-you-go plan. Requires linked billing account.
- **Classic variant** — Minecraft skin model with 4-pixel-wide arms (3,264 paintable pixels).
- **Compound Engineering** — Every's methodology. See Section 12.1.
- **`.bbmodel`** — Blockbench native JSON format. GPL-3.0.
- **Ghost Templates** — First-run template picker pattern. See Section 5.3.
- **Hook moment** — The first-paint sequence. See Section 12.5 M8.
- **Island map** — Static `Uint8Array` encoding which pixels belong to which UV region. See Section 9.1.
- **ISR** — Incremental Static Regeneration. Next.js caching strategy.
- **MAU** — Monthly Active User.
- **OG image** — Open Graph image, 1200×630 preview rendered for social sharing.
- **Slim variant** — Minecraft skin model with 3-pixel-wide arms (3,136 paintable pixels, also called "Alex").
- **Spark** — Firebase's free tier. Hard-capped without billing account.
- **UV mapping** — Correspondence between texture pixel `(u, v)` and 3D surface location.

### 14.3 Change log

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-04-18 | Initial draft after round 2 AI consultation |
| 0.2 | 2026-04-18 | Added Supabase BaaS spec |
| 0.3 | 2026-04-18 | Switched BaaS to Firebase Spark; integrated round-3 outputs; added Compound Engineering implementation plan |
| 0.4 | 2026-04-28 | Added M17 Enhancement: Two-Stage AI Pipeline Architecture |

---

## 15. M17 Enhancement — Two-Stage AI Pipeline Architecture

**Status:** Post-deployment discovery, documented 2026-04-28  
**Problem identified:** Single-stage AI generation (direct prompt → Cloudflare SDXL) produces generic images instead of properly formatted 64×64 Minecraft skin textures with correct UV mapping.

### 15.1 Current architecture (BROKEN)

```
User Prompt ("knight in red armor crying")
    ↓
[Cloudflare SDXL Lightning]
    ↓
Generic PNG image ❌
```

**Failure mode:** The AI generates a regular image (photo/illustration style) rather than understanding the Minecraft skin UV layout. Resulting textures don't map to head/body/arms/legs regions correctly.

### 15.2 New architecture — Two-stage pipeline

```
User Prompt
    ↓
[STAGE 1: GROQ (Llama 3.3 70B) — The Interpreter 🧠]
├─ System instructions: "You are a Minecraft skin designer. Break down the user's description into specific part-by-part descriptions."
├─ Input: "knight in red armor crying"
└─ Output: Structured JSON
    {
      "head": "Pale skin tone, red short hair, crying eyes with blue tears streaming down cheeks, sad expression",
      "headOverlay": "Silver knight helmet with red plume on top, partially covering the head",
      "torso": "Red and silver knight chest armor with gold accents, white tunic visible at waist",
      "torsoOverlay": "Red cloth cape attached to shoulders",
      "rightArm": "Red armored sleeve with silver shoulder guard and gold trim",
      "leftArm": "Red armored sleeve with silver shoulder guard and gold trim",
      "rightLeg": "Dark blue cloth pants, red armor plates on thigh and shin, brown boots",
      "leftLeg": "Dark blue cloth pants, red armor plates on thigh and shin, brown boots"
    }
    ↓
[STAGE 2: CLOUDFLARE WORKERS (SDXL Lightning) — The Renderer 🎨]
├─ For each body part:
│   ├─ Generate 8×8 or 4×8 texture region based on part description
│   ├─ Apply Minecraft pixel-art style constraints
│   └─ Place in correct UV coordinates
└─ Output: Valid 64×64 Minecraft skin texture ✅
```

### 15.3 Why this works

**Separation of concerns:**
- **Groq** = Fast (3-5sec), cheap ($0.59/1M tokens), excellent at reasoning and structured output
- **Cloudflare** = Powerful image generation, but needs explicit instructions per region

**Quality improvements:**
- Each body part gets focused, detailed description
- Groq understands creative intent ("crying knight") and translates to visual details
- Cloudflare receives precise per-region prompts instead of vague overall prompt

**Cost efficiency:**
- Stage 1 (Groq): ~500 tokens = $0.0003 per generation
- Stage 2 (Cloudflare): Same cost as current implementation
- Total additional cost: negligible

### 15.4 Implementation changes required

#### File: `lib/ai/types.ts`

```ts
// NEW: Structured skin part descriptions from Groq
export type SkinPartDescriptions = {
  head: string;
  headOverlay?: string;
  torso: string;
  torsoOverlay?: string;
  rightArm: string;
  leftArm: string;
  rightLeg: string;
  leftLeg: string;
  variant: 'classic' | 'slim';  // Groq determines which variant fits better
};

// EXISTING: Final parsed skin data
export type AISkinResponse = {
  palette: RGBA[];
  rows: Uint8Array[];
};
```

#### File: `lib/ai/groq-interpreter.ts` (NEW)

```ts
import 'server-only';
import Groq from 'groq-sdk';
import type { SkinPartDescriptions } from './types';

const SYSTEM_PROMPT = `You are a Minecraft skin designer AI. Your job is to break down user descriptions into detailed, part-by-part visual descriptions for a 64×64 Minecraft skin.

CRITICAL RULES:
1. Output ONLY valid JSON, no preamble, no markdown code fences
2. Each body part gets a detailed visual description (skin tone, clothing, armor, accessories, facial features)
3. Be specific about colors, textures, materials, and placement
4. Determine if classic (4px arms) or slim (3px arms) variant fits better
5. Overlay layers (headOverlay, torsoOverlay) are optional for additional details like helmets, capes, hoods

OUTPUT FORMAT:
{
  "head": "detailed description of head (skin, hair, facial features)",
  "headOverlay": "optional: helmet, hood, hat, or other head accessory",
  "torso": "detailed description of torso (clothing, armor, skin)",
  "torsoOverlay": "optional: cape, jacket, vest over the main torso",
  "rightArm": "detailed description of right arm",
  "leftArm": "detailed description of left arm", 
  "rightLeg": "detailed description of right leg",
  "leftLeg": "detailed description of left leg",
  "variant": "classic" or "slim"
}`;

export async function interpretPromptToSkinParts(
  userPrompt: string,
  signal: AbortSignal
): Promise<SkinPartDescriptions> {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY!,
  });

  const completion = await groq.chat.completions.create(
    {
      model: 'llama-3.3-70b-versatile',  // Fast, smart, great at structured output
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,  // Some creativity, but not too wild
      max_tokens: 800,   // Enough for detailed descriptions
      response_format: { type: 'json_object' },  // Force JSON output
    },
    { signal }
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Groq returned empty response');
  }

  const parsed = JSON.parse(content) as SkinPartDescriptions;
  
  // Validate required fields
  const required = ['head', 'torso', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg', 'variant'];
  for (const field of required) {
    if (!(field in parsed)) {
      throw new Error(`Groq output missing required field: ${field}`);
    }
  }

  return parsed;
}
```

#### File: `lib/ai/cloudflare-client.ts` (MODIFIED)

```ts
// BEFORE: Single prompt for whole skin
export async function generateSkinFromCloudflare(
  prompt: string,
  signal: AbortSignal
): Promise<CloudflareCallResult>

// AFTER: Part-by-part generation
export async function generateSkinFromParts(
  parts: SkinPartDescriptions,
  signal: AbortSignal
): Promise<CloudflareCallResult> {
  const { url, token } = readEnvOrThrow();
  
  // Build structured prompt for Cloudflare Worker
  // Each body part gets its own generation region with UV coordinates
  const structuredPrompt = {
    variant: parts.variant,
    regions: [
      { part: 'head', uvBounds: [8, 0, 16, 8], description: parts.head },
      { part: 'headOverlay', uvBounds: [40, 0, 48, 8], description: parts.headOverlay },
      { part: 'torso', uvBounds: [20, 20, 28, 32], description: parts.torso },
      // ... rest of UV mappings
    ],
    style: 'minecraft pixel art, blocky, low-poly, 64x64 texture',
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(structuredPrompt),
    signal,
  });

  // ... rest of implementation
}
```

#### File: `app/api/ai/generate/route.ts` (MODIFIED)

```ts
// BEFORE: Direct Cloudflare call
const result = await generateSkinFromCloudflare(prompt, signal);

// AFTER: Two-stage pipeline
// Stage 1: Interpret user prompt into part descriptions
const parts = await interpretPromptToSkinParts(prompt, signal);

// Stage 2: Generate skin from structured parts
const result = await generateSkinFromParts(parts, signal);
```

### 15.5 Cloudflare Worker changes

The Worker endpoint needs to understand the new structured input format and generate each region separately:

```js
// worker.js (pseudocode)
export default {
  async fetch(request, env) {
    const { variant, regions, style } = await request.json();
    
    // Create 64×64 canvas
    const skinTexture = new Uint8Array(64 * 64 * 4);
    
    // For each region
    for (const region of regions) {
      if (!region.description) continue;  // Skip if optional part is empty
      
      // Generate this specific part
      const partPrompt = `${region.description}, ${style}`;
      const partImage = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-lightning', {
        prompt: partPrompt,
        num_steps: 4,  // Fast generation
        width: (region.uvBounds[2] - region.uvBounds[0]) * 8,  // UV to pixel conversion
        height: (region.uvBounds[3] - region.uvBounds[1]) * 8,
      });
      
      // Place generated part at correct UV coordinates
      blitImageToUV(skinTexture, partImage, region.uvBounds);
    }
    
    return new Response(skinTexture, { headers: { 'Content-Type': 'application/octet-stream' } });
  }
};
```

### 15.6 Benefits

**Quality:**
- ✅ Generates actual Minecraft skins instead of generic images
- ✅ Each body part receives focused attention
- ✅ Creative intent preserved (crying knight, cyberpunk hacker, etc.)

**Performance:**
- ✅ Groq stage: 3-5 seconds
- ✅ Cloudflare stage: 15-20 seconds (unchanged)
- ✅ Total: 18-25 seconds (acceptable for high-quality generation)

**Cost:**
- ✅ Groq: $0.0003 per generation (negligible)
- ✅ Cloudflare: Same as before
- ✅ Dual-mode UI preserved (Fast mode uses Groq only for simple skins)

### 15.7 Rollout plan

This enhancement will be implemented by Claude Code following the Compound Engineering methodology:

1. **Plan phase** (`/ce:plan`) — Detailed technical plan with edge cases
2. **Work phase** (`/ce:work`) — Implementation with tests
3. **Review phase** (`/ce:review`) — Multi-agent parallel review
4. **Compound phase** (`/ce:compound`) — Capture learnings in `docs/COMPOUND.md`

**Testing strategy:**
- Unit tests for JSON parsing/validation from Groq
- Integration tests for end-to-end pipeline
- Visual regression tests comparing generated skins to expected UV layouts
- Cost tracking to ensure budget stays under $0.01 per generation

---

*End of design document.*
