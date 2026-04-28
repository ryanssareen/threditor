# Combined Implementation Instructions for Claude Code

## Overview
This document contains comprehensive instructions for implementing two major features:
1. **M17 Two-Stage AI Pipeline with Interactive Clarification** - Fix AI skin generation quality
2. **Production Landing Page** - Replace minimal landing with full design

## Reference Files
- `landing.html` - Full HTML reference from design system
- Design system extracted at: `/tmp/threditor-design-system/project/`

---

# Task 1: Implement M17 Two-Stage AI Pipeline with Interactive Clarification

**Context:** The current AI skin generation creates generic PNG images instead of proper Minecraft skins. The new architecture adds an interactive clarification step BEFORE generation.

## Architecture Overview

```
User Prompt: "knight in red armor crying"
    ↓
[STAGE 1: GROQ ASKS CLARIFYING QUESTIONS]
├─ Analyzes prompt ambiguity
├─ Generates 3-5 targeted questions
└─ Returns questions in structured format
    ↓
[USER ANSWERS VIA INTERACTIVE UI]
├─ Style? (Pixel art / Realistic / Cartoon / Anime)
├─ Armor type? (Full plate / Chainmail / Leather / Fantasy)
├─ Crying intensity? (Single tear / Sad expression / Dramatic sobbing)
├─ Accessories? (Helmet / Cape / Sword / Shield)
└─ Variant? (Classic 4px arms / Slim 3px arms)
    ↓
[STAGE 2: GROQ GENERATES DETAILED JSON WITH ANSWERS]
├─ Takes original prompt + user answers
├─ Creates part-by-part descriptions
└─ Returns SkinPartDescriptions
    ↓
[STAGE 3: CLOUDFLARE RENDERS WITH SPECIFICATIONS]
├─ Generates each body part with correct UV coords
└─ Output: Valid 64×64 Minecraft skin ✅
```

## Required Changes

### 1. New Type: `lib/ai/types.ts`

Add clarification question types:

```typescript
export type ClarificationQuestion = {
  id: string;
  question: string;
  options: string[];
  type: 'single_select' | 'multi_select';
};

export type ClarificationResponse = {
  needsClarification: boolean;
  questions?: ClarificationQuestion[];
  directGeneration?: SkinPartDescriptions; // If prompt is clear enough
};

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

export type UserAnswers = Record<string, string | string[]>;
```

### 2. New File: `lib/ai/groq-clarifier.ts`

Creates clarifying questions from ambiguous prompts:

```typescript
import 'server-only';
import Groq from 'groq-sdk';
import type { ClarificationResponse, ClarificationQuestion } from './types';

const CLARIFICATION_SYSTEM_PROMPT = `You are a Minecraft skin designer assistant. Analyze user prompts and determine if clarifying questions would improve the final result.

WHEN TO ASK QUESTIONS:
- Ambiguous style (no mention of realistic/cartoon/pixel art)
- Vague details (e.g., "armor" without type, "crying" without intensity)
- Missing variant preference (classic vs slim arms)
- Complex character descriptions that could be interpreted multiple ways

WHEN NOT TO ASK:
- Very specific prompts with clear details
- Simple descriptions (e.g., "Steve skin with red shirt")
- Prompts that already specify style, colors, and variant

OUTPUT FORMAT:
{
  "needsClarification": true/false,
  "questions": [
    {
      "id": "style",
      "question": "What art style?",
      "options": ["Pixel art", "Realistic", "Cartoon", "Anime"],
      "type": "single_select"
    }
  ]
}

Keep questions to 3-5 maximum. Use friendly, concise language.`;

export async function analyzePromptForClarification(
  prompt: string,
  signal: AbortSignal
): Promise<ClarificationResponse> {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY!,
  });

  const completion = await groq.chat.completions.create(
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: CLARIFICATION_SYSTEM_PROMPT },
        { role: 'user', content: `Analyze this prompt: "${prompt}"` },
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    },
    { signal }
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Groq returned empty response');

  const parsed = JSON.parse(content) as ClarificationResponse;
  
  // Validate structure
  if (parsed.needsClarification && !parsed.questions?.length) {
    throw new Error('Invalid response: needsClarification=true but no questions');
  }

  return parsed;
}
```

### 3. New File: `lib/ai/groq-interpreter.ts`

Takes prompt + answers and creates detailed part descriptions:

```typescript
import 'server-only';
import Groq from 'groq-sdk';
import type { SkinPartDescriptions, UserAnswers } from './types';

const INTERPRETATION_SYSTEM_PROMPT = `You are a Minecraft skin designer AI. Convert user prompts + their answers into detailed, part-by-part visual descriptions for a 64×64 Minecraft skin.

CRITICAL RULES:
1. Output ONLY valid JSON, no preamble, no markdown
2. Each body part gets detailed visual description (colors, textures, materials, placement)
3. Be specific: "dark brown short hair" not just "hair"
4. Use user's answers to resolve ambiguity
5. Overlay layers are optional for helmets, capes, accessories
6. Variant should match user's choice or default to classic if ambiguous

OUTPUT FORMAT:
{
  "head": "Pale skin tone, dark brown short hair, crying eyes with blue tears streaming down cheeks",
  "headOverlay": "Silver knight helmet with red plume on top, visor up",
  "torso": "Red and silver knight chest armor with gold trim, white tunic visible at waist",
  "torsoOverlay": "Flowing red cape attached to shoulders",
  "rightArm": "Red armored sleeve with silver shoulder guard, chainmail visible at elbow",
  "leftArm": "Red armored sleeve with silver shoulder guard, chainmail visible at elbow",
  "rightLeg": "Dark blue pants, red armor plates on thigh and shin, brown leather boots",
  "leftLeg": "Dark blue pants, red armor plates on thigh and shin, brown leather boots",
  "variant": "classic"
}`;

export async function interpretPromptToSkinParts(
  prompt: string,
  userAnswers: UserAnswers | null,
  signal: AbortSignal
): Promise<SkinPartDescriptions> {
  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY!,
  });

  // Build enhanced prompt with user answers
  const enhancedPrompt = userAnswers
    ? `${prompt}\n\nUser preferences:\n${Object.entries(userAnswers)
        .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\n')}`
    : prompt;

  const completion = await groq.chat.completions.create(
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: INTERPRETATION_SYSTEM_PROMPT },
        { role: 'user', content: enhancedPrompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    },
    { signal }
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('Groq returned empty response');

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

### 4. Update: `app/api/ai/generate/route.ts`

Implement three-stage pipeline with clarification step:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { analyzePromptForClarification } from '@/lib/ai/groq-clarifier';
import { interpretPromptToSkinParts } from '@/lib/ai/groq-interpreter';
import { generateSkinFromParts } from '@/lib/ai/cloudflare-client';

export async function POST(req: NextRequest) {
  const signal = req.signal;
  
  try {
    const body = await req.json();
    const { prompt, userAnswers, skipClarification } = body;

    // STAGE 1: Check if we need clarification (unless skipped)
    if (!skipClarification && !userAnswers) {
      const clarificationResult = await analyzePromptForClarification(prompt, signal);
      
      if (clarificationResult.needsClarification) {
        // Return questions to frontend
        return NextResponse.json({
          status: 'needs_clarification',
          questions: clarificationResult.questions,
        });
      }
    }

    // STAGE 2: Groq interpretation (with or without user answers)
    const parts = await interpretPromptToSkinParts(prompt, userAnswers || null, signal);

    // STAGE 3: Cloudflare rendering
    const result = await generateSkinFromParts(parts, signal);

    return NextResponse.json({
      status: 'success',
      result,
    });
  } catch (error) {
    console.error('AI generation error:', error);
    return NextResponse.json(
      { error: 'Generation failed', details: error.message },
      { status: 500 }
    );
  }
}
```

### 5. New Frontend Component: `app/editor/_components/AIClarificationDialog.tsx`

Interactive question UI (similar to `ask_user_input_v0`):

```typescript
'use client';

import { useState } from 'react';
import type { ClarificationQuestion } from '@/lib/ai/types';

type Props = {
  questions: ClarificationQuestion[];
  onSubmit: (answers: Record<string, string | string[]>) => void;
  onSkip: () => void;
};

export function AIClarificationDialog({ questions, onSubmit, onSkip }: Props) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const handleSubmit = () => {
    onSubmit(answers);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-full max-w-md rounded-lg border border-ui-border bg-ui-surface p-6">
        <h3 className="font-mono text-sm font-medium text-text-primary">
          Help us get it right
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          A few quick questions to improve your skin:
        </p>

        <div className="mt-6 space-y-4">
          {questions.map((q) => (
            <div key={q.id}>
              <label className="text-sm text-text-primary">{q.question}</label>
              {q.type === 'single_select' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.options.map((option) => (
                    <button
                      key={option}
                      onClick={() => setAnswers({ ...answers, [q.id]: option })}
                      className={`rounded-sm border px-3 py-2 text-sm transition-colors ${
                        answers[q.id] === option
                          ? 'border-accent bg-accent text-canvas'
                          : 'border-ui-border bg-ui-base text-text-secondary hover:border-accent hover:text-accent'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                // Multi-select implementation
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.options.map((option) => {
                    const currentAnswers = (answers[q.id] as string[]) || [];
                    const isSelected = currentAnswers.includes(option);
                    
                    return (
                      <button
                        key={option}
                        onClick={() => {
                          const newAnswers = isSelected
                            ? currentAnswers.filter((a) => a !== option)
                            : [...currentAnswers, option];
                          setAnswers({ ...answers, [q.id]: newAnswers });
                        }}
                        className={`rounded-sm border px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent text-canvas'
                            : 'border-ui-border bg-ui-base text-text-secondary hover:border-accent hover:text-accent'
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={Object.keys(answers).length === 0}
            className="flex-1 rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-canvas transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            Generate
          </button>
          <button
            onClick={onSkip}
            className="rounded-sm border border-ui-border bg-transparent px-4 py-2 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            Skip questions
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 6. Update Editor AI Integration

Modify the editor's AI generation flow to handle clarification:

```typescript
// In editor component
const [clarificationQuestions, setClarificationQuestions] = useState<ClarificationQuestion[] | null>(null);

const handleGenerate = async (prompt: string) => {
  setGenerating(true);
  
  try {
    // First request: check for clarification
    const response = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    const data = await response.json();

    if (data.status === 'needs_clarification') {
      // Show clarification dialog
      setClarificationQuestions(data.questions);
      setGenerating(false);
      return;
    }

    // Handle successful generation
    applySkinToEditor(data.result);
  } catch (error) {
    console.error('Generation failed:', error);
  } finally {
    setGenerating(false);
  }
};

const handleClarificationSubmit = async (answers: UserAnswers) => {
  setClarificationQuestions(null);
  setGenerating(true);

  try {
    const response = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt: originalPrompt, 
        userAnswers: answers,
        skipClarification: true 
      }),
    });

    const data = await response.json();
    applySkinToEditor(data.result);
  } catch (error) {
    console.error('Generation failed:', error);
  } finally {
    setGenerating(false);
  }
};
```

### 7. Modify: `lib/ai/cloudflare-client.ts`

Accept `SkinPartDescriptions` instead of plain string:

```typescript
export async function generateSkinFromParts(
  parts: SkinPartDescriptions,
  signal: AbortSignal
): Promise<CloudflareCallResult> {
  const { url, token } = readEnvOrThrow();
  
  // Build structured prompt for Cloudflare Worker
  const structuredPrompt = {
    variant: parts.variant,
    regions: [
      { 
        part: 'head', 
        uvBounds: [8, 0, 16, 8], 
        description: `${parts.head}, minecraft pixel art style, blocky, 64x64 texture` 
      },
      { 
        part: 'headOverlay', 
        uvBounds: [40, 0, 48, 8], 
        description: parts.headOverlay 
          ? `${parts.headOverlay}, minecraft pixel art style, blocky, 64x64 texture`
          : null
      },
      { 
        part: 'torso', 
        uvBounds: [20, 20, 28, 32], 
        description: `${parts.torso}, minecraft pixel art style, blocky, 64x64 texture` 
      },
      // ... rest of UV mappings for arms, legs, overlays
    ].filter(r => r.description !== null), // Remove null overlay regions
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

  if (!response.ok) {
    throw new Error(`Cloudflare generation failed: ${response.statusText}`);
  }

  // Parse response and return result
  return parseCloudflareResponse(await response.arrayBuffer());
}
```

### 8. Update Cloudflare Worker

Worker endpoint handles structured input:

```javascript
// workers/ai-generation/index.js
export default {
  async fetch(request, env) {
    const { variant, regions, style } = await request.json();
    
    // Create 64×64 canvas
    const skinTexture = new Uint8Array(64 * 64 * 4);
    
    // For each region
    for (const region of regions) {
      if (!region.description) continue;
      
      // Generate this specific part
      const partPrompt = `${region.description}, ${style}`;
      const partImage = await env.AI.run('@cf/stabilityai/stable-diffusion-xl-lightning', {
        prompt: partPrompt,
        num_steps: 4,
        width: (region.uvBounds[2] - region.uvBounds[0]) * 8,
        height: (region.uvBounds[3] - region.uvBounds[1]) * 8,
      });
      
      // Place generated part at correct UV coordinates
      blitImageToUV(skinTexture, partImage, region.uvBounds);
    }
    
    return new Response(skinTexture, { 
      headers: { 'Content-Type': 'application/octet-stream' } 
    });
  }
};
```

---

# Task 2: Implement Landing Page from Design System

[Previous Task 2 content remains unchanged]

---

## Implementation Order

1. **M17 AI Pipeline with Clarification** (HIGHEST PRIORITY - Fixes Broken Feature)
   - Create `lib/ai/types.ts` updates
   - Create `lib/ai/groq-clarifier.ts`
   - Create `lib/ai/groq-interpreter.ts`
   - Modify `lib/ai/cloudflare-client.ts`
   - Update `app/api/ai/generate/route.ts`
   - Create `AIClarificationDialog.tsx` component
   - Update editor AI integration
   - Update Cloudflare Worker

2. **Landing Page** (High Priority - User-Facing)
   - [Previous Task 2 steps]

## Environment Variables Needed

Add to `.env.local`:
```
GROQ_API_KEY=your_groq_api_key_here
```

## Success Criteria

**M17 Pipeline:**
- ✅ Ambiguous prompts trigger clarification questions
- ✅ Clear prompts skip straight to generation
- ✅ User can answer questions via interactive UI
- ✅ User can skip questions if they want
- ✅ Groq returns valid JSON with all required fields
- ✅ Generated skins map correctly to 3D model
- ✅ Each body part receives focused description
- ✅ Total generation time 20-30 seconds (with questions)
- ✅ Cost per generation <$0.01

**Landing Page:**
- [Previous criteria unchanged]

## Testing Commands

```bash
# Run dev server
npm run dev

# Test M17 pipeline with clarification
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "knight in red armor crying"}'

# Test M17 with answers
curl -X POST http://localhost:3000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "knight", "userAnswers": {"style": "Realistic", "armor": "Full plate"}, "skipClarification": true}'

# Check landing page
open http://localhost:3000
```

## Notes

- All file paths must be absolute
- Use `'use client'` directive for client components
- Follow Next.js 15 App Router conventions
- Maintain TypeScript strict mode
- Use existing design tokens from `globals.css`
- Groq SDK should already be installed

---

**Ready for implementation via Compound Engineering methodology:**
1. `/ce:plan` - Create detailed technical plan
2. `/ce:work` - Implement both features
3. `/ce:review` - Multi-agent review
4. `/ce:compound` - Capture learnings in `docs/COMPOUND.md`
