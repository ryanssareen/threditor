# M17: Cloudflare Workers AI Integration

**Goal:** Replace Groq LLM with Cloudflare Workers AI (Stable Diffusion XL) for AI skin generation to achieve better visual quality.

**Status:** Ready for implementation  
**Est. Time:** 6-8 hours  
**Priority:** High (fixes poor quality M16 output)

---

## Problem Statement

**M16 (Groq LLM) produces poor quality skins because:**
- Text models can't do visual design
- No understanding of aesthetics, color theory, or spatial composition
- Generates skins by "guessing" at color indexes
- Results are blocky, basic, unpolished

**Example:** User prompts "knight in red armor" → gets random red/gray blocks with no artistic coherence

---

## Solution: Image Generation → Skin Conversion

Use **Cloudflare Workers AI** (Stable Diffusion XL) for actual image generation, then convert the image to skin format.

### Why Cloudflare Workers AI?

1. ✅ **FREE: 100,000 API calls/day** (vs Groq's token-based $0.001/gen)
2. ✅ **Actual image generation** - understands visual design
3. ✅ **Better quality** - will produce visually appealing skins
4. ✅ **No API key setup** - developer deploys once, works forever
5. ✅ **Dead simple** - one POST endpoint

---

## Architecture

### Current Flow (M16 - Groq)
```
User prompt 
  → Groq LLM (llama-3.3-70b)
  → JSON {palette: [...], rows: [...]}
  → Auto-fixes (pad/truncate rows, fix run sums)
  → Validation
  → Skin
```

**Problems:**
- Model generates wrong row counts (59, 66, 104 instead of 64)
- Model generates wrong run sums (62 instead of 64)
- Requires extensive auto-fixing
- Final output still looks bad

### New Flow (M17 - Cloudflare)
```
User prompt 
  → Cloudflare Workers AI (Stable Diffusion XL)
  → 512x512 PNG image
  → Image processing (sharp):
      1. Downscale to 64x64 (nearest neighbor)
      2. Quantize to 16-color palette (median cut)
      3. Convert to run-length encoding
  → JSON {palette: [...], rows: [...]}
  → Validation (should always pass - no auto-fixes needed)
  → Skin
```

**Benefits:**
- Model SEES and understands the visual result
- No row count errors (we control the output)
- No run sum errors (we compute them correctly)
- Better artistic quality

---

## Agent Consultation Plan (Updated for M17)

Following the original Design.md methodology from M1-M8, we'll consult specialist AI agents during the planning phase. **Updated for M17 context** (April 2026, post-M16 Groq implementation).

| Agent | Role | M17-Specific Questions |
|---|---|---|
| **ChatGPT** | UX & prompt engineering | • How should we present AI generation in the UI? Inline button vs modal?<br>• What prompt engineering techniques improve Stable Diffusion for pixel art?<br>• Should we show generation progress/preview?<br>• How to handle failed generations gracefully? |
| **Gemini** | Visual design & image quality | • Evaluate Cloudflare output vs Groq output visually<br>• What color quantization algorithm produces best pixel art?<br>• Should we post-process for better pixelation?<br>• Ideal Stable Diffusion parameters for 64x64 skins? |
| **Perplexity** | Technical research | • Latest Cloudflare Workers AI best practices (2026)<br>• Stable Diffusion XL optimization for pixel art<br>• Sharp vs alternatives (Jimp, Canvas, ImageMagick)<br>• Median cut vs k-means for palette quantization |
| **Claude Code (Opus 4.7)** | Architecture & execution | • Design image → RLE conversion pipeline<br>• Implement Cloudflare Worker<br>• Build image processing logic<br>• Execute `/ce:plan`, `/ce:work`, `/ce:review` |

### Consultation Workflow

**Phase 1: Planning (Pre-Implementation)**

1. **Perplexity:** Research current state
   - Query: "Cloudflare Workers AI Stable Diffusion XL best practices 2026"
   - Query: "pixel art generation techniques stable diffusion"
   - Query: "image quantization algorithms comparison sharp jimp"

2. **ChatGPT:** UX decisions
   - Prompt: "Design UX for AI skin generation button. User flow from prompt → loading → result. Consider mobile + desktop."
   - Prompt: "Create prompt engineering template for Minecraft skin generation via Stable Diffusion. Focus on pixel art style."

3. **Gemini:** Visual quality evaluation
   - Task: "Review 5 AI-generated skins (attach images). Rate visual quality 1-10. Suggest improvements."
   - Task: "Compare color quantization: median cut vs k-means. Which produces better pixel art?"

**Phase 2: Execution**

4. **Claude Code:** Implementation
   - Run: `/ce:plan` with inputs from Perplexity, ChatGPT, Gemini
   - Execute: `/ce:work` to build Cloudflare Worker + image processing
   - Review: `/ce:review` for quality checks

**Phase 3: Validation**

5. **Gemini:** Visual QA
   - Compare: Groq output vs Cloudflare output side-by-side
   - Rate: Quality improvement (should be significant)

6. **ChatGPT:** UX testing
   - Test: Generation flow feels smooth?
   - Verify: Error states handled gracefully?

---

### Consultation Questions Bank (Ready to Copy-Paste)

**For Perplexity:**

```
1. "What are the best practices for using Cloudflare Workers AI with Stable Diffusion XL in 2026? Focus on pixel art generation."

2. "Compare image quantization libraries for Node.js: Sharp, Jimp, ImageMagick. Which is best for converting 512x512 PNG to 64x64 pixel art with 16-color palette?"

3. "Median cut vs k-means color quantization for pixel art. Which algorithm preserves artistic style better?"
```

**For ChatGPT:**

```
1. "Design the UX flow for an AI skin generation feature in a Minecraft skin editor. User clicks AI button → enters prompt → sees loading state → receives result. Consider mobile and desktop. Keep it simple and delightful."

2. "Create a prompt engineering template for generating Minecraft character skins using Stable Diffusion XL. The output needs to be pixel-art style, 64x64, game-ready. What negative prompts should we use?"

3. "How should we handle AI generation failures? User entered prompt but generation timed out or returned error. Design the error state."
```

**For Gemini:**

```
1. "I'm attaching 5 AI-generated Minecraft skins. Rate each 1-10 for visual quality. Consider: color harmony, artistic coherence, pixel-perfect aesthetic, usability in-game. Suggest specific improvements."

2. "Compare these two color quantization results for pixel art: [attach median cut output] vs [attach k-means output]. Which looks better? Why?"

3. "Review this Stable Diffusion XL output for a 'knight in red armor' skin. What parameters should we adjust to improve pixel art quality?"
```

---

### Integration of Agent Outputs

**After consultations, synthesize into implementation:**

1. **Perplexity findings** → Update technical approach in implementation plan
2. **ChatGPT UX decisions** → Design UI components and error states
3. **Gemini visual QA** → Fine-tune Stable Diffusion parameters and quantization
4. **Claude Code execution** → Build + ship

**Document outputs in:** `docs/M17-CONSULTATIONS.md` (archive all responses)

---

## Implementation Plan

### Phase 1: Cloudflare Workers Setup

**File:** `workers/ai-skin-generator.js`

```javascript
export default {
  async fetch(request, env) {
    // 1. Extract prompt from request
    const { prompt } = await request.json();
    
    // 2. Enhanced prompt engineering for Minecraft style
    // TODO: Update with ChatGPT's prompt template
    const enhancedPrompt = `
      pixel art minecraft character skin, 64x64 texture, 
      game-ready asset, flat front view, simple colors,
      ${prompt}
    `.trim();
    
    // 3. Call Cloudflare AI
    // TODO: Update parameters based on Gemini's recommendations
    const response = await env.AI.run(
      "@cf/stabilityai/stable-diffusion-xl-base-1.0",
      {
        prompt: enhancedPrompt,
        negative_prompt: "realistic, 3d, blurry, photograph, complex shading",
        num_steps: 20,
        guidance: 7.5,
        width: 512,
        height: 512
      }
    );
    
    // 4. Return base64 image
    return new Response(response, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
```

**Deployment Steps:**

```bash
# 1. Install Wrangler CLI globally
npm install -g wrangler

# 2. Login to Cloudflare
wrangler login

# 3. Create workers directory
mkdir -p workers
cd workers

# 4. Create wrangler.toml
cat > wrangler.toml << EOF
name = "ai-skin-generator"
main = "ai-skin-generator.js"
compatibility_date = "2024-01-01"

[ai]
binding = "AI"
EOF

# 5. Deploy
wrangler deploy

# Output: https://ai-skin-generator.<your-subdomain>.workers.dev
```

---

### Phase 2: Image Processing

**File:** `lib/ai/cloudflare.ts`

```typescript
import sharp from 'sharp'; // TODO: Verify Sharp vs alternatives from Perplexity

interface SkinData {
  palette: string[];
  rows: number[][][];
}

export async function generateSkinFromImage(
  imageBase64: string
): Promise<SkinData> {
  // 1. Decode base64 → buffer
  const buffer = Buffer.from(imageBase64, 'base64');
  
  // 2. Resize to 64x64 with nearest neighbor (pixel-perfect)
  const resized = await sharp(buffer)
    .resize(64, 64, {
      kernel: 'nearest',
      fit: 'fill'
    })
    .removeAlpha() // Remove transparency
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // 3. Quantize to palette
  // TODO: Use algorithm recommended by Gemini (median cut vs k-means)
  const { palette, pixels } = quantizeImage(
    resized.data,
    resized.info.channels
  );
  
  // 4. Convert to RLE
  const rows = convertToRLE(pixels, palette);
  
  return { palette, rows };
}

function quantizeImage(
  buffer: Buffer,
  channels: number
): { palette: string[]; pixels: number[] } {
  // Use median cut algorithm to reduce to max 16 colors
  const colors = new Map<string, number>();
  
  // 1. Extract unique colors
  for (let i = 0; i < buffer.length; i += channels) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];
    const hex = rgbToHex(r, g, b);
    colors.set(hex, (colors.get(hex) || 0) + 1);
  }
  
  // 2. If <= 16 colors, use as-is
  if (colors.size <= 16) {
    const palette = Array.from(colors.keys());
    const pixels = [];
    
    for (let i = 0; i < buffer.length; i += channels) {
      const r = buffer[i];
      const g = buffer[i + 1];
      const b = buffer[i + 2];
      const hex = rgbToHex(r, g, b);
      pixels.push(palette.indexOf(hex));
    }
    
    return { palette, pixels };
  }
  
  // 3. Otherwise, use median cut to reduce to 16 colors
  const reducedPalette = medianCut(Array.from(colors.entries()), 16);
  
  // 4. Map each pixel to nearest palette color
  const pixels = [];
  for (let i = 0; i < buffer.length; i += channels) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];
    const nearestIdx = findNearestColor(r, g, b, reducedPalette);
    pixels.push(nearestIdx);
  }
  
  return { palette: reducedPalette, pixels };
}

function medianCut(
  colors: [string, number][],
  maxColors: number
): string[] {
  // Median cut algorithm implementation
  // (Standard algorithm - can use existing library like quantize.js)
  
  // For now, use simple frequency-based selection
  const sorted = colors.sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, maxColors).map(c => c[0]);
}

function findNearestColor(
  r: number,
  g: number,
  b: number,
  palette: string[]
): number {
  let minDist = Infinity;
  let nearestIdx = 0;
  
  for (let i = 0; i < palette.length; i++) {
    const { r: pr, g: pg, b: pb } = hexToRgb(palette[i]);
    const dist = Math.sqrt(
      Math.pow(r - pr, 2) +
      Math.pow(g - pg, 2) +
      Math.pow(b - pb, 2)
    );
    
    if (dist < minDist) {
      minDist = dist;
      nearestIdx = i;
    }
  }
  
  return nearestIdx;
}

function convertToRLE(
  pixels: number[],
  palette: string[]
): number[][][] {
  const rows: number[][][] = [];
  
  // Convert 64x64 pixel array to 64 rows of RLE
  for (let y = 0; y < 64; y++) {
    const row: number[][] = [];
    let currentColor = pixels[y * 64];
    let runLength = 1;
    
    for (let x = 1; x < 64; x++) {
      const pixelIdx = y * 64 + x;
      
      if (pixels[pixelIdx] === currentColor) {
        runLength++;
      } else {
        row.push([currentColor, runLength]);
        currentColor = pixels[pixelIdx];
        runLength = 1;
      }
    }
    
    // Push final run
    row.push([currentColor, runLength]);
    rows.push(row);
  }
  
  return rows;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}
```

**Dependencies:**

```bash
npm install sharp
npm install @types/sharp --save-dev
```

---

### Phase 3: Update API Route

**File:** `app/api/ai/generate/route.ts`

Replace Groq implementation with Cloudflare:

```typescript
import { generateSkinFromImage } from '@/lib/ai/cloudflare';
import { validateResponse } from '@/lib/ai/groq'; // Keep validation

export async function POST(request: Request) {
  const { prompt, uid } = await request.json();
  
  console.log('[AI Generation] 🚀 Starting generation:', {
    promptPreview: prompt.slice(0, 50) + '...',
    uid,
    timestamp: new Date().toISOString(),
  });
  
  try {
    // 1. Call Cloudflare Worker
    const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
    
    if (!workerUrl) {
      throw new Error('CLOUDFLARE_WORKER_URL not configured');
    }
    
    console.log('[Cloudflare] 📞 Calling worker:', workerUrl);
    
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    
    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}`);
    }
    
    const imageBase64 = await response.text();
    console.log('[Cloudflare] 🖼️  Received image:', imageBase64.length, 'bytes');
    
    // 2. Convert image → skin format
    console.log('[Cloudflare] 🔄 Converting to skin format...');
    const skin = await generateSkinFromImage(imageBase64);
    
    // 3. Validate (reuse Groq validation)
    console.log('[Cloudflare] ✅ Validating...');
    validateResponse(skin);
    
    console.log('[AI Generation] ✅ Success!');
    
    return Response.json({
      success: true,
      skin,
      finishReason: 'stop',
      provider: 'cloudflare',
    });
    
  } catch (error) {
    console.error('[AI Generation] ❌ Error:', error);
    
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Generation failed',
      },
      { status: 500 }
    );
  }
}
```

---

### Phase 4: Environment Variables

**Local:** `.env.local`

```bash
# Add Cloudflare Worker URL
CLOUDFLARE_WORKER_URL=https://ai-skin-generator.<your-subdomain>.workers.dev

# Optional: keep Groq for fallback
GROQ_API_KEY=gsk_...
IP_HASH_SALT=...
```

**Vercel:**

```bash
vercel env add CLOUDFLARE_WORKER_URL production
# Paste: https://ai-skin-generator.<your-subdomain>.workers.dev

vercel env add CLOUDFLARE_WORKER_URL preview
vercel env add CLOUDFLARE_WORKER_URL development
```

---

### Phase 5: Testing

**Test Checklist:**

```bash
# 1. Test Cloudflare Worker directly
curl -X POST https://ai-skin-generator.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"prompt": "knight in red armor"}' \
  | head -c 100

# Should return: base64 image data

# 2. Test image processing locally
# Create test script: scripts/test-image-conversion.ts
npm run test:image

# 3. Test full API route
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "knight in red armor", "uid": "test"}' \
  | jq '.skin.palette'

# Should return: ["#8B0000", "#FF0000", ...]

# 4. Test in browser
# Visit: http://localhost:3000/editor
# Click AI button, enter: "wizard with purple robe"
# Should generate visually better skin than Groq
```

---

## Migration Strategy

### Option A: Hard Switch (Recommended)

**Pros:**
- Simpler codebase
- Everyone gets better quality
- No feature flag complexity

**Cons:**
- No rollback without redeploy

**Implementation:**
```typescript
// Just replace Groq with Cloudflare
// Remove lib/ai/groq.ts (optional)
```

---

### Option B: Feature Flag

**Pros:**
- Safe rollout
- Can A/B test
- Easy rollback

**Cons:**
- More complex
- Need to maintain both

**Implementation:**
```typescript
// .env.local
AI_PROVIDER=cloudflare // or 'groq'

// app/api/ai/generate/route.ts
const provider = process.env.AI_PROVIDER || 'cloudflare';

if (provider === 'groq') {
  return generateWithGroq(prompt);
} else {
  return generateWithCloudflare(prompt);
}
```

**Recommendation:** Go with **Option A** (hard switch). Cloudflare is objectively better and free.

---

## File Changes Summary

**New Files:**
- `workers/ai-skin-generator.js` - Cloudflare Worker
- `workers/wrangler.toml` - Worker config
- `lib/ai/cloudflare.ts` - Image processing
- `docs/M17-CONSULTATIONS.md` - Agent consultation archive

**Modified Files:**
- `app/api/ai/generate/route.ts` - Switch to Cloudflare
- `package.json` - Add `sharp`
- `.env.local` - Add `CLOUDFLARE_WORKER_URL`

**Optional Removals (if doing hard switch):**
- `lib/ai/groq.ts` - Old Groq implementation

---

## Success Criteria

✅ Cloudflare Worker deployed at `https://ai-skin-generator.<your-subdomain>.workers.dev`  
✅ Worker returns base64 images for prompts  
✅ Image processing converts 512x512 → 64x64 correctly  
✅ Palette quantization reduces to ≤16 colors  
✅ RLE conversion produces valid skin JSON  
✅ API route returns valid skin format  
✅ **Visual quality significantly better than Groq** (verified by Gemini)  
✅ Cost: $0 (under 100k/day limit)  
✅ No API key required from users  
✅ Agent consultations documented in `docs/M17-CONSULTATIONS.md`  

---

## Quality Comparison

**Groq (M16):**
- ❌ Basic blocky designs
- ❌ Random color choices
- ❌ No artistic coherence
- ❌ Requires extensive auto-fixes
- ❌ Feels AI-generated (in a bad way)

**Cloudflare (M17):**
- ✅ Actual visual understanding
- ✅ Coherent color palettes
- ✅ Artistic composition
- ✅ No auto-fixes needed (we control output)
- ✅ Looks like a real skin

---

## Rollout Plan

1. **Consult agents** (1 hour) - Perplexity, ChatGPT, Gemini
2. **Synthesize findings** (30 min) - Update plan with agent outputs
3. **Deploy Cloudflare Worker** (5 min)
4. **Test worker directly** (5 min)
5. **Implement image processing** (2 hours)
6. **Update API route** (30 min)
7. **Test locally** (30 min)
8. **Deploy to Vercel** (5 min)
9. **Test in production** (15 min)
10. **Visual QA with Gemini** (30 min) - Compare Groq vs Cloudflare
11. **Document learnings** (15 min) - Archive in M17-CONSULTATIONS.md
12. **If better → remove Groq code** (15 min)

**Total: ~6 hours** (with agent consultations)

---

## Cost Analysis

**Cloudflare Workers AI:**
- FREE: 100,000 requests/day
- After limit: Pay-as-you-go ($0.011/1000 requests)
- **Expected cost for hobby project: $0/month**

**vs Groq (current):**
- $0.001/generation
- At 100 gens/day: $3/month
- At 1000 gens/day: $30/month

**Savings: 100% for typical usage**

---

## References

- [Cloudflare Workers AI Docs](https://developers.cloudflare.com/workers-ai/)
- [Stable Diffusion XL Model](https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-base-1.0/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Sharp Image Processing](https://sharp.pixelplumbing.com/)
- [Median Cut Algorithm](https://en.wikipedia.org/wiki/Median_cut)
- [GitHub Example: Cloudflare Workers AI](https://github.com/saurav-z/free-image-generation-api)
- [Original Design.md](./DESIGN.md) - Section 12.8 for agent methodology

---

## Next Actions

1. ✅ **Read this plan** (you are here)
2. 🤖 **Run agent consultations** (Perplexity, ChatGPT, Gemini)
3. 📝 **Update plan with findings**
4. 🚀 **Execute via Claude Code** (`/ce:plan`)
5. 📊 **Visual QA** (Groq vs Cloudflare comparison)
6. 🎉 **Ship M17** if quality is better
7. 📚 **Archive learnings** in `docs/M17-CONSULTATIONS.md`
