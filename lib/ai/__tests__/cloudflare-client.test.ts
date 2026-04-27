// @vitest-environment node
//
// M17 Unit 4 — Cloudflare worker fetch wrapper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('server-only', () => ({}));

import {
  CloudflareAbortedError,
  CloudflareAuthError,
  CloudflareEnvError,
  CloudflareRateLimitError,
  CloudflareTimeoutError,
  CloudflareUpstreamError,
} from '../cloudflare-errors';
import { ImageProcessingError } from '../cloudflare-errors';
import {
  CLOUDFLARE_MODEL_ID,
  generateSkinFromCloudflare,
  getCloudflareEnvShape,
} from '../cloudflare-client';

const VALID_URL = 'https://ai-skin-generator.example.workers.dev';
const VALID_TOKEN = 'test-token-32-chars-aaaaaaaaaaaa';

async function solidPngBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 30, g: 60, b: 90, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

function pngResponse(buf: Buffer, status = 200): Response {
  return new Response(new Uint8Array(buf), {
    status,
    headers: { 'Content-Type': 'image/png' },
  });
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('CLOUDFLARE_WORKER_URL', VALID_URL);
  vi.stubEnv('CLOUDFLARE_WORKER_TOKEN', VALID_TOKEN);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ── env diagnostic ────────────────────────────────────────────────

describe('getCloudflareEnvShape', () => {
  it('reports both vars present + URL hostname when set correctly', () => {
    const shape = getCloudflareEnvShape();
    expect(shape.workerUrlShape.present).toBe(true);
    expect(shape.workerUrlShape.hostname).toBe('ai-skin-generator.example.workers.dev');
    expect(shape.tokenShape.present).toBe(true);
    expect(shape.tokenShape).not.toHaveProperty('length');
    expect(shape.tokenShape).not.toHaveProperty('prefix');
  });

  it('reports absent when env is missing', () => {
    vi.stubEnv('CLOUDFLARE_WORKER_URL', '');
    vi.stubEnv('CLOUDFLARE_WORKER_TOKEN', '');
    const shape = getCloudflareEnvShape();
    expect(shape.workerUrlShape.present).toBe(false);
    expect(shape.workerUrlShape).not.toHaveProperty('hostname');
    expect(shape.tokenShape.present).toBe(false);
  });

  it('hostname undefined when URL is unparseable', () => {
    vi.stubEnv('CLOUDFLARE_WORKER_URL', 'not a url');
    const shape = getCloudflareEnvShape();
    expect(shape.workerUrlShape.present).toBe(true);
    expect(shape.workerUrlShape.hostname).toBeUndefined();
  });
});

// ── happy path ────────────────────────────────────────────────────

describe('generateSkinFromCloudflare — happy path', () => {
  it('returns a parsed AISkinResponse with the cloudflare model id', async () => {
    const png = await solidPngBuffer();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pngResponse(png));
    const result = await generateSkinFromCloudflare('a knight', new AbortController().signal);
    expect(result.modelId).toBe(CLOUDFLARE_MODEL_ID);
    expect(result.parsed.palette.length).toBeGreaterThan(0);
    expect(result.parsed.rows).toHaveLength(64);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(VALID_URL);
    expect((calledOpts.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${VALID_TOKEN}`,
    );
    expect((calledOpts.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(JSON.parse(calledOpts.body as string)).toEqual({ prompt: 'a knight' });
  });

  it('threads the AbortSignal to the underlying fetch', async () => {
    const png = await solidPngBuffer();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pngResponse(png));
    const ctrl = new AbortController();
    await generateSkinFromCloudflare('hi', ctrl.signal);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(opts.signal).toBe(ctrl.signal);
  });
});

// ── env errors ────────────────────────────────────────────────────

describe('generateSkinFromCloudflare — env errors', () => {
  it('throws CloudflareEnvError when URL is missing', async () => {
    vi.stubEnv('CLOUDFLARE_WORKER_URL', '');
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareEnvError);
  });

  it('throws CloudflareEnvError when token is missing', async () => {
    vi.stubEnv('CLOUDFLARE_WORKER_TOKEN', '');
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareEnvError);
  });

  it('CloudflareEnvError carries shape diagnostic with no token leakage', async () => {
    vi.stubEnv('CLOUDFLARE_WORKER_URL', '');
    try {
      await generateSkinFromCloudflare('hi', new AbortController().signal);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CloudflareEnvError);
      const shape = (err as CloudflareEnvError).envShape;
      expect(shape.workerUrlShape.present).toBe(false);
      expect(shape.tokenShape).not.toHaveProperty('length');
      expect(shape.tokenShape).not.toHaveProperty('prefix');
    }
  });

  it('throws CloudflareEnvError when URL is not parseable', async () => {
    vi.stubEnv('CLOUDFLARE_WORKER_URL', 'not a url');
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareEnvError);
  });

  it('throws CloudflareEnvError when URL has trailing whitespace', async () => {
    vi.stubEnv('CLOUDFLARE_WORKER_URL', VALID_URL + ' ');
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareEnvError);
  });

  it('throws CloudflareEnvError when token has trailing whitespace', async () => {
    vi.stubEnv('CLOUDFLARE_WORKER_TOKEN', VALID_TOKEN + '\n');
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareEnvError);
  });
});

// ── HTTP error mapping ────────────────────────────────────────────

describe('generateSkinFromCloudflare — HTTP error mapping', () => {
  it('CloudflareAuthError on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareAuthError);
  });

  it('CloudflareRateLimitError on 429 with Retry-After', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'too_many' }, 429, { 'Retry-After': '42' }),
    );
    try {
      await generateSkinFromCloudflare('hi', new AbortController().signal);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CloudflareRateLimitError);
      expect((err as CloudflareRateLimitError).retryAfterSeconds).toBe(42);
    }
  });

  it('CloudflareRateLimitError on 429 without Retry-After defaults to 60', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'too_many' }, 429));
    try {
      await generateSkinFromCloudflare('hi', new AbortController().signal);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as CloudflareRateLimitError).retryAfterSeconds).toBe(60);
    }
  });

  it('CloudflareUpstreamError on 502 with body excerpt', async () => {
    const body = 'a'.repeat(500);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 502 }),
    );
    try {
      await generateSkinFromCloudflare('hi', new AbortController().signal);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CloudflareUpstreamError);
      const e = err as CloudflareUpstreamError;
      expect(e.statusCode).toBe(502);
      expect(e.bodyExcerpt.length).toBeLessThanOrEqual(200);
    }
  });

  it('CloudflareUpstreamError on 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'internal' }, 500));
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareUpstreamError);
  });
});

// ── image-processing failures bubble through ──────────────────────

describe('generateSkinFromCloudflare — image processing failures', () => {
  it('bubbles ImageProcessingError when 200 body is not a valid PNG', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(ImageProcessingError);
  });
});

// ── abort handling ────────────────────────────────────────────────

describe('generateSkinFromCloudflare — abort handling', () => {
  it('CloudflareAbortedError(streamStarted: false) when fetch is aborted before resolving', async () => {
    const ctrl = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      ctrl.abort();
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    try {
      await generateSkinFromCloudflare('hi', ctrl.signal);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CloudflareAbortedError);
      expect((err as CloudflareAbortedError).streamStarted).toBe(false);
    }
  });

  it('CloudflareAbortedError(streamStarted: true) when arrayBuffer aborts after fetch resolves', async () => {
    const ctrl = new AbortController();
    // Build a Response whose arrayBuffer() rejects with AbortError.
    const fakeRes = {
      status: 200,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      body: { cancel: () => Promise.resolve() } as unknown,
      async arrayBuffer(): Promise<ArrayBuffer> {
        ctrl.abort();
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      },
      async text(): Promise<string> {
        return '';
      },
    } as unknown as Response;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(fakeRes);
    try {
      await generateSkinFromCloudflare('hi', ctrl.signal);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CloudflareAbortedError);
      expect((err as CloudflareAbortedError).streamStarted).toBe(true);
    }
  });

  it('CloudflareTimeoutError when fetch fails with TimeoutError name', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const e = new Error('connection timed out');
      e.name = 'TimeoutError';
      throw e;
    });
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareTimeoutError);
  });

  it('CloudflareUpstreamError on unclassified network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(
      generateSkinFromCloudflare('hi', new AbortController().signal),
    ).rejects.toBeInstanceOf(CloudflareUpstreamError);
  });
});
