# M14: Share Metadata — Planning Prompt for Claude Code

**Use this prompt with Claude Code's `/ce:plan` command.**

---

## Planning Context

You are planning M14 (Share Metadata) for Threditor, a Minecraft skin editor.

**Current state:**
- M13 complete: Profile pages, 3D previews, gallery working
- Skin detail page exists at `/skin/[skinId]/page.tsx`
- Basic meta tags present, but OG images missing
- Need to enhance for optimal social sharing

**Goal:**
Create a detailed implementation plan for M14 that enhances social sharing capabilities.

---

## Planning Instructions

Use the Compound Engineering `/ce:plan` methodology to produce a comprehensive technical plan.

### Research Phase

**Read these files to understand current state:**

1. **Current skin detail page:**
   - `/Users/ryan/Documents/threditor/app/skin/[skinId]/page.tsx`
   - Check what meta tags already exist
   - Identify what's missing for social sharing

2. **DESIGN.md context:**
   - `/mnt/project/DESIGN.md`
   - Section 12.6: Phase 2 milestones (M14 description)
   - Section 11: Phase 2 Firebase implementation (OG image generation)

3. **COMPOUND.md learnings:**
   - `/Users/ryan/Documents/threditor/docs/solutions/COMPOUND.md`
   - M11 section: OG image generation (client-side three.js)
   - M13 section: SSR patterns, meta tag implementation

4. **Existing OG generation code:**
   - `/Users/ryan/Documents/threditor/lib/editor/og-image.ts` (if exists)
   - Check if OG generation already implemented from M11

5. **Firestore schema:**
   - `/Users/ryan/Documents/threditor/lib/firebase/types.ts`
   - Check if `SharedSkin` has `ogImageUrl` field

### Questions to Answer

**Before creating the plan, research and answer:**

1. **What meta tags currently exist on `/skin/[skinId]`?**
   - Does it have OG tags?
   - Does it have Twitter cards?
   - Does it have JSON-LD structured data?

2. **Is OG image generation already implemented?**
   - Check if M11 publish flow generates OG images
   - Check if Firestore has `ogImageUrl` field populated
   - Check Supabase Storage for `-og.webp` files

3. **What's the current `generateMetadata()` implementation?**
   - Does it use the OG image if available?
   - Does it fall back gracefully if missing?

4. **What social platforms should we optimize for?**
   - Twitter/X (Twitter cards)
   - Facebook/LinkedIn (Open Graph)
   - Discord (embeds)
   - Slack (unfurls)

5. **What testing tools are available?**
   - How do we validate OG tags work?
   - Can we test social previews locally?

### Scope Definition

**M14 should include:**

1. **Enhanced Meta Tags:**
   - Complete Open Graph protocol
   - Twitter Card tags
   - JSON-LD structured data for SEO
   - Canonical URLs
   - Mobile meta tags

2. **OG Image Optimization:**
   - Verify OG images exist (from M11)
   - Fallback to thumbnail if OG missing
   - Optimize OG image dimensions (1200×630)
   - Test OG images display correctly

3. **Social Preview Testing:**
   - Document how to test OG tags
   - List validation tools (Twitter Card Validator, etc.)
   - Create test skins with various content types

4. **Share Functionality:**
   - "Share" button with platform-specific links
   - Copy-to-clipboard for URL
   - Native Web Share API (mobile)

5. **SEO Enhancements:**
   - Structured data (Skin as CreativeWork)
   - Breadcrumbs
   - Image sitemaps (future consideration)

**Out of scope for M14:**
- Social login (already in M10)
- Social sharing analytics
- Social media posting API integration
- Share count tracking

### Technical Decisions to Make

**The plan should address:**

1. **Meta Tag Generation:**
   - Where to generate meta tags? (generateMetadata in page.tsx)
   - How to handle missing data gracefully?
   - Should we cache meta tags? (SSR handles this)

2. **Share Button Implementation:**
   - Client component or server component?
   - Which platforms to include? (Twitter, Facebook, Reddit, Discord, Copy Link)
   - How to handle URL encoding?

3. **Testing Strategy:**
   - Manual testing with social media validators
   - Automated tests for meta tag presence
   - Visual regression tests for OG images

4. **Fallback Strategy:**
   - What if skin has no OG image? (use thumbnail)
   - What if skin is deleted? (404 page with meta tags)
   - What if user is private? (not applicable yet, all skins public)

### Implementation Plan Structure

**Produce a plan with these sections:**

1. **Executive Summary** (2-3 paragraphs)
   - What M14 adds
   - Why it matters (social virality, SEO)
   - Key technical approach

2. **Prerequisites Verification**
   - Files that must exist from M11/M13
   - Firestore schema requirements
   - Supabase Storage requirements

3. **Technical Architecture**
   - Meta tag generation flow
   - Share button component design
   - OG image fallback logic

4. **Implementation Units** (breakdown into 6-8 units)
   - Unit 0: Research current state
   - Unit 1: Enhanced meta tags
   - Unit 2: Share button component
   - Unit 3: Social platform links
   - Unit 4: Testing infrastructure
   - Unit 5: Documentation
   - (Additional units as needed)

5. **Meta Tag Schema**
   - Complete list of all meta tags to add
   - Example for a sample skin
   - Validation checklist

6. **Share Button Spec**
   - Component API
   - Platform configurations
   - Mobile/desktop variations

7. **Edge Cases & Gotchas**
   - Missing OG images
   - Deleted skins
   - Very long skin names
   - Special characters in names/tags

8. **Testing Strategy**
   - Unit tests (meta tag generation)
   - Integration tests (share button)
   - Manual testing steps
   - Validation tools

9. **Performance Targets**
   - Page load time with meta tags
   - Share button responsiveness
   - OG image load time

10. **Success Criteria**
    - Twitter preview looks correct
    - Facebook preview looks correct
    - Discord embed looks correct
    - Copy link works
    - All tests pass

11. **Timeline Estimate**
    - Per-unit time estimates
    - Total estimated hours
    - Comparison to DESIGN.md estimate (4-6h)

12. **Rollout Plan**
    - How to test in production
    - How to verify social previews
    - Rollback plan if needed

### Output Format

**Produce a markdown document:**

```
# M14: Share Metadata — Implementation Plan

[Executive Summary]

[Prerequisites Verification]

[Technical Architecture]

[Implementation Units]
  Unit 0: ...
  Unit 1: ...
  (etc)

[Meta Tag Schema]

[Share Button Spec]

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
- M11 COMPOUND notes on OG image generation
- M13 COMPOUND notes on SSR + meta tags
- M12 COMPOUND notes on ISR caching

**Document new patterns:**
- Meta tag generation best practices
- Social sharing button patterns
- OG image fallback strategies

---

## Execution Command Template

**At the end of the plan, include:**

```
## Execution Command

For Claude Code:

```
Execute M14 (Share Metadata) using Compound Engineering methodology.

PLAN: /Users/ryan/Documents/threditor/docs/solutions/m14-share-metadata-plan.md
COMPOUND: /Users/ryan/Documents/threditor/docs/solutions/COMPOUND.md

Implement [N] units. Create PR titled "M14: Share Metadata & Social Previews".
```
```

---

## Special Considerations

**DESIGN.md Constraints:**
- Zero infrastructure cost (Vercel Hobby + Firebase Spark)
- OG images already generated in M11 (verify)
- SSR pattern from M13 (meta tags in generateMetadata)

**Known from COMPOUND.md:**
- OG image generation is client-side (M11)
- Three.js disposal checklist applies
- 1200×630 WebP @ 0.85 quality
- Three-point lighting setup

**Testing Tools:**
- Twitter Card Validator: https://cards-dev.twitter.com/validator
- Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/
- LinkedIn Post Inspector: https://www.linkedin.com/post-inspector/
- Discord embed: Send link in Discord DM to test
- Meta Tags validator: https://metatags.io/

---

## Research Checklist

**Before writing the plan, confirm:**

- [ ] Read current `/skin/[skinId]/page.tsx`
- [ ] Check Firestore `SharedSkin` schema
- [ ] Verify OG images exist in Supabase
- [ ] Review M11 OG generation code
- [ ] Check M13 meta tag patterns
- [ ] List all social platforms to support
- [ ] Identify testing tools
- [ ] Review DESIGN.md M14 section
- [ ] Review COMPOUND.md M11 + M13 sections

---

*End of planning prompt. Use with `/ce:plan` in Claude Code.*
