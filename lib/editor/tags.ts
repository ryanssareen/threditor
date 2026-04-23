/**
 * M11 Unit 1: tag normalization + validation.
 *
 * Pure helper — no React, no zustand. PublishDialog calls this before
 * building the request body; the server re-runs the same validator on
 * the receive side so neither side is authoritative on shape.
 *
 * Rules (DESIGN §11.5 + M11 plan D10):
 *   - Lowercase.
 *   - Trim whitespace.
 *   - Dedupe (preserve first-seen order).
 *   - Max 8 tags.
 *   - Each tag ≤ 32 chars, ≥ 1 char after trim.
 *   - Empty tags (after trim) are dropped, not rejected.
 */

export type TagValidationResult =
  | { ok: true; tags: string[] }
  | { ok: false; error: string };

export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 32;

export function normalizeTagInput(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

export function validateTags(rawOrList: string | string[]): TagValidationResult {
  const list =
    typeof rawOrList === 'string' ? normalizeTagInput(rawOrList) : rawOrList;

  const normalized = Array.from(
    new Set(
      list
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0),
    ),
  );

  if (normalized.length > MAX_TAGS) {
    return { ok: false, error: `Maximum ${MAX_TAGS} tags allowed.` };
  }

  for (const tag of normalized) {
    if (tag.length > MAX_TAG_LENGTH) {
      return {
        ok: false,
        error: `Tag "${tag.slice(0, 10)}…" exceeds ${MAX_TAG_LENGTH} chars.`,
      };
    }
  }

  return { ok: true, tags: normalized };
}

export function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return { ok: false, error: 'Name is required.' };
  }
  if (trimmed.length > 50) {
    return { ok: false, error: 'Name must be 50 characters or fewer.' };
  }
  return { ok: true, name: trimmed };
}
