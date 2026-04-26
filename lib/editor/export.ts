/**
 * M8 Unit 1: PNG export pipeline.
 *
 * Pure module — no React, no zustand. Callers pass the current layers
 * + variant and receive a PNG Blob. A separate `downloadBlob` helper
 * handles the user-facing save (File System Access API when available,
 * anchor-click fallback otherwise).
 *
 * Minecraft PNG gotchas (see docs/plans/m8-export-polish-plan.md for
 * the research trail):
 *
 *   - `canvas.toBlob(cb, 'image/png')` — NO quality arg (silently
 *     ignored per MDN; only honored for image/jpeg and image/webp).
 *   - `getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })`
 *     — Chrome applies a display-color-space conversion if colorSpace
 *     is left implicit, shifting RGB values.
 *   - Transparent regions must encode as alpha=0 AND RGB=0. Some MC
 *     shaders sample RGB even when A=0, producing color fringing.
 *     TextureManager.composite starts with clearRect → all zero bytes,
 *     which is the Minecraft-safe pre-image.
 *   - `toBlob` CALLBACK form preserves Safari's user-gesture chain
 *     through the encode step, so the caller MUST invoke
 *     `exportLayersToBlob` synchronously from inside the click handler
 *     and trigger the anchor click inside the resolved promise. The
 *     `toBlob` method is a canvas method invoked from the handler;
 *     gesture propagates through the callback.
 *
 * The composite path reuses `TextureManager` bound to a throwaway
 * canvas so we inherit the M6 putImageData→scratch→drawImage pipeline
 * with correct opacity and blend-mode handling, without duplicating it.
 */

import { TextureManager } from './texture';
import type { Layer } from './types';
import type { SkinVariant } from './types';
import {
  upscaleCanvasNearestNeighbor,
  type SupportedResolution,
} from './upscale';

const ATLAS_SIZE = 64;

export type { SupportedResolution } from './upscale';

/**
 * Build a throwaway 64×64 canvas configured for Minecraft-safe PNG
 * export: sRGB color space, no smoothing, willReadFrequently for
 * readback if ever needed.
 */
function createExportCanvas(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d', {
    colorSpace: 'srgb',
    willReadFrequently: true,
  });
  if (ctx === null) {
    throw new Error('export: failed to obtain 2D canvas context');
  }
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/**
 * Composite the given layers into an RGBA PNG blob at the requested
 * resolution.
 *
 * Default resolution is 64×64 (Minecraft vanilla standard). When a
 * higher resolution is passed, the composite is nearest-neighbor
 * upscaled before PNG encoding. The editor itself stays 64×64 — HD
 * is a one-shot export artefact, not a persisted asset.
 *
 * Internally instantiates a TextureManager bound to a throwaway canvas
 * (constructor accepts canvas + ctx injections per M6 amendment 1) so
 * the blend-mode and opacity handling stay in one place.
 */
export async function exportLayersToBlob(
  layers: readonly Layer[],
  options: { resolution?: SupportedResolution } = {},
): Promise<Blob> {
  const resolution = options.resolution ?? 64;
  const { canvas, ctx } = createExportCanvas();
  const scratch = createExportCanvas();
  const tm = new TextureManager(canvas, ctx, scratch.canvas, scratch.ctx);
  try {
    tm.composite(layers);
    // At 64×64 we encode the composite canvas directly — keeps the M8
    // Safari user-gesture chain intact and avoids a needless copy.
    // At HD resolutions we run the nearest-neighbor upscaler first;
    // the upscale is synchronous so the `toBlob` call still fires in
    // the same gesture.
    const encodeTarget =
      resolution === 64
        ? canvas
        : upscaleCanvasNearestNeighbor(canvas, resolution);

    return await new Promise<Blob>((resolve, reject) => {
      encodeTarget.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('export: canvas.toBlob produced null'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  } finally {
    tm.dispose();
  }
}

/**
 * Strip/replace filesystem-hostile characters. Colons break Windows,
 * slashes break every POSIX path segment, and C0 control characters
 * are rejected by most file pickers.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[\x00-\x1f]/g, '').replace(/[:\\/]/g, '-');
}

/**
 * Build an export filename.
 *
 * 64×64 exports keep the legacy shape `skin-<variant>-<iso>.png` so
 * existing users' muscle memory is preserved and the default-case
 * file name is unchanged from M8.
 *
 * HD exports append `-<resolution>` before the extension so users
 * who export multiple resolutions of the same skin can tell them
 * apart in their Downloads folder:
 *   `skin-classic-2026-04-22T12-30-45.png`          (64×64)
 *   `skin-classic-2026-04-22T12-30-45-128.png`      (128×128)
 *   `skin-classic-2026-04-22T12-30-45-256.png`      (256×256)
 *   `skin-classic-2026-04-22T12-30-45-512.png`      (512×512)
 */
export function buildExportFilename(
  variant: SkinVariant,
  at: Date = new Date(),
  resolution: SupportedResolution = 64,
): string {
  const iso = at.toISOString().slice(0, 19); // 2026-04-22T12:30:45
  const suffix = resolution === 64 ? '' : `-${resolution}`;
  return sanitizeFilename(`skin-${variant}-${iso}${suffix}.png`);
}

type ShowSaveFilePickerOptions = {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
};

type FileSystemWritableFileStream = {
  write: (data: Blob | ArrayBuffer | string) => Promise<void>;
  close: () => Promise<void>;
};

type FileSystemFileHandle = {
  createWritable: () => Promise<FileSystemWritableFileStream>;
};

type ShowSaveFilePicker = (
  opts?: ShowSaveFilePickerOptions,
) => Promise<FileSystemFileHandle>;

/**
 * Progressive-enhancement download.
 *
 * Chromium ships `showSaveFilePicker` (File System Access API) — UX win
 * because the user picks the destination. Firefox + Safari don't, so
 * we fall back to an anchor-click with `URL.createObjectURL`.
 *
 * Safari gotcha: the caller must invoke this function synchronously
 * inside the click handler; the anchor-click fallback preserves gesture
 * by setting .href + .download before calling .click() in the same
 * microtask chunk.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const w = typeof window === 'undefined' ? null : window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const picker = w !== null ? ((w as any).showSaveFilePicker as ShowSaveFilePicker | undefined) : undefined;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: 'Minecraft Skin PNG',
            accept: { 'image/png': ['.png'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User-cancelled is an AbortError — swallow it without falling
      // back. Any other error means the native path failed; fall back.
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError') return;
      // Fall through to anchor fallback.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on a microtask to let Safari settle the click.
  queueMicrotask(() => URL.revokeObjectURL(url));
}
