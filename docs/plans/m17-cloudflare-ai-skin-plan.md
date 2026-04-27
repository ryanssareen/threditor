---
title: "M17: Cloudflare Workers AI Skin Generation"
type: feat
status: active
date: 2026-04-27
origin: M17-CLOUDFLARE.md
---

# M17: Cloudflare Workers AI Skin Generation

## Overview

Replace the Groq text-LLM skin generator (M16) with a Cloudflare Workers AI image-generation pipeline backed by Stable Diffusion XL Lightning. The worker returns a 512×512 PNG; a server-only Next.js route downsamples it to 64×64, quantizes to ≤16 colors, and emits the existing `{ palette, rows }` RLE schema that the M16 codec already round-trips into a `Uint8ClampedArray(16384)`.

The change is intentionally narrow at the route boundary: **only the model-call step changes**. Auth, rate-limiting, the aggregate kill switch, the typed-error tree, abort handling, and `/aiGenerations` logging from M16 all stay intact. The codec (`lib/ai/skin-codec.ts::validateResponse`) and the client-side `AISkinResponse` type seam stay untouched.

## Problem Frame

M16's Groq path produces poor skins because text models cannot reason about visual composition, palette harmony, or pixel-art structure. Operator logs from M16 show frequent auto-fix triggers (row-count drift, run-sum mismatches), and the "successful" output still looks blocky and incoherent. We want a generator that has actual visual understanding and removes the auto-fix dependency entirely.

This plan migrates to a different model class (image generation) under a different cost model (Cloudflare Neurons) while preserving the entire defense-in-depth envelope M16 invested in.

> **Critical premise risk to validate before full build-out:** Stock SDXL was trained on natural images, not Minecraft skin atlases. A 64×64 Minecraft skin is a UV unwrap with specific regions for head front/back/sides, torso, arms, legs, and overlay layers — not a flat front-view picture. Naively downscaling a 512×512 character render to 64×64 will smear a tiny portrait across UV regions and produce a visually broken player model. Public projects that successfully generate skins (Monadical Labs `minecraft-skin-generator-sdxl`, BLOCK paper, Crafty Skins) all use fine-tuned models. Unit 1 is a quality spike that gates the rest of this plan.

## Requirements Trace

- **R1.** Replace Groq with a Cloudflare-hosted image generator as the primary AI skin source.
- **R2.** Ship without changing the `AISkinResponse` shape (`{ palette: string[1..16], rows: [number,number][][64] }`) — clients keep working unchanged.
- **R3.** The new Cloudflare pipeline emits shape-correct output by construction (no auto-fixes needed). The existing auto-fix code in `lib/ai/groq.ts` (lines 327–413: row padding, run-sum padding, truncation) is preserved during the rollout window and is only removed when `groq.ts` itself is removed in Unit 8.
- **R4.** Preserve the M16 route envelope: Bearer→cookie auth, Firestore-transactional rate limiting (5/hr, 30/day, 15/IP/hr), `/aiConfig/global` kill switch, `/aiGenerations` logging with PII redaction, slot-burn-with-pre-stream-refund policy, `runtime = 'nodejs'`.
- **R5.** Keep the public Cloudflare Worker URL non-public-billable: anonymous callers cannot drain Neurons or trigger SDXL.
- **R6.** Keep the Vercel client bundle clean — `sharp` and worker-call code never reach a client chunk. `/editor` page bundle stays at or below the M16 baseline (492 kB).
- **R7.** Surface the change in `/aiGenerations` logs so operator review can compare cohort quality (Groq vs Cloudflare) for the rollout window.
- **R8.** Hold per-day generation cost ≤ free Cloudflare tier (10,000 Neurons/day) under expected hobby load. Trip a kill switch before the cliff.

## Scope Boundaries

- **Not in scope:** A full migration to a Minecraft-skin-fine-tuned model (Monadical SDXL via Replicate). That is a separate, follow-up decision that depends on Unit 1's spike outcome.
- **Not in scope:** Removing `lib/ai/groq.ts` immediately. Keep it on disk during rollout so we can flip back via env if Cloudflare quality fails the gate. Removal is a follow-up commit once we have ≥1 week of `/aiGenerations` cohort data.
- **Not in scope:** ControlNet, IP-Adapter, LoRA, or img2img with template guides. Cloudflare Workers AI does not expose LoRA adapters for image models, and ControlNet is unavailable on the platform. Any of these would require leaving Workers AI.
- **Not in scope:** A second-pass safety/NSFW classifier. SDXL on Workers AI ships without one, but adding Llama-Guard or banned-substring checks is outside this plan's scope. Add to backlog only if abuse is observed.
- **Not in scope:** Streaming progress to the client. The route remains a single-response POST.

## Context & Research

### Relevant Code and Patterns

- **`app/api/ai/generate/route.ts`** — M16 POST handler. The "envelope" we keep intact. The Groq-call step (`generateSkin(prompt, signal)`) is the only thing that changes; everything around it (auth, rate limit, kill switch, error mapping, `/aiGenerations` logging, slot-burn refund policy) stays.
- **`lib/ai/skin-codec.ts`** — Pure validation + decode. `validateResponse` is the contract the new pipeline must satisfy. Reuse unchanged.
- **`lib/ai/types.ts`** — Pure type seam (no `'server-only'`). `AISkinResponse` is consumed client-side by `EditorLayout.tsx`. Stay shape-compatible.
- **`lib/ai/groq.ts`** — Source of the typed-error tree pattern (`GroqEnvError`, `GroqAuthError`, `GroqRateLimitError`, `GroqUpstreamError`, `GroqTimeoutError`, `GroqAbortedError`, `GroqValidationError`). Mirror this discipline for `lib/ai/cloudflare-client.ts`.
- **`lib/ai/rate-limit.ts`** — Three-bucket Firestore transaction + `/aiConfig/global.todayTokens` aggregate kill switch. Adapt the kill switch to track Cloudflare call count instead of (or in addition to) tokens.
- **`lib/ai/prompt.ts`** — Cost-estimation seam (`costEstimateUsd`). Replace Groq-token pricing with Cloudflare-Neuron pricing; keep the same fn signature so log writes stay compatible.
- **`lib/firebase/ai-logs.ts`** — Best-effort `/aiGenerations` logger. Keep unchanged; pass `model: 'cf/sdxl-lightning'` and `provider: 'cloudflare'` instead of the Groq model name. The retention discipline (90d TTL, no ipHash co-location) stays.
- **`app/editor/_components/EditorLayout.tsx`** — Client consumer. Reads `palette` and `rows` from the response. No changes needed if we preserve the response body.

### Institutional Learnings

- **M16 retro (`docs/COMPOUND.md` lines 879–983):** The route envelope is load-bearing. Replacing Groq with Cloudflare must not "Replace Groq implementation" wholesale — only the model-call inner step changes.
- **M16 plan (`docs/plans/m16-ai-skin-generation-plan.md`):** `runtime = 'nodejs'` is mandatory because of `firebase-admin`. Sharp also requires Node — alignment is fortunate. `request.json()` is read-once into a const. Heavy SDKs go through dynamic `await import()` inside the handler to keep client bundles clean.
- **M11 retro (`docs/COMPOUND.md` lines 789–877):** Bundle baseline for `/editor` is 480 kB; M16 added 1 kB to 492 kB. Sharp must never land in any client bundle — `lib/ai/cloudflare.ts` starts with `import 'server-only'`.
- **M11 retro (image-pipeline lessons):** WebP at 0.95 produced 300–400 KB; SDXL at 512×512 returns ~1–2 MB PNG. Stream binary, not base64, between Worker → Vercel route to avoid 33% inflation.
- **Server-only env-shape diagnostic pattern (M9/M10/M11/M16):** When `GROQ_API_KEY` is missing/malformed, the 500 body includes `{ envKeyShape: { present, length, prefix } }` — never key material. Mirror this for `CLOUDFLARE_WORKER_URL` and `CLOUDFLARE_WORKER_TOKEN`.

### External References

- **Sharp `palette: true` does not expose the (palette, indices) pair** — it only writes a quantized PNG. For our RLE pipeline we need both palette and per-pixel indices, so quantization happens in `image-q` (TS, no native deps), not in sharp. Sharp does the resize; `image-q` does the palette reduction. ([sharp docs](https://sharp.pixelplumbing.com/api-output/#png), [image-q npm](https://www.npmjs.com/package/image-q))
- **Resampling kernel:** `lanczos3` (sharp default), not `nearest`. SDXL output is continuous-tone — `nearest` aliases; `lanczos3` averages each 8×8 block before quantization, which is where the pixel-art look comes from. ([sharp resize](https://sharp.pixelplumbing.com/api-resize/))
- **Sharp on Vercel + Next 15 App Router:** "Just works." Sharp is in Next 15's default `serverExternalPackages` allowlist. No webpack config needed. Vercel ships the linux-x64 prebuilt; cold-start hit is ~80–200 ms on first invoke (amortized by Fluid Compute). ([Next.js external packages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages))
- **Cloudflare Workers AI free tier (2026):** **10,000 Neurons/day**, not 100,000 calls — the M17-CLOUDFLARE.md draft is wrong on this. Base SDXL ≈ 200 Neurons/call → ~50 free base-SDXL calls/day. **SDXL Lightning's per-call Neuron cost is not separately documented; the working assumption is roughly 1/3 of base SDXL because `num_steps` is 8 instead of 20 and Neuron pricing for image models is dominated by the per-step term.** That assumption is verified during Unit 1 by observing the daily Neuron consumption in the Cloudflare dashboard after a known number of calls. The kill-switch threshold (8,000 calls) is sized assuming Lightning is ≥1.25× cheaper than base SDXL. If Unit 1 reveals Lightning costs match base SDXL, drop the threshold to 40 calls/day and reopen this decision. ([Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/))
- **`env.AI.run()` for image models** returns `ReadableStream` of binary PNG bytes, not base64-encoded JSON. ([SDXL model card](https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-base-1.0/))
- **SDXL Lightning** (`@cf/bytedance/stable-diffusion-xl-lightning`): same I/O as base SDXL, ~3× faster at equivalent quality. Preferred for this use case to reduce per-call CPU and Neurons. ([Lightning model card](https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-lightning/))
- **No NSFW filter** ships with SDXL on Workers AI. We layer none in this plan; we accept the risk for an MVP and rely on the existing prompt-validation regex (`FORBIDDEN_CHARS`, length cap, NFKC) plus the per-uid rate limit.
- **Atlas-vs-character mismatch is the dominant quality risk.** Public skin generators (Monadical, BLOCK paper, Crafty Skins) all use fine-tuned models. None successfully use stock SDXL via naive downscale. Unit 1 (spike) explicitly tests how bad this is for our specific prompts.

## Key Technical Decisions

- **Use SDXL Lightning, not base SDXL.** Same quality at ~3× speed, fewer Neurons per call. Model: `@cf/bytedance/stable-diffusion-xl-lightning`.
  *Rationale:* Speed reduces wall-time inside the existing 30s `HARD_TIMEOUT_MS`, lowers cold-start risk, and stretches the 10K Neurons/day budget.

- **Resize with `lanczos3`, not `nearest`.** Quantize to ≤16 colors via `image-q` after the resize.
  *Rationale:* Nearest-neighbor on continuous-tone SDXL Lightning output produces aliasing dependent on phase; lanczos3 averages each 8×8 block to a clean RGBA, which `image-q` then collapses to 16 representative colors. The original M17-CLOUDFLARE.md draft inverted this — its "frequency-top-16" implementation was not real median cut and would collapse smooth gradients to their mode.

- **Stream binary, not base64**, between Worker and Next.js route. Worker returns `Content-Type: image/png` with the raw PNG; the route does `Buffer.from(await res.arrayBuffer())`.
  *Rationale:* 33% bandwidth savings on a ~1–2 MB payload, no double encode/decode, matches M11 image-pipeline learnings.

- **Worker auth via shared bearer token**, stored as a Wrangler secret on the Worker side (`SDXL_TOKEN`) and as `CLOUDFLARE_WORKER_TOKEN` env var on the Vercel side. Worker rejects 401 if `Authorization: Bearer …` is absent or wrong. Layer a Cloudflare WAF rate-limit rule on the Worker route (e.g., 10 req/min/IP) for defense in depth.
  *Rationale:* The Worker URL is discoverable; without auth, anonymous callers drain Neurons billed to our account. WAF adds a cheap second layer.

- **Preserve the M16 route envelope.** Replace only the inner model-call step. Keep auth, rate limit, kill switch, `/aiGenerations` logging, slot-burn refund policy, typed-error mapping.
  *Rationale:* M16 retro is explicit that this scaffolding is load-bearing. The M17-CLOUDFLARE.md draft's "Replace Groq implementation" framing would discard ~80% of M16's defense-in-depth.

- **Mirror the typed-error tree** for Cloudflare. New errors: `CloudflareEnvError`, `CloudflareAuthError`, `CloudflareTimeoutError`, `CloudflareUpstreamError`, `CloudflareAbortedError`, `CloudflareRateLimitError`, `ImageProcessingError`. Map to the same HTTP status codes the M16 errors use, so client behavior is unchanged.
  *Rationale:* Consistent status codes mean the editor's existing error-handling UI keeps working without changes. New error types let the route's slot-burn policy reuse its decision tree.

- **`lib/ai/cloudflare.ts` is `'server-only'`.** Sharp's native bindings cannot land in any client bundle. Dynamic `await import()` for sharp inside the handler, mirroring the Groq SDK pattern.
  *Rationale:* Direct M11/M16 invariant.

- **Aggregate kill switch tracks Cloudflare call count, not tokens.** Add `/aiConfig/global.todayCloudflareCalls`, trip at 8,000 (80% of 10K free tier). Keep `todayTokens` for backward read compatibility but stop incrementing it.
  *Rationale:* Cloudflare's hard cliff is per-call, not per-token. The M16 `AGGREGATE_TOKEN_CAP = 80_000` is wrong context for this provider.

- **Quantization library: `image-q`** (TS, zero native deps, alpha-aware). Use the RGBQuant algorithm with CIEDE2000 distance.
  *Rationale:* Sharp's `palette: true` only writes a quantized PNG without exposing palette + indices. `image-q` returns a `PointContainer` from which we extract palette and per-pixel indices for RLE conversion. Hand-rolling median cut is overkill for 4096 pixels into 16 buckets.

- **Phase rollout behind an env flag** (`AI_PROVIDER=cloudflare|groq`). **Code default: `groq`.** Operators flip to `cloudflare` per environment (preview first, then production) only after a successful manual smoke. Ship Groq-removal in a follow-up after the rollout window completes (see Unit 8).
  *Rationale:* The atlas-vs-character risk is real; defaulting to `groq` in code means a botched deploy or env-misconfiguration falls back to the known-working M16 path rather than producing broken skins. Flipping the env to `cloudflare` is an explicit operator action per environment, and reverting is a Vercel env change (no redeploy).

## Open Questions

### Resolved During Planning

- **"100,000 free calls/day" vs reality.** Resolved: Cloudflare's free tier is 10,000 Neurons/day; SDXL is ~200 Neurons/call → ~50 free SDXL calls/day. Update the kill switch to trip at 8,000 calls.
- **`palette: true` to get indices for RLE?** Resolved: No — sharp's palette mode only affects the encoded PNG. Use `image-q` for palette + indices.
- **Resize kernel?** Resolved: `lanczos3`, not `nearest`. Quantize after, not during, the resize.
- **Base64 or binary between Worker → Vercel?** Resolved: binary `arrayBuffer()`. The original draft's `await response.text()` was wrong.
- **Replace M16 route entirely or surgically swap?** Resolved: surgical swap. Preserve auth, rate limit, kill switch, logging, slot-burn policy.
- **Hard switch or feature flag?** Resolved: env flag (`AI_PROVIDER`) for the rollout window, hard removal of Groq in a follow-up commit after cohort review.
- **Bearer auth or HMAC for the Worker?** Resolved: shared bearer token via Wrangler secret + WAF rate-limit rule. HMAC is over-engineered for this surface and the token never leaves the Vercel server.

### Deferred to Implementation

- **Exact `image-q` palette algorithm and distance metric.** RGBQuant + CIEDE2000 is the working hypothesis. If output looks washed-out or noisy on real SDXL frames during Unit 1's spike, switch to NeuQuant or WuQuant before locking in. This depends on seeing real images.
- **Worker WAF rule rate limit.** Working hypothesis: **60 req/min/IP** (raised from the original 10/min/IP draft because ALL legitimate traffic comes from Vercel's small egress IP pool). The WAF rule's job is to bound a token-leak abuse scenario, not to throttle legitimate Vercel traffic. Final value depends on observed dev traffic patterns; revisit if false-positive 429s show up.
- **Cold-start mitigation.** SDXL Lightning may have its own cold-start; if the first call of the day takes >10s, we may want a Worker scheduled trigger to keep it warm. Defer to operator review after a week.
- **Sharp output format precision for our pipeline.** We expect `.removeAlpha().raw().toBuffer()` is the right shape, but if the model emits a non-RGB output (rare) we may need to force-convert. Discover at implementation time.
- **Whether to keep `lib/ai/prompt.ts::costEstimateUsd` and pass `0` for Cloudflare**, or write a `cloudflareCostEstimateUsd` based on Neurons. Either preserves the `/aiGenerations` log shape; pick the one that reads cleanest in the route.
- **Whether `image-q` exposes a synchronous API path for our small input.** If it forces async-only on a 64×64 RGBA, the route has one extra `await`. Trivial either way.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                                  ┌────────────────────────────────────────────┐
                                  │  Vercel Next.js — runtime: 'nodejs'        │
                                  │  app/api/ai/generate/route.ts (preserved)  │
                                  ├────────────────────────────────────────────┤
  client POST {prompt}            │  1. validatePrompt (existing)              │
   ───────────────────────────►   │  2. resolveSession (existing)              │
                                  │  3. checkAndIncrement rate limits (exist.) │
                                  │  4. ─────  AI provider switch ─────        │
                                  │     AI_PROVIDER === 'cloudflare':          │
                                  │       a. fetch Worker (binary PNG)         │
                                  │       b. lib/ai/cloudflare.ts pipeline     │
                                  │       c. validateResponse  (existing)      │
                                  │     AI_PROVIDER === 'groq':                │
                                  │       generateSkin() (existing M16)        │
                                  │  5. logGeneration (existing, model swap)   │
                                  │  6. return { palette, rows }               │
                                  └────────────────────────────────────────────┘
                                                │
                                                │ HTTP POST
                                                │ Authorization: Bearer ${TOKEN}
                                                │ {"prompt": "..."}
                                                ▼
                                  ┌────────────────────────────────────────────┐
                                  │  Cloudflare Worker (workers/ai-skin-       │
                                  │  generator.js)                              │
                                  ├────────────────────────────────────────────┤
                                  │  • verify Authorization header             │
                                  │  • prompt-shape SDXL Lightning input       │
                                  │  • env.AI.run('@cf/bytedance/sdxl-lightning')│
                                  │  • return ReadableStream as image/png      │
                                  └────────────────────────────────────────────┘

  lib/ai/cloudflare.ts pipeline (server-only):

    PNG buffer
      │
      ├─► sharp.resize(64, 64, { kernel: lanczos3, fit: 'fill' })
      │       .raw().toBuffer()                                     →  64×64 RGBA
      │
      ├─► image-q.buildPaletteSync({ colors: 16, algo: 'rgbquant' })→  16 colours
      │   image-q.applyPaletteSync(point, palette)                  →  64×64 indices
      │
      ├─► palette: index→`#rrggbb(aa)` strings (1..16 entries)
      │
      └─► rows: per-row RLE pairs [paletteIdx, runLength], runs sum to 64
              ↓
          AISkinResponse { palette, rows }    ── shape matches M16 ──
              ↓
          validateResponse (existing) — should always pass by construction
```

The diagram captures the approach shape: a thin worker for the model call, a server-only image pipeline on the Vercel side, a feature-flagged provider switch inside the existing route. It does not specify implementation details.

## Implementation Units

- [ ] **Unit 1: Quality spike — deploy a thin Worker and eyeball SDXL output for skins**

**Goal:** Validate the dominant premise risk before investing in the full pipeline. Generate 8–10 sample images for representative prompts ("knight in red armor", "wizard in purple robe", "astronaut", "robot", "Steve", "pirate", "ninja", "ghost") and visually decide whether the naive 512→64 lanczos pipeline can ever produce skins that look acceptable on the 3D player model.

**Requirements:** R1 (gates feasibility).

**Dependencies:** Cloudflare account, Wrangler CLI access.

**Files:**
- Create: `workers/ai-skin-generator.js` (thin spike version — no auth, returns binary PNG)
- Create: `workers/wrangler.toml`
- Create: `scripts/spike-skin-conversion.mjs` (local Node script — fetches the worker, runs sharp+image-q+RLE, writes both the raw 512 PNG and the converted 64×64 PNG to `/tmp/m17-spike/`)
- No `Test:` — manual eyeball QA, gate decision, not automated.

**Approach:**
- Deploy the spike worker under a **separate, throwaway Cloudflare Worker name** (e.g., `ai-skin-generator-spike`) so the URL/route is distinct from the production Worker created in Unit 2 — an attacker who finds the spike URL does not gain access to the production endpoint.
- Spike worker is gated by a **temporary minimum-viable bearer token** (a 32-char random string in a Wrangler secret) — not "public access". This bounds Neuron drain if the URL is leaked or crawled before teardown.
- Add a Cloudflare WAF rate-limit rule on the spike route at 5 req/min/IP for the duration of the spike.
- The Node spike script calls the worker, runs the full image pipeline locally, and writes side-by-side outputs (raw 512 PNG + converted 64×64 PNG).
- Manually open the 64×64 results in the existing editor (drag-and-drop or paste) to see them on the 3D player model. **The 3D player-model render is the load-bearing evaluation surface — a 64×64 image alone hides the UV-atlas mismatch that is the dominant failure mode.**
- Sample real prompts from M16 `/aiGenerations` (last 50 successful generations) in addition to the curated list, so the spike sees the actual prompt distribution rather than only in-distribution examples.
- Repeat each prompt 3× to measure determinism variance (mode-collapse symptoms with Lightning's low step count).
- Score outputs against three bars: (1) "loads in editor without errors", (2) "head/face recognizably matches prompt on the 3D model", (3) "body/limbs are coherent rather than melted-portrait noise on the 3D model".
- **GO/NO-GO gate:** if ≥6/10 prompts hit bar 2 *across all three repetitions*, continue. If <6/10 hit bar 2, stop and reopen the architecture decision (see deferred Open Question on Monadical fine-tune via Replicate).
- **Teardown step (mandatory before Unit 2):** `wrangler delete ai-skin-generator-spike` and confirm the URL returns 404. Record teardown timestamp in §Quality Gate Outcome.

**Execution note:** This is a manual spike, not test-first. The deliverable is a written GO/NO-GO recommendation appended to this plan, not code merged to main.

**Patterns to follow:**
- M11 spike pattern of `/scripts/*` for one-off pipelines.
- M16 worker-call shape from M17-CLOUDFLARE.md draft — but with `arrayBuffer()`, not `text()`.

**Test scenarios:** *(none — manual gate)*

**Verification:**
- A short note appended to this plan in §Quality Gate Outcome with: prompts attempted, pass/fail per bar, recommended next step (proceed / pivot to Monadical Replicate / pivot to Tier-B template-compositing).

---

- [x] **Unit 2: Production Cloudflare Worker (auth + WAF rate limiting)**

**Goal:** Replace the spike worker with a production-grade `workers/ai-skin-generator.js` that requires a bearer token and is rate-limited by Cloudflare WAF. Worker remains responsible only for the model call; no business logic.

**Requirements:** R5, R8.

**Dependencies:** Unit 1 GO outcome.

**Files:**
- Modify: `workers/ai-skin-generator.js` (add bearer-token check, drop CORS `*`, return binary PNG, error envelope)
- Modify: `workers/wrangler.toml` (define `[ai] binding = "AI"`, declare `SDXL_TOKEN` as a secret reference, set compatibility date)
- Create: `workers/README.md` (deploy steps, secret rotation, WAF rule reference)
- Test: `workers/__tests__/auth.test.mjs` (Miniflare or wrangler dev — token present passes, missing returns 401, wrong token returns 401)

**Approach:**
- Worker validates `Authorization: Bearer ${env.SDXL_TOKEN}` before any `env.AI.run()` call.
- Worker calls `@cf/bytedance/stable-diffusion-xl-lightning` with `width: 512, height: 512, num_steps: 8` (Lightning sweet spot), `guidance: 7.5`, plus a hardcoded prefix prompt: `"pixel art, 64x64 minecraft skin texture, character front view, simple flat colors, "`.
- Returns the `ReadableStream` directly with `Content-Type: image/png`. No base64. No JSON wrapping.
- On model error: returns `502` with a small JSON body `{ error: "upstream", code }`.
- Wrangler secret `SDXL_TOKEN` is set via `wrangler secret put SDXL_TOKEN` — not committed.
- Configure a WAF rate-limit rule (**60 req/min/IP** — raised from the draft's 10/min to accommodate Vercel egress-IP concentration; the per-uid app-level 30/day cap is the real abuse defense) in the Cloudflare dashboard. Document the steps in the README; this is configuration, not code. Snapshot the rule JSON into `workers/waf-rules.json` for change-tracking, since dashboard-only state has no audit trail.

**Patterns to follow:**
- Cloudflare Workers basic-auth example for the bearer check.
- Wrangler secret pattern (no env in code, no env in repo).

**Test scenarios:**
- Happy path: valid token + valid prompt → 200, image/png response, body length > 1000 bytes.
- Edge case: empty `prompt` field → worker returns 400 with `{ error: "prompt_required" }`.
- Error path: missing `Authorization` header → 401.
- Error path: wrong token → 401.
- Error path: model returns error → 502 with `{ error: "upstream" }`.
- Integration: end-to-end via Wrangler dev — POST, receive streaming PNG, decode with sharp locally, confirm 512×512 RGBA.

**Verification:**
- `wrangler deploy` succeeds with secret bound; deployed URL responds 401 for anonymous and 200 for authenticated requests.
- WAF rate-limit rule is visible in the dashboard with the documented threshold.

---

- [x] **Unit 3: Image processing module — `lib/ai/cloudflare.ts`**

**Goal:** Convert a 512×512 PNG buffer into the `AISkinResponse` shape: `lanczos3` resize to 64×64, `image-q` quantization to ≤16 colors, RLE encode rows. `'server-only'` guard. Pure function — no I/O.

**Requirements:** R3, R6.

**Dependencies:** Unit 2 (need a real PNG source for integration tests).

**Files:**
- Create: `lib/ai/cloudflare.ts`
- Create: `lib/ai/cloudflare-quantize.ts` (palette + index extraction helper, separated for unit-testability)
- Test: `lib/ai/__tests__/cloudflare.test.ts`
- Test: `lib/ai/__tests__/cloudflare-quantize.test.ts`
- Modify: `package.json` (add `sharp@^0.33`, `image-q@^4`)

**Approach:**
- `import 'server-only'` at the top.
- Public surface: `generateSkinFromImage(pngBuffer: Buffer): Promise<AISkinResponse>`.
- Sharp pipeline: `sharp(buf).resize(64, 64, { kernel: 'lanczos3', fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })` — yields RGBA. **`.ensureAlpha()` is mandatory, not optional.** Minecraft skin atlases require transparency in the second-layer overlay regions and unused atlas slots; the existing M16 system prompt explicitly tells the model to use `#00000000` for those regions, and the codec (`lib/ai/skin-codec.ts`) accepts `#rrggbbaa` palette entries for exactly this reason. SDXL output is opaque RGB, so most pixels will land at alpha=0xFF; the alpha channel matters only for any region the model paints near-transparent (rare from SDXL but not impossible) and as a forward-compatible seam for a future M18 improvement that injects transparent overlay-region pixels post-quantize. `image-q` is alpha-aware and produces palette entries that include alpha; emit `#rrggbb` when alpha=0xFF and `#rrggbbaa` otherwise.
- `image-q.buildPaletteSync` with `{ colors: 16, paletteQuantization: 'rgbquant', colorDistanceFormula: 'ciede2000' }`.
- `image-q.applyPaletteSync` to map each pixel to its palette index. Build a `Map<rgba32, paletteIndex>` cache for the back-mapping.
- Convert to RLE: scan row-major, accumulate runs, emit `[idx, run]` pairs that always sum to 64.
- Throw `ImageProcessingError` (typed) on sharp/image-q failures with a category tag (`resize_failed`, `quantize_failed`, `rle_failed`).
- **No auto-fixes.** If the output ever fails `validateResponse`, that's a bug in this module, not a model failure — let it surface.

**Execution note:** Implement test-first. Each test scenario below should fail before the corresponding code is written.

**Patterns to follow:**
- `lib/ai/skin-codec.ts` for module style (pure, validate-before-allocate, no logging side effects).
- Dynamic `await import()` of sharp inside the function to keep cold-start cheap when the route falls through to Groq via the env flag.

**Test scenarios:**
- Happy path: synthetic 512×512 solid `#ff0000` PNG → palette `["#ff0000"]`, all 64 rows are `[[0, 64]]`.
- Happy path: synthetic 512×512 horizontal red/blue gradient → palette has ≤16 colors, every row's run sum is exactly 64.
- Edge case: 512×512 image with 17 distinct hand-picked colors → output palette is exactly 16 (quantization caps it).
- Edge case: 512×512 hard-edge image (left half color A, right half color B) → after lanczos resize and 16-color quantize, palette ≤ 16; the dominant color of columns 0–28 maps to color A, columns 36–63 to color B; the transition zone (columns ~29–35) may contain intermediate quantized colors due to lanczos overshoot — assert only the dominant-color regions, not pixel-perfect splits.
- Edge case: 512×512 noise image (random colors per pixel) → output produces a valid `AISkinResponse` (palette ≤16, every row sums to 64, no shape errors).
- Edge case: 512×512 image with corner regions painted alpha=0 (transparent) → palette includes at least one `#rrggbbaa` entry where alpha=0; the corner pixels in the output reference that index. Confirms the `ensureAlpha()` + alpha-aware quantization path.
- Edge case: input buffer is empty → throws `ImageProcessingError('resize_failed')`.
- Edge case: input buffer is a non-PNG (e.g., truncated or random bytes) → throws `ImageProcessingError('resize_failed')`.
- Integration: pipe a real saved Unit-1 spike PNG through the full pipeline → `validateResponse` from `skin-codec.ts` passes without any auto-fix; round-tripping `decode(...)` produces a 16384-byte `Uint8ClampedArray`.
- Integration: every output across all happy-path and edge cases passes `validateResponse` from `lib/ai/skin-codec.ts` unchanged (no auto-fixes triggered).

**Verification:**
- All tests pass under `npm test`.
- Manually inspect a sample output: `decode(generateSkinFromImage(samplePng))` produces a 16384-byte buffer; convert to PNG and confirm it visually matches an 8× downsample of the input.

---

- [x] **Unit 4: Cloudflare client wrapper — `lib/ai/cloudflare-client.ts`**

**Goal:** A typed-error wrapper around `fetch(WORKER_URL)` that mirrors `lib/ai/groq.ts`'s discipline. Surfaces typed errors that the route can map to HTTP status codes uniformly.

**Requirements:** R4.

**Dependencies:** Unit 2 (worker) and Unit 3 (image processor) both importable.

**Files:**
- Create: `lib/ai/cloudflare-client.ts`
- Test: `lib/ai/__tests__/cloudflare-client.test.ts`

**Approach:**
- `import 'server-only'`.
- Public surface: `generateSkinFromCloudflare(prompt: string, signal: AbortSignal): Promise<{ parsed: AISkinResponse; durationMs: number; modelId: string }>`.
- Read `process.env.CLOUDFLARE_WORKER_URL` and `process.env.CLOUDFLARE_WORKER_TOKEN` at invocation time, never at module load. Surface a shape-only diagnostic for missing/malformed values: `{ workerUrlShape: { present, hostname }, tokenShape: { present } }`. **The token-shape diagnostic emits ONLY `present: boolean` — no `length`, no `prefix`. The URL diagnostic emits `present` plus the parsed `hostname` when present, never the full URL or any URL prefix.** Even partial token information (length, leading characters) is information-leakage on a long-lived static credential. The full diagnostic is logged server-side via `console.error` and is **never** included in the user-facing 500 response body — the body returns `{ error: 'service_misconfigured' }` with no `debug` field. Operators read the diagnostic from server logs only.
- `fetch(workerUrl, { method: 'POST', body: JSON.stringify({ prompt }), headers: { Authorization: ..., Content-Type: 'application/json' }, signal })`.
- Map fetch errors into typed errors:
  - `CloudflareEnvError` — env missing/malformed.
  - `CloudflareAbortedError(streamStarted: boolean)` — `signal.aborted` triggered.
  - `CloudflareTimeoutError` — fetch timed out (uses combined-signal pattern from M16).
  - `CloudflareAuthError` — worker returned 401 (means our token is wrong).
  - `CloudflareRateLimitError(retryAfterSeconds: number)` — worker returned 429 (WAF tripped).
  - `CloudflareUpstreamError(statusCode, body)` — anything else non-2xx.
- On 2xx: `Buffer.from(await res.arrayBuffer())` → call `generateSkinFromImage` from Unit 3 → return parsed.
- No retry logic — the route already has its own retry-once-on-CodecError pattern from M16. We don't double-retry.

**Patterns to follow:**
- `lib/ai/groq.ts::classifySdkError` shape — exhaustive switch, falls through to `upstream` for unknown.
- M11/M16 env-shape diagnostic discipline.

**Test scenarios:**
- Happy path: mocked fetch returns 200 with a real PNG buffer → returns `{ parsed }` matching `AISkinResponse` shape.
- Error path: env missing → throws `CloudflareEnvError` with shape diagnostic.
- Error path: fetch returns 401 → throws `CloudflareAuthError`.
- Error path: fetch returns 429 with `Retry-After: 60` → throws `CloudflareRateLimitError` with `retryAfterSeconds: 60`.
- Error path: fetch returns 500 → throws `CloudflareUpstreamError` with status code + truncated body.
- Error path: fetch returns 200 but body is corrupt PNG → bubbles `ImageProcessingError` from Unit 3.
- Edge case: signal aborted before fetch resolves → throws `CloudflareAbortedError(streamStarted: false)`.
- Edge case: fetch resolves but signal aborts during `arrayBuffer()` read → throws `CloudflareAbortedError(streamStarted: true)`.
- Edge case: env vars present but worker URL has trailing whitespace → throws `CloudflareEnvError` with `prefix` showing the whitespace (operator-debuggable).

**Verification:**
- All tests pass with mocked `fetch`.
- Tests cover all six typed-error paths.

---

- [x] **Unit 5: Route integration — provider switch in `app/api/ai/generate/route.ts`**

**Goal:** Add the env-flag-driven provider switch inside the existing route, mapping new typed errors to the same HTTP status codes M16 already uses. **No changes to auth, rate-limit, kill-switch, logging, or slot-burn policy.**

**Requirements:** R1, R2, R4, R7.

**Dependencies:** Unit 4.

**Files:**
- Modify: `app/api/ai/generate/route.ts` — add `export const maxDuration = 30;` (matching `HARD_TIMEOUT_MS`) so the function does not timeout on Vercel before our own abort fires. Without this the Hobby-tier 10s default would 504 on cold starts.
- Modify: `lib/ai/prompt.ts` — leave Groq pricing in place. **Decision: pass `costEstimate: 0` for the Cloudflare branch in v1.** Per-call Neurons is a constant, so Unit 8's analysis can derive cost from the call count in `todayCloudflareCalls` without a per-row USD field. Saves a function with no real consumer.
- Modify: `lib/firebase/ai-logs.ts` — extend `LogGenerationEntry` with `provider: 'groq' | 'cloudflare'` (required field). Persist on the Firestore write. **This is required for Unit 8's cohort comparison; without it the buckets cannot be queried.** Verify the `/aiGenerations` Firestore index supports `provider`-bucket aggregation queries.
- Modify: `lib/ai/types.ts` — extend the `AIGenerateErrorBody.service_misconfigured.debug` type to a union: `{ envKeyShape?: ...; workerUrlShape?: ...; tokenShape?: ... }`, so both Groq and Cloudflare paths satisfy the declared shape.
- Test: `app/api/ai/generate/__tests__/route.test.ts` — extend the existing tests, do not rewrite them. Add a parallel test pass with `vi.stubEnv('AI_PROVIDER', 'cloudflare')`.

**Log-shape contract (decided here, not at implementation time):**
- `provider: 'groq' | 'cloudflare'` — required, populated for every entry, the bucket key for Unit 8.
- `tokensIn`, `tokensOut`, `totalTokens` — for the Cloudflare branch, write `null` (not `0`). `0` is a real value for "the call ran but consumed nothing" (impossible for Groq); `null` means "not applicable to this provider." Update the `LogGenerationEntry` type.
- `retryCount: 0`, `finishReason: 'stop'` — meaningful for Cloudflare path (no retries; Worker either returns or throws). Keep as `0` and `'stop'` literally.
- `validationFailureCategory` — for Cloudflare path, can be `resize_failed | quantize_failed | rle_failed` from `ImageProcessingError`. Add these literals to the type union alongside the existing Groq codec reasons.
- `costEstimate: 0` for Cloudflare; the actual per-day Neuron count lives on `/aiConfig/global.todayCloudflareCalls`, not per-row.

**Approach:**
- Read `process.env.AI_PROVIDER` (code default: `'groq'`) inside the handler. Operators flip to `'cloudflare'` per Vercel environment after manual smoke.
- Inside the existing `try { ... } catch { ... }` block at the model-call step:
  - `if (provider === 'cloudflare') { result = await generateSkinFromCloudflare(prompt, signal); }`
  - `else { result = await generateSkin(prompt, signal); }` (existing M16 path).
- Wrap the parsed result so both branches yield `{ parsed, retryCount, finishReason, promptTokens, completionTokens, totalTokens }`. Cloudflare branch fills `retryCount: 0`, `finishReason: 'stop'`, token counts as `0`.
- Add a parallel `catch` arm that handles all `Cloudflare*` errors:
  - `CloudflareEnvError` → 500 with `service_misconfigured`, debug shape (parallel to `GroqEnvError`).
  - `CloudflareAuthError` → 500 with `service_misconfigured` (this is *our* config error, not the user's).
  - `CloudflareRateLimitError` → 429 with `Retry-After`.
  - `CloudflareTimeoutError` → 504.
  - `CloudflareAbortedError` → 499 (refund slot iff `!streamStarted`).
  - `CloudflareUpstreamError` → 502.
  - `ImageProcessingError` → 422 with `generation_invalid` (rare; logs a `validationFailureCategory` like `resize_failed`).
- `logGeneration({ ..., model: provider === 'cloudflare' ? 'cf/sdxl-lightning' : MODEL, provider })` so `/aiGenerations` records cohort.
- Skip `bumpAggregateTokens` when `provider === 'cloudflare'`. Replace with `bumpAggregateCloudflareCalls(1)` (Unit 6).

**Patterns to follow:**
- The existing M16 error-mapping cascade. New arms slot in with no restructuring.
- `private no-store` cache header on every response (preserved).
- `combineSignals(req.signal, AbortSignal.timeout(HARD_TIMEOUT_MS))` (preserved).

**Test scenarios:**
- Happy path (Groq): `AI_PROVIDER=groq`, valid prompt → existing behavior unchanged.
- Happy path (Cloudflare): `AI_PROVIDER=cloudflare`, valid prompt → 200 with `{ palette, rows }` matching `AISkinResponse`. `/aiGenerations` log contains `model: 'cf/sdxl-lightning', provider: 'cloudflare'`.
- Happy path: `AI_PROVIDER` unset → defaults to `groq` (the safe code default; operators must explicitly opt into `cloudflare`).
- Edge case: provider switch in `AI_PROVIDER` mid-deploy doesn't break either path.
- Error path: `CLOUDFLARE_WORKER_URL` unset → 500 `{ error: 'service_misconfigured' }` (no `debug` body field). Server log captures `{ workerUrlShape: { present: false } }` for operator review.
- Error path: worker token wrong → 500 `service_misconfigured` (operator gets shape diagnostic, user gets generic).
- Error path: worker WAF returns 429 → 429 propagated with `Retry-After` header.
- Error path: worker returns 500 → 502 `service_unavailable`.
- Error path: client aborts before fetch starts → 499 + slot refund.
- Error path: client aborts after fetch starts but before bytes arrive → 499 + slot refund (`streamStarted: false`).
- Error path: client aborts during `arrayBuffer()` read → 499, slot **burned** (bytes were already in flight).
- Error path: image-processing failure → 422 `generation_invalid` with `validationFailureCategory: 'resize_failed' | 'quantize_failed' | 'rle_failed'`.
- Integration: end-to-end with mocked Worker fetch — auth + rate limit + provider switch + log write all run in correct order.
- Integration: rate-limit slot is burned exactly once per call across both providers.
- Integration: aggregate kill switch trips at threshold for cloudflare path (Unit 6 hooks).

**Verification:**
- Existing M16 tests still pass unchanged (Groq path).
- New Cloudflare-path tests pass.
- Manual smoke test: switch `AI_PROVIDER` between `cloudflare` and `groq` in `.env.local`, hit the route from the editor for each, verify both yield valid skins.

---

- [x] **Unit 6: Aggregate kill switch — track Cloudflare call count**

**Goal:** Add a Cloudflare-aware bump+threshold to the aggregate kill switch in `lib/ai/rate-limit.ts`. Trip at 8,000 calls/day (80% of the 10K Neurons free tier, accounting for SDXL Lightning being cheaper than base SDXL). Keep the existing `todayTokens` pathway intact for the Groq branch.

**Requirements:** R8.

**Dependencies:** Unit 5.

**Files:**
- Modify: `lib/ai/rate-limit.ts`
- Modify: `app/api/ai/generate/route.ts` (call `bumpAggregateCloudflareCalls` instead of `bumpAggregateTokens` on the Cloudflare path)
- Test: `lib/ai/__tests__/rate-limit.test.ts` — extend, do not rewrite.

**Approach:**
- Add `AGGREGATE_CLOUDFLARE_CALL_CAP = 8000` (named, exported, with a comment explaining the 80% / Neurons math).
- Add `bumpAggregateCloudflareCalls(n: number = 1): Promise<void>` — best-effort Firestore increment on `/aiConfig/global.todayCloudflareCalls` (resets daily via `todayDate`).
- Update the aggregate-cost gate in `checkAndIncrement` to read `todayCloudflareCalls` AND `todayTokens` and trip if either threshold is exceeded. Both providers share the same kill switch; flipping `enabled: false` pauses both.
- Keep the existing `AGGREGATE_TOKEN_CAP = 80_000` and `todayTokens` path for the Groq branch — backward compatibility for the rollout window.

**Patterns to follow:**
- `bumpAggregateTokens` is the model.
- Existing transactional read in `checkAndIncrement` — add the additional field read inside the same transaction.

**Test scenarios:**
- Happy path: `bumpAggregateCloudflareCalls(1)` increments the field; reads back the next day with a different `todayDate` reset to 0.
- Happy path: gate allows requests when both thresholds are below cap.
- Edge case: `todayCloudflareCalls = 8000` → next request blocked with `rateGate.reason === 'aggregate'`.
- Edge case: `todayTokens = 80_000, todayCloudflareCalls = 0` → next request blocked (Groq cap still applies).
- Edge case: `enabled: false` on `/aiConfig/global` → blocked regardless of counts.
- Edge case: counter day rollover (UTC midnight) → both counters reset.
- Integration: route writes to `todayCloudflareCalls` only when `provider === 'cloudflare'`, and to `todayTokens` only when `provider === 'groq'`.

**Verification:**
- Tests pass.
- Manual: `gcloud firestore` (or admin console) shows `todayCloudflareCalls` incrementing during local dev with the cloudflare provider.

---

- [x] **Unit 7: Env-var wiring — `.env.local.example`, deployment env, env-shape diagnostics**

**Goal:** Document and configure the new env vars on local + Vercel + Cloudflare. Make missing/malformed env operator-debuggable via shape diagnostics.

**Requirements:** R4, R5.

**Dependencies:** Units 4, 5.

**Files:**
- Modify: `.env.local.example` (add `CLOUDFLARE_WORKER_URL`, `CLOUDFLARE_WORKER_TOKEN`, `AI_PROVIDER` with defaults and one-line comments)
- Modify: `.env.local` (operator action — not committed)
- Modify: `lib/ai/cloudflare-client.ts` (already drafted in Unit 4 — confirm shape diagnostic)
- Create: short section in `workers/README.md` documenting Vercel/CF env-var dance
- Test: covered transitively by Unit 4's env-error test scenarios.

**Approach:**
- `.env.local.example` gets:
  ```
  # Cloudflare AI Worker (M17). Worker URL with no trailing slash.
  CLOUDFLARE_WORKER_URL=https://ai-skin-generator.<your-subdomain>.workers.dev
  # Bearer token shared with the Worker. wrangler secret put SDXL_TOKEN.
  CLOUDFLARE_WORKER_TOKEN=
  # Provider switch. Code default is 'groq' — operators flip per environment
  # to 'cloudflare' after manual smoke. Preview first, production after.
  AI_PROVIDER=groq
  ```
- Vercel: `vercel env add CLOUDFLARE_WORKER_URL production preview development` and the same for the token.
- Verify the env vars show up in `vercel env ls` after the dance.

**Patterns to follow:**
- Existing `.env.local.example` style (single-line comments, no trailing commas).
- M16's env-shape diagnostic pattern for surfacing missing/malformed values in 500s without leaking key material.

**Test scenarios:** *(none new — covered by Unit 4)*

**Verification:**
- `npm run dev` with the env set runs the Cloudflare path end-to-end against the Wrangler-deployed Worker.
- `vercel env pull` then a Vercel preview deploy boots the route without 500.

---

- [ ] **Unit 8: Cohort comparison + Groq deprecation gate**

**Goal:** Run both providers in production for ≥1 week behind the env flag, compare cohort quality in `/aiGenerations`, then either remove `lib/ai/groq.ts` (if Cloudflare wins) or revert (if it doesn't).

**Requirements:** R7, plus the rollout discipline from M16.

**Dependencies:** All prior units shipped. ≥1 week of production traffic.

**Files:**
- (Optional) Delete: `lib/ai/groq.ts`, `lib/ai/prompt.ts` (Groq parts), `lib/ai/__tests__/groq.test.ts`. Or keep as a reverted-but-importable fallback for one more milestone.
- Modify: `app/api/ai/generate/route.ts` to drop the provider switch if Groq is removed.
- Modify: `package.json` to drop `groq-sdk` if removed.
- Modify: this plan with a §Quality Gate Outcome section recording the decision.

**Approach:**
- Pull `/aiGenerations` for the rollout week. Bucket by `provider`. Tally: success rate, abort rate, validation-failure rate, per-call cost, p50/p95 latency, manual quality score on a 20-prompt sample.
- Decision tree:
  - Cloudflare materially better on quality + cost: remove Groq.
  - Cloudflare comparable: keep both behind the flag for one more milestone, defer removal.
  - Cloudflare worse: revert flag default to `groq`, file a follow-up to evaluate Monadical-via-Replicate.

**Execution note:** This is a manual review step, not implementation. The PR for this unit is small (deletions or no-op), but the decision behind it is the deliverable.

**Patterns to follow:**
- M11/M16 retro discipline of writing a §Outcome section before declaring the milestone done.

**Test scenarios:** *(none — review/decision step)*

**Verification:**
- `docs/COMPOUND.md` gets an "M17: Cloudflare AI Skin Generation — YYYY-MM-DD" entry summarizing the outcome.
- If Groq is removed: `/api/ai/generate` deploy is green; smoke test from the editor produces a skin under `cloudflare` provider with no fallback path.

## System-Wide Impact

- **Interaction graph:** Replaces only the Groq-call inside the existing route. `EditorLayout.tsx` and any component reading the response payload sees no breaking change because the `AISkinResponse` shape is preserved. The codec (`lib/ai/skin-codec.ts`) is reused as a black-box validator — no changes.
- **Error propagation:** New Cloudflare typed errors map to the same user-visible status codes as their Groq analogues, so the editor's existing toast/error UI works unchanged. `ImageProcessingError` becomes a 422, sharing the `generation_invalid` envelope.
- **State lifecycle risks:** The slot-burn-vs-refund decision tree from M16 must be preserved exactly: refund only on `aborted-before-stream-started`. **The Cloudflare path uses a coarser `streamStarted` definition than Groq's SDK provided — it cannot detect bytes-in-flight precisely.** The detection rule: `streamStarted = true` once `await fetch(workerUrl, ...)` has *resolved* (response headers received from Cloudflare), regardless of whether `arrayBuffer()` has begun streaming bytes. Implement via a `let fetched = false` flag set immediately after the `fetch` promise resolves. Abort before `fetched=true` → refund. Abort after `fetched=true` → burn. **This is conservative — Cloudflare bills Neurons the moment `env.AI.run()` completes inside the Worker, which happens *before* the response promise resolves on the Vercel side.** A small fraction of legitimate network failures will be mis-burned (the Worker billed but Vercel never saw a response); this is the price of bounding Neuron drain by aborting attackers. The slot economy and the Neuron economy diverge on the Cloudflare path; we protect the Neuron economy.
- **API surface parity:** `/api/ai/generate` request body is unchanged (`{ prompt }`), response body is unchanged (`{ palette, rows }`), error envelope is unchanged. No client-side changes needed.
- **Integration coverage:** Two cross-layer scenarios that mocks alone won't prove and need a real run: (a) sharp's native binary loads on Vercel's serverless runtime without cold-start failure; (b) the Cloudflare Worker's actual SDXL-Lightning output passes our `validateResponse` after the full pipeline. Both are covered by the Unit 1 spike + Unit 5 manual smoke + Unit 8 cohort review.
- **Unchanged invariants:** `lib/ai/skin-codec.ts`, `lib/ai/types.ts` (shape seam), `lib/ai/rate-limit.ts`'s three-bucket transaction, `lib/firebase/ai-logs.ts`'s 90-day TTL + no-ipHash discipline, `runtime = 'nodejs'` on the route, `dynamic = 'force-dynamic'`. None of these change in M17. New work integrates around them.
- **Bundle hygiene:** `sharp` and `image-q` are server-only via the dynamic-import + `import 'server-only'` pattern. `/editor` client bundle stays at the M16 baseline (492 kB) — verify post-build with chunk inspection.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stock SDXL produces character images, not skin atlases — naive 64×64 downscale looks broken on the 3D model | **High** | High | Unit 1 quality spike *gates* the rest of the work. If the gate fails, do not proceed; reopen architecture decision (Monadical via Replicate, or Tier-B template compositing). |
| Cloudflare free-tier exhaustion (10K Neurons/day cliff) | Medium | Medium | Aggregate kill switch trips at 8,000 calls (Unit 6). Per-uid 30/day cap from M16 already in place. WAF rate limit on the Worker (Unit 2) bounds anonymous-discovery abuse. |
| Worker URL discovered by anonymous attacker → free SDXL drained | Medium | Medium | Bearer-token auth in Worker (Unit 2). Token rotation documented in `workers/README.md`. WAF rule as second layer. |
| `sharp` cold-start on Vercel slow / fails to load | Low | High | Sharp is in Next 15's default `serverExternalPackages` allowlist; Vercel ships the prebuilt linux-x64. Fluid Compute amortizes cold-start. Unit 1 spike runs locally, but Unit 5 manual smoke runs against a real Vercel preview. |
| `image-q` quantization produces washed-out or noisy palettes for SDXL output | Medium | Medium | Deferred-to-implementation: try RGBQuant + CIEDE2000 first; switch to NeuQuant or WuQuant if visual quality degrades. Unit 3 includes a "noise image" test scenario. |
| Worker ↔ Vercel network failure during fetch | Low | Low | Existing M16 timeout (`HARD_TIMEOUT_MS = 30s`) and abort-signal plumbing covers this. Maps to `CloudflareTimeoutError` → 504. |
| SDXL emits unsafe content (no built-in safety filter) | Low (narrow prompt domain) | Medium | Existing prompt validation (length cap, NFKC, `FORBIDDEN_CHARS` regex) is a partial defense. Per-uid rate limits bound abuse blast radius. Adding a real safety classifier is explicitly out of scope; revisit if abuse is observed. |
| Removing `lib/ai/groq.ts` too early breaks fallback | Medium | High | Keep it on disk for ≥1 week of cohort review (Unit 8). Provider switch via `AI_PROVIDER` env makes rollback a Vercel env change, not a redeploy. |
| Alpha discarded → second-skin overlay regions render as opaque blocks on the 3D player model (resolved by `ensureAlpha()` in Unit 3) | n/a | n/a | **Resolved in Unit 3 design**: pipeline uses `.ensureAlpha()`, image-q is alpha-aware, palette emits `#rrggbbaa` when alpha < 0xFF. Verified via the alpha-region test scenario in Unit 3. |
| Cost-estimate field in `/aiGenerations` becomes meaningless for Cloudflare path | n/a | n/a | **Resolved in Unit 5 design**: pass `costEstimate: 0` for the Cloudflare branch. Per-day Neuron count lives on `/aiConfig/global.todayCloudflareCalls`. |
| Cloudflare deprecates `@cf/bytedance/stable-diffusion-xl-lightning` or repricing changes per-call Neurons mid-rollout | Low | High | Pin the model name in a single Worker-side constant. Unit 1 spike measures actual Neurons/call (not the documentation estimate) and locks the kill-switch threshold to that. Worker returns 410-mapped `CloudflareUpstreamError` if the model 404s; route falls back to Groq via `AI_PROVIDER` env (operator action). |
| Vercel runtime/Next.js minor upgrade breaks sharp's prebuilt linux-x64 binary | Low | High | Pin `sharp` to an exact minor version in `package.json` (not `^0.33`). Add a CI smoke test that runs the cloudflare path against a Vercel preview on every PR before merging. Keep `lib/ai/groq.ts` on disk as the env-flag rollback target until Vercel/sharp interaction is observed-stable across one deploy cycle. |
| Bearer token leaks via Vercel build logs, error reports, or third-party observability tooling capturing Authorization headers | Medium | High | (a) Audit Vercel log-redaction config to confirm Authorization headers are stripped. (b) Set token rotation cadence at 90 days minimum; rotate immediately on any incident. (c) Support dual-token validation in the Worker (`SDXL_TOKEN` and optional `SDXL_TOKEN_PREVIOUS`) for zero-downtime rotation. (d) Configure a Cloudflare account-level Neuron spending cap as a hard ceiling backstop. |
| WAF rate-limit at 10 req/min/IP trips on legitimate Vercel-egress IP traffic (all calls share a small pool of egress IPs) → self-DoS | Medium | Medium | Raise the WAF threshold to 60 req/min/IP (or higher) — the per-uid 30/day cap is the real abuse defense. The WAF rule's job is to bound a token-leak abuse scenario, not to throttle legitimate traffic. Validate the chosen threshold against observed dev traffic before promotion to production. |

## Documentation / Operational Notes

- **`workers/README.md`** documents: deploy steps (`wrangler deploy`), secret rotation (`wrangler secret put SDXL_TOKEN`), WAF rule configuration, troubleshooting (401 vs 429 vs 502 mapping), local dev with `wrangler dev`.
- **`docs/COMPOUND.md`** gets an M17 entry after Unit 8: invariants, gotchas, decisions made under uncertainty.
- **Operator runbook:**
  - Kill-switch trip: Firestore admin console → `/aiConfig/global` → `enabled: false`. Both providers pause within seconds (next handler invocation reads it transactionally).
  - Provider rollback: Vercel dashboard → env vars → `AI_PROVIDER=groq` → redeploy or wait for next request (depends on Vercel env-cache).
  - Token rotation (planned cadence: 90 days minimum, immediate on any incident): the Worker should accept either `SDXL_TOKEN` or an optional `SDXL_TOKEN_PREVIOUS` (set both during rotation, then drop the previous). Procedure: `wrangler secret put SDXL_TOKEN` (new value) → update `CLOUDFLARE_WORKER_TOKEN` in Vercel env → confirm propagation across all Vercel environments → `wrangler secret delete SDXL_TOKEN_PREVIOUS`. Zero-downtime. Without dual-token support there is a brief mismatched-token window during which user requests 500.
- **Monitoring:** `/aiGenerations` is the cohort-comparison source. Add a saved query or short SQL/Firestore-aggregation script to bucket by `provider` weekly.
- **Rollout plan:**
  1. Unit 1 spike → GO/NO-GO gate. (~1 hour)
  2. Units 2–7 land in a single PR sequence over a few hours.
  3. Code merges with `AI_PROVIDER=groq` as the default (Groq path active in production).
  4. Operator flips Vercel preview env to `AI_PROVIDER=cloudflare` and smokes 5 prompts manually against preview.
  5. Operator flips Vercel production env to `AI_PROVIDER=cloudflare`. Monitor `/aiGenerations` for the first 24h.
  6. After ≥1 week and ≥100 cloudflare-path generations, run Unit 8 cohort review.

## Sources & References

- **Origin document:** [M17-CLOUDFLARE.md](../../M17-CLOUDFLARE.md) — Initial draft. Several premises corrected during planning research (free-tier figure, resampling kernel, quantization approach, base64 transport, route-replacement scope).
- **M16 plan:** [docs/plans/m16-ai-skin-generation-plan.md](m16-ai-skin-generation-plan.md) — The route envelope this plan preserves.
- **M16 retro:** [docs/COMPOUND.md](../COMPOUND.md) lines 879–983 — Auth/rate-limit/log discipline.
- **M11 retro:** [docs/COMPOUND.md](../COMPOUND.md) lines 789–877 — Bundle hygiene and image-pipeline lessons.
- Cloudflare Workers AI — [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [SDXL Lightning model card](https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-lightning/), [SDXL Base model card](https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-base-1.0/).
- Sharp — [`.png()` palette mode](https://sharp.pixelplumbing.com/api-output/#png), [`.resize()` kernels](https://sharp.pixelplumbing.com/api-resize/), [install / serverless](https://sharp.pixelplumbing.com/install/).
- Next.js 15 — [`serverExternalPackages`](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).
- `image-q` — [npm](https://www.npmjs.com/package/image-q) · [docs](https://ibezkrovnyi.github.io/image-quantization/).
- Atlas-vs-character risk references — [Monadical Labs `minecraft-skin-generator-sdxl`](https://huggingface.co/monadical-labs/minecraft-skin-generator-sdxl), [Monadical methodology post](https://monadical.com/posts/minecraft-skins-part2.html).

## Quality Gate Outcome

*(Filled in by Unit 1.)*

> Pending — populated after the spike. Format:
> - **Date:** YYYY-MM-DD
> - **Prompts attempted:** N (list)
> - **Bar 1 (loads in editor):** X/N
> - **Bar 2 (head/face matches prompt):** X/N
> - **Bar 3 (body coherent, not melted):** X/N
> - **Decision:** PROCEED with Units 2–8 / PIVOT to Monadical-via-Replicate / PIVOT to Tier-B template compositing
> - **Rationale:** *(one paragraph)*
