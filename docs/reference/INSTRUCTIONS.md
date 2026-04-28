# Combined Implementation Instructions for Claude Code

## Overview
This document contains comprehensive instructions for implementing two major features:
1. **M17 Two-Stage AI Pipeline** - Fix AI skin generation quality
2. **Production Landing Page** - Replace minimal landing with full design

## Reference Files
- `landing.html` - Full HTML reference from design system
- Design system extracted at: `/tmp/threditor-design-system/project/`

---

# Task 1: Implement M17 Two-Stage AI Pipeline Architecture

**Context:** The current AI skin generation creates generic PNG images instead of proper Minecraft skins because the single-stage approach (direct prompt → Cloudflare SDXL) doesn't understand UV mapping.

**Required Changes:**

## 1. New File: `lib/ai/groq-interpreter.ts`
Create a new Groq-based interpreter that:
- Takes user prompt (e.g., "knight in red armor crying")
- Breaks it down into structured JSON with part-by-part descriptions
- Uses Llama 3.3 70B with `response_format: json_object`
- Returns `SkinPartDescriptions` type with head, torso, arms, legs, variant

**System prompt for Groq:**
```
You are a Minecraft skin designer AI. Break down user descriptions into detailed, part-by-part visual descriptions for a 64×64 Minecraft skin.

CRITICAL RULES:
1. Output ONLY valid JSON, no preamble, no markdown
2. Each body part gets detailed visual description
3. Be specific about colors, textures, materials
4. Determine if classic (4px arms) or slim (3px arms) variant fits better
5. Overlay layers are optional for helmets, capes, etc.
```

## 2. Update: `lib/ai/types.ts`
Add new type:
```typescript
export type SkinPartDescriptions = {
  head: string;
  headOverlay?: string;
  torso: string;
  torsoOverlay?: string;
  rightArm: string;
  leftArm: string;
  rightLeg: string;
  leftLeg: string;
  variant: 'classic' | 'slim';
};
```

## 3. Modify: `lib/ai/cloudflare-client.ts`
- Change from single prompt to structured regions
- Accept `SkinPartDescriptions` instead of plain string
- Generate each body part with correct UV coordinates

## 4. Modify: `app/api/ai/generate/route.ts`
Implement two-stage pipeline:
```typescript
// Stage 1: Groq interpretation
const parts = await interpretPromptToSkinParts(prompt, signal);

// Stage 2: Cloudflare rendering
const result = await generateSkinFromParts(parts, signal);
```

## 5. Update Cloudflare Worker
Worker needs to:
- Accept structured JSON with regions array
- Generate each part separately at correct UV coordinates
- Composite into 64×64 final texture

**Testing Requirements:**
- Unit tests for Groq JSON parsing/validation
- Integration tests for end-to-end pipeline
- Visual regression tests for UV correctness
- Cost tracking (<$0.01 per generation)

---

# Task 2: Implement Landing Page from Design System

**Context:** Replace the current minimal landing page with the production-ready design from the Threditor design system.

**Reference:** See `/tmp/threditor-design-system/project/landing.html` for complete implementation

## Files to Create:

### 1. `app/_components/LandingHeader.tsx` (Client Component)
- Sticky header with blur backdrop
- Wordmark with hover effect
- Top navigation links (Features, Demo, Contact)
- Primary CTA button to /editor

### 2. `app/_components/LandingHero.tsx` (Client Component)
- Two-column grid layout (text + 3D preview)
- Animated hero with radial gradients
- Stage component with checker pattern background
- Floating Steve SVG with drop shadow
- Live prompt rotator (cycling through sample prompts)
- Stage prompt overlay with pulsing dot
- Hero CTAs (Open editor, Browse gallery)

### 3. `app/_components/LandingFeatures.tsx`
- Section with eyebrow + heading
- Grid of feature cards (4 features)
- Hover effects: border color change, translateY, accent underline
- Card structure: number, title (mono), description

### 4. `app/_components/LandingDemo.tsx` (Client Component)
- Interactive demo section
- Prompt input with suggestions
- Click-to-fill prompt chips
- Generate button with fake pipeline simulation
- Status indicator with live dot animation
- State machine: idle → busy → done

### 5. `app/_components/LandingContact.tsx` (Client Component)
- Contact info grid (email, GitHub, Discord, press, status)
- Contact form with validation
- Topic radio buttons (Bug, Feature, Press, Other)
- Character counter (0/800)
- Form submission with toast notification
- Client-side validation

### 6. `app/_components/LandingFooter.tsx`
- Simple footer with MIT license
- "Not affiliated with Mojang" disclaimer
- "Made with Groq + Cloudflare" badge

### 7. Update `app/page.tsx`
Replace current content with component composition

### 8. Add CSS to `app/globals.css`
Add the landing page specific styles:
- Container utilities
- Button variants (btn-primary, btn-outline, btn-ghost)
- Animation keyframes (float, pulse)
- Section layouts
- Form styles
- Toast notification styles

**Design Tokens (Already in globals.css):**
- Colors: `--color-accent`, `--color-ui-base`, etc.
- Fonts: Geist (sans), JetBrains Mono (mono)
- Radii: 2px buttons, 6px cards, 8px media
- Shadows: `--shadow-panel`

**Interactive Features:**
- Prompt rotator (cycles every 2.8s)
- Prompt chips (click to fill input)
- Demo "generate" simulation (fake pipeline steps)
- Topic radio selection
- Character counter (warning at 800)
- Form validation with error messages
- Toast notifications
- Smooth scroll for anchor links

**Styling Principles:**
- OLED-dark surface stack
- Electric cyan accent (#00E5FF)
- Minimal hover effects (border swap to accent)
- No gradients on UI, only in hero background
- Square radii (Minecraft pixel feel)
- Type-as-icon discipline (no icon fonts)

---

## Implementation Order

1. **M17 AI Pipeline** (High Priority - Fixes Broken Feature)
   - Create `lib/ai/groq-interpreter.ts`
   - Update `lib/ai/types.ts`
   - Modify `lib/ai/cloudflare-client.ts`
   - Update `app/api/ai/generate/route.ts`
   - Add tests

2. **Landing Page** (High Priority - User-Facing)
   - Create all `_components` files
   - Update `app/page.tsx`
   - Add CSS to `globals.css`
   - Test interactive features

## Environment Variables Needed

Add to `.env.local`:
```
GROQ_API_KEY=your_groq_api_key_here
```

## Success Criteria

**M17 Pipeline:**
- ✅ Groq returns valid JSON with all required fields
- ✅ Generated skins map correctly to 3D model
- ✅ Each body part receives focused description
- ✅ Total generation time 18-25 seconds
- ✅ Cost per generation <$0.01

**Landing Page:**
- ✅ All animations work smoothly (60fps)
- ✅ Form validation prevents invalid submissions
- ✅ Interactive elements respond correctly
- ✅ Design matches DESIGN.md specifications
- ✅ Mobile responsive (test at 375px width)
- ✅ Lighthouse score >95

## Testing Commands

```bash
# Run dev server
npm run dev

# Test M17 pipeline
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "knight in red armor crying"}'

# Check landing page
open http://localhost:3000
```

## Notes

- All file paths must be absolute
- Use `'use client'` directive for client components
- Follow Next.js 15 App Router conventions
- Maintain TypeScript strict mode
- Use existing design tokens from `globals.css`
- No new dependencies needed (Groq SDK should already be installed)

---

**Ready for implementation via Compound Engineering methodology:**
1. `/ce:plan` - Create detailed technical plan
2. `/ce:work` - Implement both features
3. `/ce:review` - Multi-agent review
4. `/ce:compound` - Capture learnings in `docs/COMPOUND.md`
