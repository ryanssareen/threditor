// @vitest-environment jsdom
/**
 * M7 Unit 6 — TemplateBottomSheet component tests.
 *
 * Exercises: card rendering, card click, backdrop click, Esc key,
 * × button behavior per source, ARIA attributes, and Tab focus trap.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplateBottomSheet } from '../app/editor/_components/TemplateBottomSheet';
import type { TemplateManifest, TemplateMeta } from '../lib/editor/types';

// @ts-expect-error — jsdom-react environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ─── Fixture data ─────────────────────────────────────────────────────────

function makeMeta(id: string): TemplateMeta {
  return {
    id,
    label: `Template ${id}`,
    variant: 'classic',
    file: `/templates/${id}.png`,
    thumbnail: `/templates/thumbs/${id}.webp`,
    license: 'MIT',
    credit: null,
    tags: [],
    contextualHint: 'Try painting the head!',
    affordancePulse: null,
  };
}

const FIXTURE_MANIFEST: TemplateManifest = {
  version: 1,
  categories: [
    {
      id: 'casual',
      label: 'Casual',
      templates: [makeMeta('hoodie'), makeMeta('tee'), makeMeta('jacket')],
    },
    {
      id: 'fantasy',
      label: 'Fantasy',
      templates: [makeMeta('wizard'), makeMeta('knight')],
    },
  ],
};

// ─── Mount helpers ────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

type SheetProps = {
  manifest?: TemplateManifest | null;
  source?: 'ghost' | 'menu';
  onSelect?: (t: TemplateMeta) => void;
  onCloseTransient?: () => void;
  onClosePersistent?: () => void;
};

async function mountSheet({
  manifest = FIXTURE_MANIFEST,
  source = 'ghost',
  onSelect = () => {},
  onCloseTransient = () => {},
  onClosePersistent = () => {},
}: SheetProps = {}): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      createElement(TemplateBottomSheet, {
        manifest,
        source,
        onSelect,
        onCloseTransient,
        onClosePersistent,
      }),
    );
  });
}

async function unmount(): Promise<void> {
  await act(async () => { root.unmount(); });
  document.body.removeChild(container);
}

function $q(testid: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function pressKey(key: string): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('TemplateBottomSheet', () => {
  afterEach(async () => {
    try { await unmount(); } catch { /* already unmounted */ }
    vi.restoreAllMocks();
  });

  it('renders template cards from the first category', async () => {
    await mountSheet();
    expect($q('template-card-hoodie')).not.toBeNull();
    expect($q('template-card-tee')).not.toBeNull();
    expect($q('template-card-jacket')).not.toBeNull();
  });

  it('clicking a template card fires onSelect with the template', async () => {
    const onSelect = vi.fn();
    await mountSheet({ onSelect });
    const card = $q('template-card-hoodie');
    expect(card).not.toBeNull();
    await click(card!);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].id).toBe('hoodie');
  });

  it('clicking the backdrop fires onCloseTransient (not persistent)', async () => {
    const onCloseTransient = vi.fn();
    const onClosePersistent = vi.fn();
    await mountSheet({ onCloseTransient, onClosePersistent });
    const backdrop = $q('template-sheet-backdrop');
    expect(backdrop).not.toBeNull();
    await click(backdrop!);
    expect(onCloseTransient).toHaveBeenCalledOnce();
    expect(onClosePersistent).not.toHaveBeenCalled();
  });

  it('Esc key fires onCloseTransient', async () => {
    const onCloseTransient = vi.fn();
    await mountSheet({ onCloseTransient });
    await pressKey('Escape');
    expect(onCloseTransient).toHaveBeenCalledOnce();
  });

  it('× button with source="ghost" fires onClosePersistent', async () => {
    const onClosePersistent = vi.fn();
    const onCloseTransient = vi.fn();
    await mountSheet({ source: 'ghost', onClosePersistent, onCloseTransient });
    const closeBtn = $q('template-sheet-close');
    expect(closeBtn).not.toBeNull();
    await click(closeBtn!);
    expect(onClosePersistent).toHaveBeenCalledOnce();
    expect(onCloseTransient).not.toHaveBeenCalled();
  });

  it('× button with source="menu" fires onCloseTransient (not persistent)', async () => {
    const onClosePersistent = vi.fn();
    const onCloseTransient = vi.fn();
    await mountSheet({ source: 'menu', onClosePersistent, onCloseTransient });
    const closeBtn = $q('template-sheet-close');
    expect(closeBtn).not.toBeNull();
    await click(closeBtn!);
    expect(onCloseTransient).toHaveBeenCalledOnce();
    expect(onClosePersistent).not.toHaveBeenCalled();
  });

  it('renders role="dialog" and aria-modal="true"', async () => {
    await mountSheet();
    const sheet = $q('template-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet!.getAttribute('role')).toBe('dialog');
    expect(sheet!.getAttribute('aria-modal')).toBe('true');
  });

  it('aria-labelledby points to the title element', async () => {
    await mountSheet();
    const sheet = $q('template-sheet');
    const labelId = sheet!.getAttribute('aria-labelledby');
    expect(labelId).toBe('template-sheet-title');
    const titleEl = document.getElementById(labelId!);
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toContain('Start with a template');
  });

  it('renders skeleton cards when manifest is null', async () => {
    await mountSheet({ manifest: null });
    expect($q('template-card-hoodie')).toBeNull();
    expect($q('template-card-strip')).not.toBeNull();
  });

  it('Tab from last focusable element wraps to first (focus trap)', async () => {
    await mountSheet();
    const sheet = document.querySelector('[data-testid="template-sheet"]') as HTMLElement;
    const FOCUSABLE =
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, textarea, select';
    const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE));
    expect(focusable.length).toBeGreaterThan(1);

    // Focus the last element.
    const last = focusable[focusable.length - 1];
    last.focus();

    // Dispatch Tab from last element — the trap should move focus to first.
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // After Tab from last, focus should wrap to first.
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('category tabs switch the visible templates', async () => {
    await mountSheet();

    // Initially on first tab (casual) — hoodie should be visible.
    expect($q('template-card-hoodie')).not.toBeNull();

    // Click the fantasy tab.
    const fantasyTab = $q('template-tab-fantasy');
    expect(fantasyTab).not.toBeNull();
    await click(fantasyTab!);

    // Wizard card should now be visible; hoodie should not.
    expect($q('template-card-wizard')).not.toBeNull();
    expect($q('template-card-hoodie')).toBeNull();
  });
});
