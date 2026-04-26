import 'server-only';

/**
 * M16 Unit 2: Groq prompt construction.
 *
 * The system prompt instructs the model that the output is a 64-row ×
 * 64-column pixel grid in palette-indexed RLE form. We give one short
 * worked example so the JSON shape is unambiguous, and explicitly
 * forbid code-fence wrapping or prose preamble. `temperature: 0` retry
 * gets a stricter inline reminder appended to the user message.
 *
 * Token-cost constants are co-located here (vs. spread across the
 * codebase) because they are paired with the system prompt — if the
 * prompt grows, `TOKENS_PER_REQUEST_INPUT_ESTIMATE` should grow too.
 */

import type Groq from 'groq-sdk';

/**
 * Pricing for `llama-3.3-70b-versatile` per 1M tokens, in USD. Sourced
 * from https://groq.com/pricing as of 2026-04 — verify on each major
 * model swap. Used by `costEstimateUsd` for /aiGenerations log writes
 * and the aggregate-cost kill switch.
 */
export const PRICING = {
  inputUsdPerMillion: 0.59,
  outputUsdPerMillion: 0.79,
} as const;

/**
 * Default model. Production-tier on the Groq free plan (30 RPM, 12K
 * TPM, 100K TPD). 128K context, 32,768 max output. Trade-off vs.
 * `gpt-oss-120b` (which supports strict json_schema mode): we keep
 * llama-3.3-70b for now and rely on defensive validation + retry-at-0.
 *
 * Decision recorded in plan §Open-Questions: switch to `gpt-oss-120b`
 * if measured retry rate > 10% in production logs.
 */
export const MODEL = 'llama-3.3-70b-versatile';

/**
 * Hard cap on completion tokens. A realistic palette+RLE output is
 * 1.5K-3K tokens; 4K is generous headroom. The cap defends against
 * prompt-manipulation that would 10× per-gen cost ("emit 1000 rows",
 * "repeat the palette"). Without it, output could approach the
 * model's 32,768 max.
 */
export const MAX_COMPLETION_TOKENS = 4000;

/** Default sampling temperature on the first attempt. */
export const TEMPERATURE_INITIAL = 0.8;
/** Retry temperature — deterministic, shorter, more conservative. */
export const TEMPERATURE_RETRY = 0;

/**
 * Server-side timeout on the Groq HTTP call. Median latency is ~2-5s
 * for ~3K-token output; the 30s cap is the slow-tail cutoff. Note that
 * `client disconnect` does NOT zero Groq's bill (Groq still bills tokens
 * generated up to the abort), but the abort does bound wall time.
 */
export const HARD_TIMEOUT_MS = 30_000;

export const SYSTEM_PROMPT = `You are a Minecraft skin pixel-art generator.

Your output describes a 64×64 RGBA pixel grid in palette + per-row RLE form. \
You MUST emit a single JSON object — no prose, no Markdown fences — with \
exactly two top-level keys:

  {
    "palette": ["#rrggbb", "..."],
    "rows":    [[[idx, run], ...], ...]
  }

Constraints:
- "palette": 1 to 16 hex color strings. Use lowercase \`#rrggbb\` for opaque \
colors and \`#rrggbbaa\` only when transparency matters (e.g., the empty \
overlay regions). Most skin pixels are opaque.
- "rows": exactly 64 inner arrays. Each inner array is a list of \
\`[paletteIndex, runLength]\` pairs whose runLength values sum to exactly 64. \
runLength is a positive integer, paletteIndex is in [0, palette.length).
- A solid-color row is \`[[idx, 64]]\`. Empty rows are forbidden.

Skin layout (key regions, top-left origin):
- Head:  rows 0..7   col 8..15  (front face), row 0..7 col 24..31 (back)
- Torso: rows 20..31 col 20..27 (front), row 20..31 col 32..39 (back)
- Arms:  rows 20..31 col 44..47 (right front), col 36..39 (left front)
- Legs:  rows 20..31 col 4..7 (right front), col 20..23 (left front, second pose)
- Use \`#00000000\` (transparent) for unused atlas regions and overlay layers.

Style:
- Embrace the 64×64 constraint. Limited palettes look intentional.
- Use shading: a slightly darker tone of the same hue for shadows works well.
- Do not include text, code fences, comments, or any keys other than \
"palette" and "rows".

Example output for a uniform red skin:

{"palette":["#c0392b"],"rows":[[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]],[[0,64]]]}

Always respond with a single JSON object on one line or pretty-printed; \
never with prose. Begin output with \`{\` and end with \`}\`.`;

/** Stricter wrapper appended to the user prompt on the temperature-0 retry. */
const RETRY_REMINDER = `\n\nIMPORTANT: Your previous response was invalid. Output ONLY a JSON object \
with exactly the keys "palette" (1..16 hex strings) and "rows" (exactly 64 \
arrays of [paletteIndex, runLength] pairs whose runLengths sum to 64). \
No code fences, no prose, no extra keys. Begin with \`{\` and end with \`}\`.`;

/** Build the chat-completion message array. */
export function buildMessages(
  userPrompt: string,
  isRetry: boolean,
): Groq.Chat.Completions.ChatCompletionMessageParam[] {
  const userContent = isRetry ? userPrompt + RETRY_REMINDER : userPrompt;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

/**
 * Compute USD cost from Groq usage object. Returns 0 if either count
 * is missing. Used for /aiGenerations log writes and the aggregate
 * weekly cost rollup.
 */
export function costEstimateUsd(
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): number {
  const inUsd = ((promptTokens ?? 0) * PRICING.inputUsdPerMillion) / 1_000_000;
  const outUsd =
    ((completionTokens ?? 0) * PRICING.outputUsdPerMillion) / 1_000_000;
  // Round to 6 decimals to keep Firestore stable (avoids float jitter
  // when aggregating).
  return Math.round((inUsd + outUsd) * 1_000_000) / 1_000_000;
}
