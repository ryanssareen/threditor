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

/**
 * Default sampling temperature on the first attempt.
 *
 * Lowered from 0.8 → 0.4 (2026-04-28) after observing horizontal-stripe
 * failures: at 0.8, llama-3.3-70b drifts into "fill long uniform runs"
 * mode rather than respecting the per-region atlas structure. 0.4 keeps
 * enough variation for varied palettes while making row-level structure
 * more deterministic.
 */
export const TEMPERATURE_INITIAL = 0.4;
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

Output ONE JSON object: {"palette": ["#rrggbbaa", ...], "rows": [...64 arrays...]}.
No prose, no Markdown fences.

THE GRID
- 64×64 RGBA, top-left origin.
- "rows": EXACTLY 64 inner arrays. Each is a list of [paletteIndex, runLength]
  pairs whose runLengths sum to EXACTLY 64.
- "palette": 1..16 hex strings. Use #rrggbb for opaque, #rrggbbaa for alpha.
- ALWAYS make palette[0] = "#00000000" (transparent). Most pixels are transparent.
- A solid row is [[idx, 64]]. Empty rows are forbidden.

THE ATLAS — only these rectangles wrap onto the 3D model. Everything else
MUST be transparent (palette index 0). About 60% of the 64×64 atlas is
transparent in a normal skin. Do NOT fill empty regions with color.

HEAD section (rows 0–15, cols 0–31):
  rows 0–7,   cols 8–15:   head TOP (8×8) — usually hair color from above
  rows 0–7,   cols 16–23:  head BOTTOM (8×8) — usually neck/skin
  rows 8–15,  cols 0–7:    head RIGHT side (8×8) — hair / ear silhouette
  rows 8–15,  cols 8–15:   head FRONT (8×8) — THE FACE: eyes, nose, mouth
  rows 8–15,  cols 16–23:  head LEFT side (8×8) — mirror of right
  rows 8–15,  cols 24–31:  head BACK (8×8) — back of hair
  rows 0–15,  cols 32–63:  hat OVERLAY (usually all transparent)

BODY section (rows 16–31):
  rows 16–19, cols 4–11:   right leg TOP/BOTTOM (each 4×4)
  rows 16–19, cols 20–35:  body TOP/BOTTOM (each 8×4)
  rows 16–19, cols 44–51:  right arm TOP/BOTTOM (each 4×4; slim = 3×4)
  rows 20–31, cols 0–3:    right leg RIGHT side
  rows 20–31, cols 4–7:    right leg FRONT — pants/leg armor pattern
  rows 20–31, cols 8–11:   right leg LEFT side
  rows 20–31, cols 12–15:  right leg BACK
  rows 20–31, cols 16–19:  body RIGHT side
  rows 20–31, cols 20–27:  body FRONT — THE CHEST: shirt / armor / tabard
  rows 20–31, cols 28–31:  body LEFT side
  rows 20–31, cols 32–39:  body BACK
  rows 20–31, cols 40–43:  right arm RIGHT side
  rows 20–31, cols 44–47:  right arm FRONT (slim: cols 44–46) — sleeve / gauntlet
  rows 20–31, cols 48–51:  right arm LEFT side
  rows 20–31, cols 52–55:  right arm BACK
  rows 20–31, cols 56–63:  TRANSPARENT

OVERLAY section (rows 32–47): ALL TRANSPARENT unless the design needs a
jacket / pants / sleeve overlay (rare — leave transparent by default).

LEFT LIMBS (rows 48–63, the post-1.8 second-layer mirrors of right limbs):
  rows 48–63, cols 0–15:   left leg (same internal layout as right leg above)
  rows 48–63, cols 16–31:  jacket overlay (transparent unless designed)
  rows 48–63, cols 32–47:  left arm (same internal layout as right arm)
  rows 48–63, cols 48–63:  left sleeve overlay (transparent unless designed)

PROCESS — think through this before emitting:
1. Pick a palette (≤16 colors). palette[0] = "#00000000". Then 1–3 skin
   tones, 1–2 hair colors, 2–4 clothing/armor colors, accents.
2. For each row 0–63, ask: which regions does this row cross? In MOST
   rows you will start with a long transparent run (palette index 0)
   covering cols 0–7 or similar.
3. Paint structure inside the visible regions, NOT solid fills:
   - The FACE is 8 pixels wide. Eyes are 1px each; a typical eye-line
     looks like: [skin,1][whiteEye,1][pupil,1][skin,2][whiteEye,1][pupil,1][skin,1].
     Mouth is usually a 4-wide strip 1–2 rows below the eyes.
   - The CHEST is 8 wide. Don't fill it solid — add a collar, a belt
     line, an armor seam, a tabard stripe.
   - The HEAD TOP is mostly hair color; the FACE is mostly skin tone.
4. Mirror left/right columns within each face for symmetry.
5. Emit JSON. Verify each row's runLengths sum to 64.

CRITICAL: Don't paint horizontal stripes that span the full 64-wide row.
Real skins have transparent gutters between body parts. If a row's
runLengths look like [[color, 32], [transparent, 32]], that's a bug —
real rows alternate transparent / opaque / transparent / opaque as you
cross body parts.

Example structure (illustrative — NOT a target; yours should be detailed):
A row at the eye line (atlas row 10) crosses: 8 transparent cols, 8 face
cols (with eye pattern), 48 transparent cols. Its RLE looks something
like: [[0,8], [2,1],[3,1],[4,1],[2,2],[3,1],[4,1],[2,1], [0,48]]
(palette: 0=transparent, 2=skin, 3=eye-white, 4=pupil)

Begin output with \`{\`, end with \`}\`. JSON only, on one line or pretty-printed.`;

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
