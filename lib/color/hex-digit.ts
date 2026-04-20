/**
 * Scalar hex-digit parse. Returns 0 for any non-hex char so callers can
 * compose three back-to-back calls per channel without allocating a tuple
 * — preserves the M3 zero-allocation invariant on the pointer hot path.
 *
 * Extracted during M5 Unit 0 from duplicated copies in ViewportUV.tsx and
 * PlayerModel.tsx (flagged by M4 /ce:review code-simplicity pass).
 */
export function hexDigit(hex: string, index: number): number {
  const code = hex.charCodeAt(index);
  if (code >= 48 && code <= 57) return code - 48; // '0'..'9'
  if (code >= 97 && code <= 102) return code - 87; // 'a'..'f'
  if (code >= 65 && code <= 70) return code - 55; // 'A'..'F' (defensive)
  return 0;
}
