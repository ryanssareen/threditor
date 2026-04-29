import 'server-only';

/**
 * M17 Stage 1: prompt-clarification analyzer.
 *
 * Takes a freeform user prompt and decides whether to ask 3-5 quick
 * follow-up questions before generation, or to fall through to Stage 2
 * directly. Returns a `ClarificationResponse` the route forwards to
 * the dialog.
 *
 * Discipline mirrors `lib/ai/groq.ts` and `lib/ai/groq-interpreter.ts`:
 *   - `GROQ_API_KEY` read at invocation time, never at module load.
 *   - `groq-sdk` is dynamically imported.
 *   - SDK errors are reclassified into the existing `Groq*Error` tree
 *     so the route's catch cascade is unchanged.
 *   - `response_format: { type: 'json_object' }` because this prompt
 *     is well-formed JSON.
 *
 * Cost note: ~300-500 tokens / call. The route does NOT consume a
 * rate-limit slot for clarifier-only requests — generation slots are
 * billed only when Stage 2/3 actually run.
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
import type { ClarificationQuestion, ClarificationResponse } from './types';

export const CLARIFIER_MODEL = 'llama-3.3-70b-versatile';

/** Hard cap on the clarifier's completion tokens. */
const CLARIFIER_MAX_TOKENS = 500;

/** Lower temperature than Stage 2 — questions should be predictable. */
const CLARIFIER_TEMPERATURE = 0.3;

/** Minimum / maximum questions Groq is allowed to ask. */
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 5;

/** Minimum / maximum options per question. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

/** Per-field caps. */
const QUESTION_MAX_LEN = 200;
const OPTION_MAX_LEN = 60;
const ID_MAX_LEN = 40;

const SYSTEM_PROMPT = `You are a Minecraft skin designer assistant. Analyze user prompts and decide whether 3-5 short follow-up questions would meaningfully improve the final skin.

The UI presents one question at a time as a step-by-step wizard. Each
question renders as exactly 4 button choices plus a free-text input
the user can fall back to. Pick the 4 most common, useful, mutually-
distinct choices for each question.

WHEN TO ASK:
- Ambiguous style (no mention of pixel-art / cartoon / realistic / anime)
- Missing armor or clothing detail (e.g., "knight" without armor type)
- Missing variant (classic vs slim arms)
- Vague mood / accessories the prompt mentions (e.g., "crying" intensity)
- Multiple plausible interpretations of a key visual

WHEN NOT TO ASK:
- Prompt already specifies style + colors + key accessories
- Simple prompts ("a green creeper", "Steve with red shirt")
- Prompts that name a specific known character or trope concretely

OUTPUT (strict JSON, no preamble, no fences):
{
  "needsClarification": true|false,
  "questions": [
    {
      "id": "style",
      "question": "What art style?",
      "options": ["Pixel art", "Realistic", "Cartoon", "Anime"],
      "type": "single_select"
    },
    {
      "id": "armor",
      "question": "Armor type?",
      "options": ["Full plate", "Chainmail", "Leather", "Fantasy"],
      "type": "single_select"
    }
  ]
}

RULES:
- 3-5 questions total. Focus on the most ambiguous aspects of the prompt.
- Each question MUST have exactly 4 options — no more, no less.
- Questions are short and friendly (under 40 characters).
- Options are 1-3 words each, mutually distinct.
- "id" is a snake_case slug, max 40 chars.
- "type" is "single_select" (default) or "multi_select".
- "questions" is REQUIRED when needsClarification=true; OMIT or empty array when false.
- No prose outside the JSON object.

Begin output with { and end with }.`;

export type ClarifyResult = {
  response: ClarificationResponse;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  finishReason: string | null;
};

export async function analyzePromptForClarification(
  userPrompt: string,
  signal: AbortSignal,
): Promise<ClarifyResult> {
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

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model: CLARIFIER_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this prompt: "${userPrompt}"` },
        ],
        temperature: CLARIFIER_TEMPERATURE,
        max_completion_tokens: CLARIFIER_MAX_TOKENS,
        response_format: { type: 'json_object' },
      },
      { signal },
    );
  } catch (err) {
    classifyAndThrow(err, errorCtors, signal);
  }

  const choice = completion?.choices?.[0];
  const content: unknown = choice?.message?.content ?? '';
  const finishReason =
    typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;

  if (typeof content !== 'string' || content.length === 0) {
    throw new GroqValidationError(
      'shape_invalid',
      finishReason,
      'empty completion content',
    );
  }

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

  const validated = validateClarification(parsed, finishReason);

  return {
    response: validated,
    promptTokens: completion?.usage?.prompt_tokens ?? null,
    completionTokens: completion?.usage?.completion_tokens ?? null,
    totalTokens: completion?.usage?.total_tokens ?? null,
    finishReason,
  };
}

/**
 * Validate Groq's parsed JSON conforms to `ClarificationResponse`.
 * Tolerates both shapes:
 *   - `{ needsClarification: false }` (questions omitted or empty)
 *   - `{ needsClarification: true, questions: [...] }`
 *
 * Throws `GroqValidationError` on malformed shape. Clamps
 * over-eager Groq output (e.g., 12 questions, 20-char ids) into the
 * MIN/MAX bounds rather than rejecting outright.
 */
export function validateClarification(
  raw: unknown,
  finishReason: string | null,
): ClarificationResponse {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GroqValidationError(
      'shape_invalid',
      finishReason,
      'clarification response must be a JSON object',
    );
  }
  const obj = raw as Record<string, unknown>;
  const needs = obj.needsClarification;
  if (typeof needs !== 'boolean') {
    throw new GroqValidationError(
      'shape_invalid',
      finishReason,
      'needsClarification must be a boolean',
    );
  }

  if (needs === false) {
    return { needsClarification: false };
  }

  const questionsRaw = obj.questions;
  if (!Array.isArray(questionsRaw) || questionsRaw.length === 0) {
    throw new GroqValidationError(
      'shape_invalid',
      finishReason,
      'needsClarification=true requires a non-empty questions array',
    );
  }

  const questions: ClarificationQuestion[] = [];
  const seenIds = new Set<string>();
  for (const q of questionsRaw.slice(0, MAX_QUESTIONS)) {
    if (q === null || typeof q !== 'object' || Array.isArray(q)) continue;
    const qo = q as Record<string, unknown>;
    const id = clampString(qo.id, ID_MAX_LEN);
    if (id === null) continue;
    if (seenIds.has(id)) continue;
    const question = clampString(qo.question, QUESTION_MAX_LEN);
    if (question === null) continue;
    const optionsRaw = qo.options;
    if (!Array.isArray(optionsRaw)) continue;
    const options: string[] = [];
    for (const opt of optionsRaw.slice(0, MAX_OPTIONS)) {
      const o = clampString(opt, OPTION_MAX_LEN);
      if (o !== null && !options.includes(o)) options.push(o);
    }
    if (options.length < MIN_OPTIONS) continue;
    const typeRaw = String(qo.type ?? 'single_select').trim().toLowerCase();
    const type: ClarificationQuestion['type'] =
      typeRaw === 'multi_select' ? 'multi_select' : 'single_select';

    seenIds.add(id);
    questions.push({ id, question, options, type });
  }

  if (questions.length < MIN_QUESTIONS) {
    throw new GroqValidationError(
      'shape_invalid',
      finishReason,
      'no valid clarification questions after sanitization',
    );
  }

  return { needsClarification: true, questions };
}

function clampString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

/**
 * Reclassify a thrown SDK error into one of the typed Groq* errors.
 * Identical contract to the helpers in `groq-interpreter.ts` and
 * `groq.ts` — keeps the route's error cascade uniform.
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
