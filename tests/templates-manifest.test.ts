import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadManifest, isValidTemplate, normalizeTemplate } from '../lib/editor/templates';
import validManifest from './fixtures/valid-manifest.json';

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

function makeFetch404(): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 404,
    json: () => Promise.reject(new Error('not json')),
  } as unknown as Response);
}

describe('loadManifest', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: fixture manifest parses cleanly with all entries present', async () => {
    vi.stubGlobal('fetch', makeFetchOk(validManifest));

    const manifest = await loadManifest();

    expect(manifest.version).toBe(1);
    expect(manifest.categories).toHaveLength(4);

    const safeWins = manifest.categories.find((c) => c.id === 'safe-wins');
    expect(safeWins).toBeDefined();
    expect(safeWins!.templates).toHaveLength(2);

    const technique = manifest.categories.find((c) => c.id === 'technique');
    expect(technique).toBeDefined();
    expect(technique!.templates).toHaveLength(1);

    const identity = manifest.categories.find((c) => c.id === 'identity');
    expect(identity).toBeDefined();
    expect(identity!.templates).toHaveLength(1);

    const base = manifest.categories.find((c) => c.id === 'base');
    expect(base).toBeDefined();
    expect(base!.templates).toHaveLength(1);
  });

  it('fetch uses cache: force-cache option', async () => {
    const spy = makeFetchOk(validManifest);
    vi.stubGlobal('fetch', spy);

    await loadManifest();

    expect(spy).toHaveBeenCalledWith('/templates/manifest.json', { cache: 'force-cache' });
  });

  it('validator edge: template missing variant is skipped', async () => {
    const badManifest = {
      version: 1,
      categories: [
        {
          id: 'test-cat',
          label: 'Test',
          templates: [
            {
              id: 'no-variant',
              label: 'No Variant',
              file: '/templates/classic/no-variant.png',
              thumbnail: '/templates/thumbs/no-variant.webp',
              license: 'MIT',
              credit: null,
              tags: [],
              contextualHint: 'hint',
            },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', makeFetchOk(badManifest));

    const manifest = await loadManifest();
    expect(manifest.categories).toHaveLength(0);
  });

  it('validator edge: invalid affordancePulse falls back to null (template kept)', async () => {
    const manifestWithBadPulse = {
      version: 1,
      categories: [
        {
          id: 'test-cat',
          label: 'Test',
          templates: [
            {
              id: 'bad-pulse',
              label: 'Bad Pulse',
              variant: 'classic',
              file: '/templates/classic/bad-pulse.png',
              thumbnail: '/templates/thumbs/bad-pulse.webp',
              license: 'MIT',
              credit: null,
              tags: [],
              contextualHint: 'hint',
              affordancePulse: 'invalid-target',
            },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', makeFetchOk(manifestWithBadPulse));

    const manifest = await loadManifest();
    expect(manifest.categories).toHaveLength(1);
    expect(manifest.categories[0].templates).toHaveLength(1);
    expect(manifest.categories[0].templates[0].affordancePulse).toBeNull();
  });

  it('validator edge: category with zero valid templates is dropped', async () => {
    const manifestWithEmptyCat = {
      version: 1,
      categories: [
        {
          id: 'empty-cat',
          label: 'Empty',
          templates: [
            {
              id: 'invalid',
              label: 'No Variant',
              file: '/templates/classic/x.png',
              thumbnail: '/templates/thumbs/x.webp',
              license: 'MIT',
              credit: null,
              tags: [],
              contextualHint: 'hint',
            },
          ],
        },
        {
          id: 'good-cat',
          label: 'Good',
          templates: [
            {
              id: 'valid-one',
              label: 'Valid',
              variant: 'classic',
              file: '/templates/classic/valid.png',
              thumbnail: '/templates/thumbs/valid.webp',
              license: 'MIT',
              credit: null,
              tags: [],
              contextualHint: 'hint',
              affordancePulse: null,
            },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', makeFetchOk(manifestWithEmptyCat));

    const manifest = await loadManifest();
    expect(manifest.categories).toHaveLength(1);
    expect(manifest.categories[0].id).toBe('good-cat');
  });

  it('validator edge: unknown keys in template/category/top-level are ignored silently', async () => {
    const manifestWithUnknownKeys = {
      version: 1,
      unknownTopLevel: 'ignored',
      categories: [
        {
          id: 'test-cat',
          label: 'Test',
          unknownCategoryKey: true,
          templates: [
            {
              id: 'tpl1',
              label: 'Template 1',
              variant: 'slim',
              file: '/templates/slim/tpl1.png',
              thumbnail: '/templates/thumbs/tpl1.webp',
              license: 'MIT',
              credit: null,
              tags: ['tag1'],
              contextualHint: 'hint',
              affordancePulse: 'mirror',
              unknownTemplateKey: 42,
            },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', makeFetchOk(manifestWithUnknownKeys));

    const manifest = await loadManifest();
    expect(manifest.categories).toHaveLength(1);
    expect(manifest.categories[0].templates).toHaveLength(1);
    expect(manifest.categories[0].templates[0].id).toBe('tpl1');
  });

  it('validator edge: empty categories array returns empty catalog without error', async () => {
    vi.stubGlobal('fetch', makeFetchOk({ version: 1, categories: [] }));

    const manifest = await loadManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.categories).toHaveLength(0);
  });

  it('fetch 404 returns empty catalog and logs a warning', async () => {
    vi.stubGlobal('fetch', makeFetch404());

    const manifest = await loadManifest();
    expect(manifest).toEqual({ version: 1, categories: [] });
    expect(console.warn).toHaveBeenCalled();
  });

  it('fetch resolves to invalid JSON returns empty catalog and logs a warning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as unknown as Response),
    );

    const manifest = await loadManifest();
    expect(manifest).toEqual({ version: 1, categories: [] });
    expect(console.warn).toHaveBeenCalled();
  });

  it('manifest.version !== 1 returns empty catalog', async () => {
    vi.stubGlobal('fetch', makeFetchOk({ version: 2, categories: [] }));

    const manifest = await loadManifest();
    expect(manifest).toEqual({ version: 1, categories: [] });
    expect(console.warn).toHaveBeenCalled();
  });

  it('safe-wins category parses correctly from fixture', async () => {
    vi.stubGlobal('fetch', makeFetchOk(validManifest));
    const manifest = await loadManifest();
    const cat = manifest.categories.find((c) => c.id === 'safe-wins')!;
    expect(cat.label).toBe('Safe Wins');
    expect(cat.templates[0].affordancePulse).toBe('color');
    expect(cat.templates[1].affordancePulse).toBe('mirror');
  });

  it('technique category parses correctly from fixture', async () => {
    vi.stubGlobal('fetch', makeFetchOk(validManifest));
    const manifest = await loadManifest();
    const cat = manifest.categories.find((c) => c.id === 'technique')!;
    expect(cat.label).toBe('Technique');
    expect(cat.templates[0].affordancePulse).toBe('brush');
  });

  it('identity category parses correctly from fixture', async () => {
    vi.stubGlobal('fetch', makeFetchOk(validManifest));
    const manifest = await loadManifest();
    const cat = manifest.categories.find((c) => c.id === 'identity')!;
    expect(cat.label).toBe('Identity');
    expect(cat.templates[0].affordancePulse).toBeNull();
  });

  it('base category parses correctly from fixture', async () => {
    vi.stubGlobal('fetch', makeFetchOk(validManifest));
    const manifest = await loadManifest();
    const cat = manifest.categories.find((c) => c.id === 'base')!;
    expect(cat.label).toBe('Base');
    expect(cat.templates[0].id).toBe('base-steve');
  });
});

describe('isValidTemplate', () => {
  it('returns true for a valid template', () => {
    expect(
      isValidTemplate({
        id: 'x',
        label: 'X',
        variant: 'classic',
        file: '/f.png',
        thumbnail: '/t.webp',
        license: 'MIT',
        credit: null,
        tags: [],
        contextualHint: 'hint',
        affordancePulse: null,
      }),
    ).toBe(true);
  });

  it('returns false when a required string field is missing', () => {
    expect(
      isValidTemplate({
        label: 'X',
        variant: 'classic',
        file: '/f.png',
        thumbnail: '/t.webp',
        license: 'MIT',
        credit: null,
        tags: [],
        contextualHint: 'hint',
        affordancePulse: null,
      }),
    ).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(isValidTemplate(null)).toBe(false);
    expect(isValidTemplate(42)).toBe(false);
    expect(isValidTemplate('string')).toBe(false);
  });
});

describe('normalizeTemplate', () => {
  it('normalizes invalid affordancePulse to null', () => {
    const result = normalizeTemplate({
      id: 'x',
      label: 'X',
      variant: 'classic',
      file: '/f.png',
      thumbnail: '/t.webp',
      license: 'MIT',
      credit: null,
      tags: [],
      contextualHint: 'hint',
      affordancePulse: 'invalid-target',
    });
    expect(result).not.toBeNull();
    expect(result!.affordancePulse).toBeNull();
  });

  it('returns null for invalid template', () => {
    expect(normalizeTemplate({ id: 'x' })).toBeNull();
  });
});
