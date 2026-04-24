# M15: HD Skins — Planning Prompt for Claude Code

**Use this prompt with Claude Code's `/ce:plan` command.**

---

## Planning Context

You are planning M15 (HD Skins) for Threditor, a Minecraft skin editor.

**Current state:**
- Phase 2 complete: M14 shipped (share metadata + social previews)
- 849 tests passing, 29,200 LOC, 124 TypeScript files
- Current editor supports 64×64 skins only (Classic + Slim variants)
- Storage: Supabase free tier (1 GB total)
- Hosting: Vercel Hobby (100 GB/month bandwidth)

**Goal:**
Plan Phase 3.0's first feature: HD skin support (128×128, 256×256, 512×512) as a premium unlock that drives Pro tier revenue.

---

## Planning Instructions

Use the Compound Engineering `/ce:plan` methodology to produce a comprehensive technical plan.

### Research Phase

**Read these files to understand current architecture:**

1. **Current editor canvas:**
   - `/Users/ryan/Documents/threditor/lib/editor/texture.ts` — TextureManager (64×64 hardcoded)
   - `/Users/ryan/Documents/threditor/lib/editor/types.ts` — Core data types
   - Check: Where is 64 hardcoded? Canvas size, UV coordinates, island maps?

2. **Current three.js rendering:**
   - `/Users/ryan/Documents/threditor/lib/three/PlayerModel.tsx` — 3D model
   - `/Users/ryan/Documents/threditor/lib/three/geometry.ts` — UV mappings
   - Check: Do UV coordinates scale automatically or need recalculation?

3. **Storage patterns:**
   - `/Users/ryan/Documents/threditor/lib/supabase/storage-server.ts` — Upload logic
   - Check: Current size limits (100 KB PNG cap), upload paths
   - Estimate: 512×512 PNG file sizes

4. **Firestore schema:**
   - `/Users/ryan/Documents/threditor/lib/firebase/types.ts` — SharedSkin type
   - Check: Is there a `resolution` field or variant-specific storage?

5. **Phase 3 exploration:**
   - `/Users/ryan/Documents/threditor/docs/phase-3-features-exploration.md`
   - Section on HD Skins (technical challenges, schema changes)

6. **COMPOUND learnings:**
   - `/Users/ryan/Documents/threditor/docs/solutions/COMPOUND.md`
   - M11: OG generation, texture disposal patterns
   - M12: Thumbnail generation, canvas rendering
   - Any memory/GPU constraints discovered

### Questions to Answer

**Before creating the plan, research and answer:**

1. **Where is 64×64 hardcoded in the codebase?**
   - Canvas width/height
   - Texture width/height
   - UV coordinate calculations
   - Island map dimensions
   - Export PNG logic

2. **What's the upgrade path?**
   - Does user select resolution at editor init?
   - Can resolution change mid-edit?
   - How do existing 64×64 skins migrate?

3. **What are the GPU/memory constraints?**
   - M11 COMPOUND: three.js disposal patterns
   - At what resolution does canvas rendering slow down?
   - Does R3F handle 512×512 textures without lag?

4. **What's the storage impact?**
   - Current: 64×64 PNG ~1-2 KB
   - 128×128 PNG: ~4-8 KB (estimated)
   - 256×256 PNG: ~15-30 KB (estimated)
   - 512×512 PNG: ~50-100 KB (estimated)
   - Impact on Supabase 1 GB free tier?

5. **What's the Pro tier unlock mechanism?**
   - Free tier: 64×64 only
   - Pro tier ($5/mo): unlock HD resolutions
   - How to check Pro status? (Firebase custom claims? Firestore field?)
   - Where to enforce the gate? (client, API, or both?)

6. **What about OG images and thumbnails?**
   - M11 generates 1200×630 OG images
   - M12 generates 128×128 thumbnails
   - Do HD skins need larger OG/thumbnails?
   - GPU cost of rendering 512×512 → 1200×630 OG?

7. **Backward compatibility?**
   - Existing 64×64 skins in Firestore
   - Can they be viewed/edited at higher resolutions?
   - Upscaling strategy (nearest-neighbor? bilinear?)

### Scope Definition

**M15 should include:**

1. **Resolution Selector:**
   - UI: Dropdown or radio buttons at editor init
   - Options: 64×64 (free), 128×128 (Pro), 256×256 (Pro), 512×512 (Pro)
   - Gate: Check auth + Pro status before allowing HD selection

2. **Dynamic Canvas System:**
   - Replace hardcoded 64 with `resolution` state variable
   - Scale UV coordinates, island maps, brush sizes
   - Maintain pixel-perfect rendering at all resolutions

3. **Storage Schema Updates:**
   - Add `resolution` field to `SharedSkin` Firestore type
   - Update upload paths to handle larger files
   - Adjust size limits (100 KB → 200 KB for 512×512)

4. **Pro Tier Infrastructure:**
   - Firestore: Add `isPro` boolean to `UserProfile`
   - Auth: Create `/api/subscription/status` route
   - UI: Pro badge, upgrade CTA for free users

5. **Performance Optimizations:**
   - Lazy-load HD editor (code-split 512×512 paths)
   - Progressive rendering for large canvases
   - Debounce texture updates at higher resolutions

6. **Export & Preview:**
   - Export PNG at native resolution (no downscaling)
   - Gallery: Always preview at 128×128 (existing thumbnail system)
   - Detail page: Show resolution badge ("512×512 HD")

**Out of scope for M15:**
- Stripe integration (mock Pro status in M15)
- Actual payment processing (Phase 3.1)
- HD-specific templates (use existing 64×64 templates, upscaled)
- Animation editor (Phase 3.1)
- Real-time collaboration (Phase 3.2)

### Technical Decisions to Make

**The plan should address:**

1. **Resolution State Management:**
   - Where does `resolution` live? (Zustand store? React Context?)
   - Can it change after editor loads? (probably NO — reload required)
   - How to pass to TextureManager, PlayerModel, tools?

2. **Island Map Scaling:**
   - Current: Pre-computed Uint8Array at 64×64
   - HD: Dynamically generate at 128/256/512?
   - Or: Pre-compute all 4 resolutions at build time?

3. **UV Coordinate Scaling:**
   - three.js UVs are 0–1 (resolution-independent)
   - Raycasts return UV → multiply by resolution to get pixel
   - Do geometry.ts UV mappings need updates?

4. **Performance Testing:**
   - What's the slowest operation at 512×512?
   - Canvas `putImageData` at 60fps?
   - Three.js texture upload?
   - Bucket fill on 512×512 canvas?

5. **Pro Status Mock:**
   - For M15 testing: Add `?pro=true` query param override
   - For M16+: Real Firestore `isPro` field + Stripe webhook
   - How to surface Pro status in UI? (header badge? settings page?)

6. **Migration Strategy:**
   - Existing 64×64 skins: Add `resolution: 64` retroactively
   - Can users "upgrade" existing skins to HD? (out of scope for M15)
   - Gallery: Filter by resolution? (deferred to M16)

### Implementation Plan Structure

**Produce a plan with these sections:**

1. **Executive Summary** (2-3 paragraphs)
   - What M15 adds (HD skin support)
   - Why it matters (Pro tier unlock, revenue)
   - Key technical approach (dynamic resolution state)

2. **Prerequisites Verification**
   - Files that must exist from M1–M14
   - GPU/memory constraints from COMPOUND.md
   - Storage quota calculations

3. **Technical Architecture**
   - Resolution state flow (init → render → export)
   - Pro tier gate mechanism
   - Scaling algorithms (canvas, UVs, island maps)

4. **Implementation Units** (breakdown into 6-10 units)
   - Unit 0: Research current hardcoded 64s
   - Unit 1: Resolution state + Zustand integration
   - Unit 2: Dynamic TextureManager
   - Unit 3: Scaled island maps
   - Unit 4: Resolution selector UI + Pro gate
   - Unit 5: Storage schema updates
   - Unit 6: Export at native resolution
   - Unit 7: Performance testing + optimizations
   - Unit 8: Documentation + COMPOUND update

5. **Data Schema Changes**
   - SharedSkin Firestore updates
   - UserProfile Pro status field
   - Storage path conventions

6. **Pro Tier Mock Spec**
   - Query param override for testing
   - UI: Pro badge component
   - Upgrade CTA modal

7. **Edge Cases & Gotchas**
   - GPU memory at 512×512
   - Storage quota exhaustion
   - Upscaling 64×64 → 512×512
   - Export file size limits

8. **Testing Strategy**
   - Unit tests (resolution scaling math)
   - Integration tests (64→128→256→512)
   - Performance benchmarks (canvas ops, GPU)
   - Manual testing (all 4 resolutions)

9. **Performance Targets**
   - Canvas rendering: 60fps at 512×512
   - Texture upload: <16ms at 512×512
   - Memory: <50 MB heap at 512×512
   - Bucket fill: <100ms at 512×512

10. **Success Criteria**
    - All 4 resolutions render correctly
    - Pro gate blocks HD for free users
    - Export PNG at native resolution
    - All tests pass
    - No GPU memory leaks

11. **Timeline Estimate**
    - Per-unit time estimates
    - Total estimated hours
    - Comparison to Phase 3 exploration estimate (4-6h)

12. **Rollout Plan**
    - Feature flag for HD toggle
    - Phased rollout (64→128→256→512)
    - Monitoring Supabase storage usage

### Output Format

**Produce a markdown document:**

```
# M15: HD Skins — Implementation Plan

[Executive Summary]

[Prerequisites Verification]

[Technical Architecture]

[Implementation Units]
  Unit 0: ...
  Unit 1: ...
  (etc)

[Data Schema Changes]

[Pro Tier Mock Spec]

[Edge Cases & Gotchas]

[Testing Strategy]

[Performance Targets]

[Success Criteria]

[Timeline Estimate]

[Rollout Plan]

[Execution Command]
```

### Compound Engineering Integration

**Reference prior learnings:**
- M2: PlayerModel three.js setup
- M3: Canvas pixel-perfect rendering
- M5: Island-aware flood fill
- M11: OG generation + GPU disposal
- M12: Thumbnail generation performance
- M14: Meta tag tier fallback system

**Document new patterns:**
- Dynamic resolution state management
- GPU memory scaling laws
- Pro tier feature gating
- Canvas performance at high resolutions

---

## Execution Command Template

**At the end of the plan, include:**

```
## Execution Command

For Claude Code:

```
Execute M15 (HD Skins) using Compound Engineering methodology.

PLAN: /Users/ryan/Documents/threditor/docs/solutions/m15-hd-skins-plan.md
COMPOUND: /Users/ryan/Documents/threditor/docs/solutions/COMPOUND.md

Implement all units. Create PR titled "M15: HD Skin Support (128×128, 256×256, 512×512)".

TESTING REQUIREMENTS:
- Unit tests for resolution scaling math
- Integration tests for all 4 resolutions
- Performance benchmarks at 512×512
- GPU memory leak checks

SUCCESS CRITERIA:
- All 4 resolutions render correctly
- Pro gate functional (mock mode)
- Export at native resolution
- 60fps at 512×512
- All tests pass (target: 849 → 890+)
```
```

---

## Special Considerations

**DESIGN.md Constraints:**
- Zero infrastructure cost (Vercel Hobby + Firebase Spark until Blaze migration)
- HD skins are Pro feature ($5/mo) — not free tier
- Storage: 1 GB Supabase limit (estimate impact)

**Known from COMPOUND.md:**
- M11: three.js disposal checklist mandatory
- M12: Canvas ops at 64×64 are <10ms, scale quadratically
- M3: `imageSmoothingEnabled: false` required for pixel art
- M5: Island maps are Uint8Array, one per variant

**Performance Targets:**
- 64×64: 60fps baseline (proven in M1-M8)
- 128×128: 60fps (4× pixels, expect 4× render time)
- 256×256: 30-60fps (16× pixels, may need optimizations)
- 512×512: 30fps minimum (64× pixels, likely needs debouncing)

**Storage Math:**
- 1 GB Supabase / 50 KB per 512×512 skin = 20,000 HD skins max
- At 10 Pro users, each publishing 10 HD skins/month = 100 skins/month
- Runway: 200 months (16+ years) before hitting ceiling
- **Not a binding constraint for M15**

---

## Research Checklist

**Before writing the plan, confirm:**

- [ ] Read `/lib/editor/texture.ts` — identify all hardcoded 64s
- [ ] Read `/lib/editor/types.ts` — understand Layer pixel array sizing
- [ ] Read `/lib/three/PlayerModel.tsx` — check UV coordinate handling
- [ ] Read `/lib/editor/uv-map.ts` — check island map generation
- [ ] Read M11 COMPOUND section — GPU disposal patterns
- [ ] Read M12 COMPOUND section — canvas performance at 64×64
- [ ] Estimate 512×512 PNG file sizes (create test, measure)
- [ ] Check current Supabase usage (how many GB used so far?)
- [ ] Review Phase 3 exploration HD Skins section
- [ ] List all locations where 64 is hardcoded (grep the codebase)

---

## Key Questions for the Plan

**The plan MUST answer:**

1. **How many places hardcode 64?** (grep results)
2. **What's the resolution state flow?** (init → edit → export)
3. **How do island maps scale?** (pre-compute or dynamic?)
4. **What's the GPU memory curve?** (64→128→256→512)
5. **How to mock Pro status?** (query param? localStorage?)
6. **What's the storage impact?** (GB used, runway estimate)
7. **Where's the performance bottleneck?** (canvas? GPU? flood fill?)
8. **How to prevent free users accessing HD?** (UI gate + API gate)
9. **What's the migration path?** (existing 64×64 skins)
10. **What's the rollout strategy?** (feature flag? phased?)

---

## Expected Plan Deliverables

1. **Complete grep of hardcoded 64s** (with file:line references)
2. **Resolution state diagram** (showing Zustand flow)
3. **Performance benchmark table** (64/128/256/512 comparison)
4. **Storage impact calculation** (GB per 1000 skins at each resolution)
5. **Pro gate mockup** (wireframe of UI + API flow)
6. **8-10 implementation units** (with test scenarios per unit)
7. **Timeline estimate** (compare to 4-6h Phase 3 estimate)
8. **Success criteria checklist** (must all pass before merge)

---

## Risk Areas to Address

**The plan should explicitly mitigate:**

1. **GPU memory leaks** — M11 disposal patterns apply, but 64× larger textures
2. **Canvas performance degradation** — putImageData scales O(n²) with resolution
3. **Storage quota exhaustion** — 1 GB ceiling, need monitoring
4. **Free user circumvention** — client-side gate alone insufficient
5. **Existing skin compatibility** — 64×64 skins must still work
6. **OG image generation cost** — 512×512 texture → 1200×630 OG may be slow
7. **Export file size** — 512×512 PNG may exceed 100 KB, need to raise limit

---

## Success Signals

**M15 is ready for `/ce:work` when the plan has:**

- ✅ Complete hardcoded-64 audit (file:line list)
- ✅ Clear resolution state architecture
- ✅ Performance targets for each resolution
- ✅ Storage impact math with safety margin
- ✅ Pro tier mock specification
- ✅ 8-10 units with test scenarios
- ✅ Edge case documentation
- ✅ 4-6 hour timeline estimate
- ✅ Rollout plan with feature flag

---

*End of planning prompt. Use with `/ce:plan` in Claude Code.*
