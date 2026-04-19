/**
 * M3: IndexedDB-backed auto-save.
 *
 * Subscribes to the editor store, builds a SkinDocument from the current
 * state + caller-supplied Layer, and writes through `idb-keyval` with a
 * 500ms debounce.
 *
 * Also handles:
 *
 *   - Safari Private Browsing (zero-quota) detection at init (plan §D.2).
 *     During the probe window the store's `savingState` is 'pending' —
 *     user edits are accepted; the pending write simply waits. See plan
 *     amendment 5.
 *   - QuotaExceededError on write: transitions `savingState` to
 *     'disabled:quota' (plan §D.7).
 *   - `navigator.storage.persist()` called silently on first successful
 *     probe so the browser upgrades to persistent storage (plan §D.4).
 *   - `beforeunload` flush to reduce (not eliminate) data loss on tab
 *     close. Per amendment 2 this is BEST-EFFORT — see inline comment
 *     before the handler.
 *
 * Usage (call once from EditorLayout):
 *
 *   useEffect(() => {
 *     const cleanup = initPersistence({ getLayer: () => bundle?.layer ?? null });
 *     return cleanup;
 *   }, [bundle]);
 *
 * ViewportUV calls `markDocumentDirty()` after each committed stroke to
 * trigger the debounced save path.
 */

import { get, set } from 'idb-keyval';

import { useEditorStore } from './store';
import type { Layer, SkinDocument } from './types';

const DOC_KEY = 'skin-editor:m3-document';
const PROBE_KEY = 'skin-editor:storage-probe';
const DEBOUNCE_MS = 500;

// Module-scope hook that ViewportUV (and M5 tool commits) call into.
// Installed by `initPersistence`, restored to a no-op on cleanup.
let _scheduleWrite: () => void = () => {};

export function markDocumentDirty(): void {
  _scheduleWrite();
}

export type InitPersistenceParams = {
  /**
   * Accessor for the current in-memory Layer. The Layer is owned by
   * EditorLayout's `useTextureManagerBundle` hook; persistence reads the
   * freshest pixels at flush time via this getter.
   */
  getLayer: () => Layer | null;
};

export type InitPersistenceReturn = () => void;

export function initPersistence({
  getLayer,
}: InitPersistenceParams): InitPersistenceReturn {
  const { setSavingState } = useEditorStore.getState();
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  let probePending = true;
  let dirtyWhilePending = false;
  let disposed = false;

  const buildDocument = (layer: Layer): SkinDocument => {
    const { variant } = useEditorStore.getState();
    const now = Date.now();
    return {
      id: 'm3-default',
      variant,
      layers: [layer],
      activeLayerId: layer.id,
      createdAt: now,
      updatedAt: now,
    };
  };

  const attemptWrite = async (): Promise<void> => {
    if (disposed) return;
    const state = useEditorStore.getState().savingState;
    // During probe: defer. The probe handler re-triggers scheduleWrite if
    // it transitions to 'enabled' (amendment 5).
    if (state === 'pending') {
      dirtyWhilePending = true;
      return;
    }
    // Disabled: drop the pending write silently (amendment 5).
    if (state === 'disabled:private' || state === 'disabled:quota') {
      return;
    }
    const layer = getLayer();
    if (layer === null) return;
    try {
      await set(DOC_KEY, buildDocument(layer));
    } catch (err) {
      const errName =
        typeof err === 'object' && err !== null && 'name' in err
          ? (err as { name: string }).name
          : '';
      if (errName === 'QuotaExceededError') {
        setSavingState('disabled:quota');
      } else {
        // Unknown failure — surface to user + log.
        console.error('persistence: unexpected IDB write failure', err);
        setSavingState('disabled:quota');
      }
    }
  };

  const scheduleWrite = (): void => {
    if (disposed) return;
    if (probePending) {
      dirtyWhilePending = true;
      return;
    }
    if (debounceHandle !== null) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      debounceHandle = null;
      void attemptWrite();
    }, DEBOUNCE_MS);
  };

  // Install the module-scope hook so ViewportUV can fire stroke-commit
  // signals without importing the closure directly.
  _scheduleWrite = scheduleWrite;

  // ── Safari-Private probe + persist() request (amendments 5 + §D.4) ──
  (async () => {
    try {
      await set(PROBE_KEY, 1);
      if (disposed) return;
      probePending = false;
      setSavingState('enabled');
      if (
        typeof navigator !== 'undefined' &&
        navigator.storage !== undefined &&
        typeof navigator.storage.persist === 'function'
      ) {
        void navigator.storage.persist().catch(() => {});
      }
      if (dirtyWhilePending) {
        dirtyWhilePending = false;
        scheduleWrite();
      }
    } catch {
      if (disposed) return;
      probePending = false;
      setSavingState('disabled:private');
      // dirtyWhilePending writes are dropped per amendment 5.
    }
  })();

  // Variant change → persist (the document's variant field changed).
  const unsubscribe = useEditorStore.subscribe((state, prev) => {
    if (state.variant !== prev.variant) scheduleWrite();
  });

  // ── beforeunload flush (amendment 2) ─────────────────────────────────
  //
  // BEST-EFFORT: the IDB transaction is scheduled synchronously but
  // completes asynchronously. The browser may terminate before commit.
  // Users may lose up to the last 500ms of strokes on force-close. This
  // is the standard web-app auto-save tradeoff and is acceptable per M3
  // /ce:plan amendment 2. Do not add retry logic or synchronous-
  // simulation hacks — the tradeoff is intentional.
  const onBeforeUnload = (): void => {
    if (debounceHandle !== null) {
      clearTimeout(debounceHandle);
      debounceHandle = null;
    }
    void attemptWrite();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', onBeforeUnload);
  }

  return (): void => {
    disposed = true;
    unsubscribe();
    if (debounceHandle !== null) clearTimeout(debounceHandle);
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', onBeforeUnload);
    }
    _scheduleWrite = () => {};
  };
}

/**
 * Hydrate a saved SkinDocument from IndexedDB (if any). Call once on app
 * init from EditorLayout; if the returned doc is non-null, rebuild the
 * Layer from `doc.layers[0].pixels`.
 */
export async function loadDocument(): Promise<SkinDocument | null> {
  try {
    const doc = await get<SkinDocument>(DOC_KEY);
    return doc ?? null;
  } catch {
    return null;
  }
}
