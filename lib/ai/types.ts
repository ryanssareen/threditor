/**
 * M16 Unit 1: shared AI types — pure types module, importable from
 * BOTH client and server bundles. No runtime exports beyond the type
 * literals; no `import 'server-only'` / `import 'client-only'`.
 *
 * The codec, the Groq client wrapper, the rate-limiter, and the route
 * itself all live behind `import 'server-only'` and must NOT be
 * imported from client bundles. This file is the seam: client-side
 * code (the editor handler that decodes a successful response into a
 * Layer) re-exports `AISkinResponse` from here without dragging the
 * Groq SDK or admin code into the client bundle.
 */

/**
 * The shape Groq returns and the route forwards back to the client.
 *
 * - `palette` — array of 1..16 hex color strings; supports `#rrggbb`
 *   (alpha defaults to 0xFF) and `#rrggbbaa` (case-insensitive).
 * - `rows` — exactly 64 rows; each row is a list of `[paletteIndex, runLength]`
 *   pairs whose `runLength` values sum to exactly 64. Empty rows are
 *   forbidden — at minimum, a row is `[[idx, 64]]` for a solid color.
 *
 * Decoded by `lib/ai/skin-codec.ts::decode` into a 16384-byte
 * Uint8ClampedArray (64 × 64 × 4 RGBA, row-major, top-left origin).
 */
export type AISkinResponse = {
  palette: string[];
  rows: [paletteIndex: number, runLength: number][][];
};

/**
 * M17 Stage 2 output. Produced by `lib/ai/groq-interpreter.ts`.
 *
 * Structured per-part description of a Minecraft skin, derived from
 * the user's freeform prompt + (optionally) clarification answers.
 * Stage 3 (Cloudflare) composes a rich region-aware SDXL prompt from
 * these parts.
 *
 * Overlay layers (`headOverlay`, `torsoOverlay`) are optional — they
 * exist to capture helmets/capes/hoods/jackets that sit on top of the
 * base layer. Empty string and missing key are both treated as "no
 * overlay" by the renderer.
 */
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

/**
 * M17 Stage 1: a single clarification question Groq emits when the
 * user's prompt is ambiguous.
 *
 * `id` is a stable slug ('style', 'armor_type', 'crying_intensity', …)
 * the interpreter uses to feed answers back into Stage 2. `type`
 * is the UI rendering hint — single_select renders a radio-pill row,
 * multi_select renders multi-toggle pills.
 *
 * `options` is a closed list of 2-6 short labels. Free-form input is
 * deliberately omitted to keep the pipeline deterministic and to
 * defend against prompt injection through the answer channel.
 */
export type ClarificationQuestion = {
  id: string;
  question: string;
  options: string[];
  type: 'single_select' | 'multi_select';
};

/**
 * M17 Stage 1 output. The clarifier returns either:
 *   - `needsClarification: true` with a non-empty `questions` array
 *     → the route forwards them to the dialog.
 *   - `needsClarification: false`
 *     → the route falls through to Stage 2 immediately.
 */
export type ClarificationResponse = {
  needsClarification: boolean;
  questions?: ClarificationQuestion[];
};

/**
 * Map of `ClarificationQuestion.id` → answer.
 * Single-select questions resolve to `string`, multi-select to
 * `string[]`. Always populated from the closed `options` list — the
 * dialog never permits free-form text.
 */
export type UserAnswers = Record<string, string | string[]>;

/**
 * Discrete reasons a payload can fail validation. The route maps these
 * into a single user-facing 422 response code (`generation_invalid`)
 * but logs the specific category in `/aiGenerations.validationFailureCategory`
 * so adversarial-prompt patterns can be distinguished from genuine
 * model bugs during operator review.
 */
export type CodecErrorReason =
  | 'palette_empty'
  | 'palette_too_large'
  | 'palette_hex_invalid'
  | 'row_count_invalid'
  | 'row_runs_invalid'
  | 'row_empty'
  | 'palette_index_oor'
  | 'shape_invalid';

export class CodecError extends Error {
  readonly reason: CodecErrorReason;
  constructor(reason: CodecErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'CodecError';
    this.reason = reason;
  }
}

/**
 * The error shape returned by /api/ai/generate. `details.reason` is
 * present only on prompt-validation failures (400). On 429 responses
 * `reason` distinguishes hour / day / IP / aggregate caps. Higher-status
 * errors (500/503) include a `debug` blob with shape-only diagnostic
 * information — never key material.
 */
export type AIGenerateErrorBody =
  | {
      error: 'prompt_invalid';
      details: {
        reason:
          | 'required'
          | 'too_long'
          | 'empty'
          | 'invalid_chars'
          | 'unicode_form';
      };
    }
  | {
      error: 'rate_limited';
      reason: 'hour' | 'day' | 'ip' | 'aggregate';
      resetAt: number;
    }
  | { error: 'generation_invalid' }
  | { error: 'aborted' }
  | { error: 'timeout' }
  | { error: 'unauthorized' }
  | { error: 'service_paused' }
  | {
      error: 'service_misconfigured';
      /**
       * Shape diagnostic — populated only on Groq env failures since
       * M16. Cloudflare env failures DO NOT include a debug body
       * (M17 §Unit-4 design): the URL hostname and token presence
       * are operator-debuggable from server logs only.
       */
      debug?: {
        envKeyShape?: { present: boolean; length: number; prefix: string };
      };
    }
  | { error: 'service_unavailable' };
