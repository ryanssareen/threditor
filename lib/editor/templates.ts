import type {
  AffordancePulseTarget,
  TemplateCategory,
  TemplateManifest,
  TemplateMeta,
} from './types';

export const TIMING = {
  CHIP_DELAY_MS: 3500,
  HINT_DELAY_MS: 700,
  HINT_DURATION_MS: 3000,
  PULSE_DELAY_MS: 1000,
  PULSE_DURATION_MS: 600,
  CROSSFADE_MS: 200,
  // M8 Unit 7/8: first-paint sequence. Fires on cold editor-land when
  // no template has been applied. Reuses the same hint/pulse infra.
  FIRST_PAINT_GLOW_MS: 600,
  FIRST_PAINT_PULSE_MS: 1600,
} as const;

const VALID_PULSE_TARGETS = new Set<AffordancePulseTarget>(['color', 'mirror', 'brush', null]);

export function isValidTemplate(raw: unknown): raw is TemplateMeta {
  if (raw === null || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;

  for (const key of ['id', 'label', 'file', 'thumbnail', 'contextualHint'] as const) {
    if (typeof r[key] !== 'string') return false;
  }

  if (r['variant'] !== 'classic' && r['variant'] !== 'slim') return false;
  if (r['license'] !== 'MIT') return false;
  if (r['credit'] !== null && typeof r['credit'] !== 'string') return false;
  if (!Array.isArray(r['tags']) || !r['tags'].every((t) => typeof t === 'string')) return false;

  const pulse = r['affordancePulse'];
  if (!VALID_PULSE_TARGETS.has(pulse as AffordancePulseTarget)) {
    console.warn(`templates: unknown affordancePulse value "${String(pulse)}", will normalize to null`);
  }

  return true;
}

export function normalizeTemplate(raw: unknown): TemplateMeta | null {
  if (!isValidTemplate(raw)) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  const pulse = r.affordancePulse as AffordancePulseTarget;
  const normalizedPulse: AffordancePulseTarget = VALID_PULSE_TARGETS.has(pulse) ? pulse : null;

  return {
    id: r.id as string,
    label: r.label as string,
    variant: r.variant as 'classic' | 'slim',
    file: r.file as string,
    thumbnail: r.thumbnail as string,
    license: 'MIT',
    credit: r.credit as string | null,
    tags: r.tags as string[],
    contextualHint: r.contextualHint as string,
    affordancePulse: normalizedPulse,
  };
}

export async function loadManifest(): Promise<TemplateManifest> {
  const empty: TemplateManifest = { version: 1, categories: [] };

  let data: unknown;
  try {
    const res = await fetch('/templates/manifest.json', { cache: 'force-cache' });
    if (!res.ok) {
      console.warn(`templates: manifest fetch failed with status ${res.status}`);
      return empty;
    }
    data = await res.json();
  } catch (err) {
    console.warn('templates: failed to fetch or parse manifest', err);
    return empty;
  }

  if (data === null || typeof data !== 'object') {
    console.warn('templates: manifest is not an object');
    return empty;
  }

  const manifest = data as Record<string, unknown>;

  if (manifest['version'] !== 1) {
    console.warn(`templates: unsupported manifest version "${String(manifest['version'])}"`);
    return empty;
  }

  if (!Array.isArray(manifest['categories'])) {
    console.warn('templates: manifest.categories is not an array');
    return empty;
  }

  const categories: TemplateCategory[] = [];

  for (const rawCat of manifest['categories'] as unknown[]) {
    if (rawCat === null || typeof rawCat !== 'object') continue;
    const cat = rawCat as Record<string, unknown>;

    if (typeof cat['id'] !== 'string' || typeof cat['label'] !== 'string') continue;
    if (!Array.isArray(cat['templates'])) continue;

    const templates: TemplateMeta[] = [];
    for (const rawTpl of cat['templates'] as unknown[]) {
      const normalized = normalizeTemplate(rawTpl);
      if (normalized !== null) {
        templates.push(normalized);
      } else {
        console.warn('templates: skipping invalid template entry', rawTpl);
      }
    }

    if (templates.length > 0) {
      categories.push({ id: cat['id'] as string, label: cat['label'] as string, templates });
    }
  }

  return { version: 1, categories };
}

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function getScratchCtx(): CanvasRenderingContext2D {
  if (scratchCtx === null) {
    scratchCanvas = document.createElement('canvas');
    scratchCanvas.width = 64;
    scratchCanvas.height = 64;
    const ctx = scratchCanvas.getContext('2d');
    if (ctx === null) throw new Error('template decode: failed to get 2d context');
    scratchCtx = ctx;
  }
  return scratchCtx;
}

const decodeCache = new Map<string, Uint8ClampedArray>();

export async function decodeTemplatePng(url: string): Promise<Uint8ClampedArray> {
  const cached = decodeCache.get(url);
  if (cached !== undefined) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`template decode: fetch failed for ${url} (${res.status})`);

  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);

  const ctx = getScratchCtx();
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(bitmap, 0, 0);

  const imageData = ctx.getImageData(0, 0, 64, 64);
  const expected = 64 * 64 * 4;
  if (imageData.data.length !== expected) {
    throw new Error('template decode: bad dimensions');
  }

  const buffer = new Uint8ClampedArray(imageData.data);
  decodeCache.set(url, buffer);
  return buffer;
}

export function clearDecodeCache(): void {
  decodeCache.clear();
  scratchCanvas = null;
  scratchCtx = null;
}
