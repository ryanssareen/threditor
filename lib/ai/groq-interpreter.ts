import 'server-only';

/**
 * M17 Stage 1: Groq prompt interpreter.
 *
 * Takes a freeform user prompt ("knight in red armor crying") and
 * decomposes it into a structured `SkinPartDescriptions` JSON object
 * with focused per-region descriptions. The downstream Cloudflare
 * stage composes a region-aware SDXL prompt from these parts so the
 * generator stops producing generic photographs and starts producing
 * real Minecraft-skin textures.
 *
 * Discipline mirrors `lib/ai/groq.ts`:
 *   - `GROQ_API_KEY` read at invocation time, never at module load.
 *   - `groq-sdk` is dynamically imported.
 *   - SDK errors are reclassified into the existing
 *     `Groq{Env,Auth,RateLimit,Timeout,Aborted,Upstream,Validation}`
 *     tree so the route's catch cascade is unchanged.
 *   - `response_format: { type: 'json_object' }` because this prompt
 *     has no RLE quirk that broke json mode for the M16 path.
 *
 * No retry layer here — if Groq returns malformed JSON, throw
 * `GroqValidationError('shape_invalid', …)` and let the route map it
 * to a 422 generation_invalid. The interpreter is cheap; a higher-
 * level retry on the renderer side is the right place to retry.
 */

import {
  GroqAbortedError,
  GroqAuthError,
  GroqEnvError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqUpstreamError,
  GroqValidationError,
  getGroqKeyShape,
} from './groq';
import { HARD_TIMEOUT_MS } from './prompt';
import type { SkinPartDescriptions, UserAnswers } from './types';

/** Stage-1 model. Same as the M16 main path — no separate billing concerns. */
export const INTERPRETER_MODEL = 'llama-3.3-70b-versatile';

/** Hard cap on Stage-1 completion tokens. ~500 typical, 800 generous. */
const INTERPRETER_MAX_TOKENS = 800;

/** Mild creativity, but reliable JSON shape. */
const INTERPRETER_TEMPERATURE = 0.7;

const SYSTEM_PROMPT = `You are a Minecraft skin designer AI. Your job is to break down user descriptions into detailed, part-by-part visual descriptions for a 64x64 Minecraft skin.

CRITICAL RULES:
1. Output ONLY valid JSON, no preamble, no markdown code fences
2. Each body part gets a detailed visual description (skin tone, clothing, armor, accessories, facial features)
3. Be specific about colors, textures, materials, and placement
4. Determine if classic (4px arms) or slim (3px arms) variant fits better
5. Overlay layers (headOverlay, torsoOverlay) are optional — only include for helmets, hoods, hats, capes, jackets
6. Each description should be 1-2 sentences, focused, visual

OUTPUT FORMAT (exact keys, no extras):
{
  "head": "detailed description of head: skin tone, hair, facial features, expression",
  "headOverlay": "optional: helmet, hood, hat, or other head accessory (omit if none)",
  "torso": "detailed description of torso: clothing, armor, undershirt visible at waist",
  "torsoOverlay": "optional: cape, jacket, vest over the main torso (omit if none)",
  "rightArm": "detailed description of right arm: sleeve, glove, accessories",
  "leftArm": "detailed description of left arm: sleeve, glove, accessories",
  "rightLeg": "detailed description of right leg: pants, armor, boots",
  "leftLeg": "detailed description of left leg: pants, armor, boots",
  "variant": "classic" or "slim"
}

Begin output with { and end with }.`;

/** Required keys on the parsed Groq output. */
const REQUIRED_KEYS = [
  'head',
  'torso',
  'rightArm',
  'leftArm',
  'rightLeg',
  'leftLeg',
  'variant',
] as const;

/** Per-field max length. Defends against runaway descriptions. */
const FIELD_MAX_LEN = 600;

export type InterpretResult = {
  parts: SkinPartDescriptions;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  finishReason: string | null;
};

/**
 * Stage 2: prompt (+ optional clarification answers) → structured
 * per-part descriptions.
 *
 * `userAnswers` is the map produced by `AIClarificationDialog`. When
 * non-null, it's appended to the user message as `User preferences:`
 * lines so Groq folds them into the descriptions deterministically.
 *
 * Throws the same Groq* error types as the main M16 generator so the
 * route's existing handleProviderError cascade catches them.
 */
export async function interpretPromptToSkinParts(
  userPrompt: string,
  userAnswers: UserAnswers | null,
  signal: AbortSignal,
): Promise<InterpretResult> {
  const keyShape = getGroqKeyShape();
  if (!keyShape.present) {
    throw new GroqEnvError(keyShape);
  }

  const groqMod = await import('groq-sdk');
  const Groq = groqMod.default ?? groqMod.Groq;
  const errorCtors = groqMod;

  const client = new Groq({
    apiKey: process.env.GROQ_API_KEY,
    timeout: HARD_TIMEOUT_MS,
    maxRetries: 1,
  });

  const enhancedPrompt = buildUserMessage(userPrompt, userAnswers);

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model: INTERPRETER_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: enhancedPrompt },
        ],
        temperature: INTERPRETER_TEMPERATURE,
        max_completion_tokens: INTERPRETER_MAX_TOKENS,
        response_format: { type: 'json_object' },
      },
      { signal },
    );
  } catch (err) {
    classifyAndThrow(err, errorCtors, signal);
  }

  const choice = completion?.choices?.[0];
  const content: unknown = choice?.message?.content ?? '';
  if (typeof content !== 'string' || content.length === 0) {
    throw new GroqValidationError(
      'shape_invalid',
      typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      'empty completion content',
    );
  }

  const finishReason =
    typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new GroqValidationError(
      'shape_invalid',
      finishReason,
      `JSON.parse failed; sample: ${content.slice(0, 200)}`,
    );
  }

  const validated = validateParts(parsed, finishReason);

  return {
    parts: validated,
    promptTokens: completion?.usage?.prompt_tokens ?? null,
    completionTokens: completion?.usage?.completion_tokens ?? null,
    totalTokens: completion?.usage?.total_tokens ?? null,
    finishReason,
  };
}

/**
 * Compose the user-side message: prompt followed by clarification
 * answers as `- key: value` lines. Empty / null answers are skipped.
 *
 * Length-cap each value to 80 chars to defend against an answer
 * channel being abused for prompt injection or to balloon Stage-2
 * cost.
 */
export function buildUserMessage(
  userPrompt: string,
  userAnswers: UserAnswers | null,
): string {
  if (
    userAnswers === null ||
    typeof userAnswers !== 'object' ||
    Array.isArray(userAnswers)
  ) {
    return userPrompt;
  }
  const entries = Object.entries(userAnswers).filter(([, v]) => {
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.some((s) => typeof s === 'string' && s.trim().length > 0);
    return false;
  });
  if (entries.length === 0) return userPrompt;

  const lines = entries.map(([key, raw]) => {
    const k = String(key).trim().slice(0, 40);
    if (Array.isArray(raw)) {
      const joined = raw
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim())
        .join(', ')
        .slice(0, 200);
      return `- ${k}: ${joined}`;
    }
    return `- ${k}: ${String(raw).trim().slice(0, 80)}`;
  });
  return `${userPrompt}\n\nUser preferences:\n${lines.join('\n')}`;
}

/**
 * Validate Groq's parsed JSON conforms to `SkinPartDescriptions`.
 * Throws `GroqValidationError` on any shape problem.
 *
 * Trims whitespace and clamps each field to FIELD_MAX_LEN before
 * returning. Optional overlay fields are normalized: empty/whitespace
 * strings are dropped to `undefined` so callers can use a single
 * truthiness check.
 */
export function validateParts(
  raw: unknown,
  finishReason: string | null,
): SkinPartDescriptions {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GroqValidationError(
      'shape_invalid',
      finishReason,
      'parts must be a JSON object',
    );
  }
  const obj = raw as Record<string, unknown>;

  for (const key of REQUIRED_KEYS) {
    const v = obj[key];
    if (typeof v !== 'string' || v.trim().length === 0) {
      throw new GroqValidationError(
        'shape_invalid',
        finishReason,
        `missing or empty required field: ${key}`,
      );
    }
  }

  const variantRaw = String(obj.variant).trim().toLowerCase();
  if (variantRaw !== 'classic' && variantRaw !== 'slim') {
    throw new GroqValidationError(
      'shape_invalid',
      finishReason,
      `variant must be "classic" or "slim", got: ${String(obj.variant).slice(0, 40)}`,
    );
  }

  const result: SkinPartDescriptions = {
    head: clampField(obj.head),
    torso: clampField(obj.torso),
    rightArm: clampField(obj.rightArm),
    leftArm: clampField(obj.leftArm),
    rightLeg: clampField(obj.rightLeg),
    leftLeg: clampField(obj.leftLeg),
    variant: variantRaw,
  };

  const headOverlay = optionalField(obj.headOverlay);
  if (headOverlay !== undefined) result.headOverlay = headOverlay;
  const torsoOverlay = optionalField(obj.torsoOverlay);
  if (torsoOverlay !== undefined) result.torsoOverlay = torsoOverlay;

  return result;
}

function clampField(v: unknown): string {
  return String(v).trim().slice(0, FIELD_MAX_LEN);
}

function optionalField(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (trimmed.length === 0) return undefined;
  if (/^(none|n\/a|null|undefined)$/i.test(trimmed)) return undefined;
  return trimmed.slice(0, FIELD_MAX_LEN);
}

/**
 * Reclassify a thrown SDK error into one of the typed Groq* errors.
 * Mirrors `classifySdkError` in `lib/ai/groq.ts`. Always throws.
 */
function classifyAndThrow(
  err: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorCtors: any,
  signal: AbortSignal,
): never {
  if (signal.aborted) {
    throw new GroqAbortedError(false);
  }
  const name =
    err !== null && typeof err === 'object' && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';
  const status =
    err !== null && typeof err === 'object' && 'status' in err
      ? Number((err as { status: unknown }).status)
      : NaN;
  const message =
    err instanceof Error ? err.message : String(err ?? 'unknown error');

  if (
    name === 'APIUserAbortError' ||
    name === 'AbortError' ||
    /aborted/i.test(message)
  ) {
    throw new GroqAbortedError(false);
  }
  if (
    name === 'APIConnectionTimeoutError' ||
    /timeout/i.test(message) ||
    /TIMEOUT/.test(message)
  ) {
    throw new GroqTimeoutError();
  }
  if (name === 'AuthenticationError' || status === 401 || status === 403) {
    throw new GroqAuthError();
  }
  if (name === 'RateLimitError' || status === 429) {
    let retryAfterSeconds = 60;
    const headers =
      err !== null && typeof err === 'object' && 'headers' in err
        ? (err as { headers: unknown }).headers
        : null;
    if (headers !== null && typeof headers === 'object') {
      const rh = (headers as Record<string, unknown>)['retry-after'];
      if (typeof rh === 'string') {
        const n = Number(rh);
        if (Number.isFinite(n) && n > 0) retryAfterSeconds = n;
      }
    }
    throw new GroqRateLimitError(retryAfterSeconds);
  }
  if (
    errorCtors?.APIUserAbortError !== undefined &&
    err instanceof errorCtors.APIUserAbortError
  ) {
    throw new GroqAbortedError(false);
  }
  if (
    errorCtors?.APIConnectionTimeoutError !== undefined &&
    err instanceof errorCtors.APIConnectionTimeoutError
  ) {
    throw new GroqTimeoutError();
  }
  throw new GroqUpstreamError(message.slice(0, 200));
}

/** Total composed-prompt budget. The Worker enforces 400; we leave headroom. */
const COMPOSE_TOTAL_BUDGET = 380;

/** Per-part budget for required body parts (head/torso/limbs). */
const PART_BUDGET = 36;

/** Per-part budget for optional overlays (helmet/cape). */
const OVERLAY_BUDGET = 26;

/**
 * Compose a single rich SDXL prompt from structured per-part
 * descriptions. The existing Cloudflare worker accepts only
 * `{ prompt: string }`; this composer is the bridge that lets us
 * deliver M17's quality lift without a Worker redeploy.
 *
 * Anchors region words ("head", "torso", "right arm", …) into the
 * prompt so SDXL better aligns body-part details with the
 * corresponding atlas regions during generation. The Worker still
 * wraps with its own `pixel art, 64x64 minecraft skin texture, …`
 * prefix before sending to SDXL.
 *
 * Budget is tight (Worker caps user prompts at 400 chars). We clamp
 * each part to a small per-part budget so every region label
 * survives, then hard-cap the joined string. This keeps SDXL
 * anchored to all six body parts even when Groq emits prose-heavy
 * descriptions.
 */
export function composeRenderPrompt(parts: SkinPartDescriptions): string {
  const variantTag = parts.variant === 'slim' ? 'slim 3px arms' : 'classic 4px arms';
  const segments: string[] = [];
  segments.push(`Minecraft skin, ${variantTag}`);
  segments.push(`head: ${tightSlice(parts.head, PART_BUDGET)}`);
  if (parts.headOverlay !== undefined) {
    segments.push(`head accessory: ${tightSlice(parts.headOverlay, OVERLAY_BUDGET)}`);
  }
  segments.push(`torso: ${tightSlice(parts.torso, PART_BUDGET)}`);
  if (parts.torsoOverlay !== undefined) {
    segments.push(`torso outerwear: ${tightSlice(parts.torsoOverlay, OVERLAY_BUDGET)}`);
  }
  segments.push(`right arm: ${tightSlice(parts.rightArm, PART_BUDGET)}`);
  segments.push(`left arm: ${tightSlice(parts.leftArm, PART_BUDGET)}`);
  segments.push(`right leg: ${tightSlice(parts.rightLeg, PART_BUDGET)}`);
  segments.push(`left leg: ${tightSlice(parts.leftLeg, PART_BUDGET)}`);
  segments.push('blocky pixel art, flat shading, front view');
  const composed = segments.join('. ');
  return composed.length > COMPOSE_TOTAL_BUDGET
    ? composed.slice(0, COMPOSE_TOTAL_BUDGET)
    : composed;
}

/**
 * Slice a description to `max` chars without breaking mid-word when
 * possible. Falls back to a hard cut if no whitespace boundary
 * exists in the trailing 8 chars.
 */
function tightSlice(s: string, max: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace >= max - 8) return cut.slice(0, lastSpace);
  return cut;
}
