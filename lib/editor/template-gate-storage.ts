/**
 * M7 Unit 5: localStorage wrapper for the `templates-dismissed` flag.
 *
 * Fail-soft: any read exception returns false (treat as not-dismissed).
 * Any write exception is silently swallowed so a full storage quota
 * doesn't crash the editor.
 */

const KEY = 'templates-dismissed';

export function readDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDismissed(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Quota exceeded or storage unavailable — accept the loss gracefully.
  }
}
