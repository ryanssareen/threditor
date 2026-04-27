// @vitest-environment node
//
// M16 Unit 4 + M17 Unit 5 — /api/ai/generate route.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// ── Hoisted mocks ────────────────────────────────────────────────────

const getServerSessionMock = vi.hoisted(() => vi.fn());
const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const checkAndIncrementMock = vi.hoisted(() => vi.fn());
const refundSlotMock = vi.hoisted(() => vi.fn());
const bumpAggregateTokensMock = vi.hoisted(() => vi.fn());
const bumpAggregateCloudflareCallsMock = vi.hoisted(() => vi.fn());
const logGenerationMock = vi.hoisted(() => vi.fn());
const generateSkinMock = vi.hoisted(() => vi.fn());
const getGroqKeyShapeMock = vi.hoisted(() =>
  vi.fn(() => ({ present: true, length: 32, prefix: 'gsk_' })),
);
const generateSkinFromCloudflareMock = vi.hoisted(() => vi.fn());
const getCloudflareEnvShapeMock = vi.hoisted(() =>
  vi.fn(() => ({
    workerUrlShape: { present: true, hostname: 'ai-skin-generator.example.workers.dev' },
    tokenShape: { present: true },
  })),
);

vi.mock('@/lib/firebase/auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/firebase/admin', () => ({
  getAdminFirebase: () => ({
    auth: { verifyIdToken: verifyIdTokenMock },
    db: {},
  }),
}));

vi.mock('@/lib/ai/rate-limit', () => ({
  checkAndIncrement: checkAndIncrementMock,
  refundSlot: refundSlotMock,
  bumpAggregateTokens: bumpAggregateTokensMock,
  bumpAggregateCloudflareCalls: bumpAggregateCloudflareCallsMock,
  hashIp: async (ip: string) => (ip.length > 0 ? 'hashed-ip' : ''),
}));

vi.mock('@/lib/firebase/ai-logs', () => ({
  logGeneration: logGenerationMock,
}));

// Capture the actual classes from the real groq module so `instanceof`
// checks in the route succeed when our mock returns one.
import {
  GroqAbortedError,
  GroqAuthError,
  GroqEnvError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqUpstreamError,
  GroqValidationError,
} from '@/lib/ai/groq';

import {
  CloudflareAbortedError,
  CloudflareAuthError,
  CloudflareEnvError,
  CloudflareRateLimitError,
  CloudflareTimeoutError,
  CloudflareUpstreamError,
  ImageProcessingError,
} from '@/lib/ai/cloudflare-errors';

vi.mock('@/lib/ai/groq', async () => {
  // Return the real error classes + a mocked generateSkin/getGroqKeyShape.
  const actual = await vi.importActual<typeof import('@/lib/ai/groq')>('@/lib/ai/groq');
  return {
    ...actual,
    generateSkin: generateSkinMock,
    getGroqKeyShape: getGroqKeyShapeMock,
  };
});

vi.mock('@/lib/ai/cloudflare-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/cloudflare-client')>(
    '@/lib/ai/cloudflare-client',
  );
  return {
    ...actual,
    generateSkinFromCloudflare: generateSkinFromCloudflareMock,
    getCloudflareEnvShape: getCloudflareEnvShapeMock,
  };
});

import { POST } from '../route';

// ── Helpers ──────────────────────────────────────────────────────────

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/ai/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function solidResponse() {
  return {
    parsed: {
      palette: ['#aabbcc'],
      rows: Array.from({ length: 64 }, () => [[0, 64]]),
    },
    finishReason: 'stop',
    promptTokens: 500,
    completionTokens: 1500,
    totalTokens: 2000,
    retryCount: 0 as const,
  };
}

function solidCloudflareResponse() {
  return {
    parsed: {
      palette: ['#112233'],
      rows: Array.from({ length: 64 }, () => [[0, 64]]),
    },
    durationMs: 1234,
    modelId: 'cf/sdxl-lightning' as const,
  };
}

function allowedGate() {
  return {
    allowed: true,
    remainingHour: 4,
    remainingDay: 29,
    refundDocs: { user: 'u_2026', userDay: 'u_day_2026', ip: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  // Default to groq provider for the existing M16 test pass.
  vi.stubEnv('AI_PROVIDER', 'groq');
  getServerSessionMock.mockResolvedValue({ uid: 'user-1' });
  checkAndIncrementMock.mockResolvedValue(allowedGate());
  generateSkinMock.mockResolvedValue(solidResponse());
  generateSkinFromCloudflareMock.mockResolvedValue(solidCloudflareResponse());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Happy paths ──────────────────────────────────────────────────────

describe('POST /api/ai/generate — happy paths', () => {
  it('returns 200 with palette + rows for a valid prompt', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'a knight' }) as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.palette).toEqual(['#aabbcc']);
    expect(data.rows).toHaveLength(64);
    expect(generateSkinMock).toHaveBeenCalledTimes(1);
    expect(generateSkinMock.mock.calls[0][0]).toBe('a knight');
  });

  it('logs success with cost estimate and bumps aggregate tokens', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(makeReq({ prompt: 'a knight' }) as any);
    expect(logGenerationMock).toHaveBeenCalledTimes(1);
    const entry = logGenerationMock.mock.calls[0][0];
    expect(entry.success).toBe(true);
    expect(entry.provider).toBe('groq');
    expect(entry.tokensIn).toBe(500);
    expect(entry.tokensOut).toBe(1500);
    expect(entry.costEstimate).toBeGreaterThan(0);
    expect(bumpAggregateTokensMock).toHaveBeenCalledWith(2000);
    expect(bumpAggregateCloudflareCallsMock).not.toHaveBeenCalled();
  });

  it('sets Cache-Control: private, no-store, no-cache, must-revalidate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'a knight' }) as any);
    expect(res.headers.get('cache-control')).toBe(
      'private, no-store, no-cache, must-revalidate',
    );
  });

  it('Bearer-token auth path works when present', async () => {
    getServerSessionMock.mockResolvedValue(null);
    verifyIdTokenMock.mockResolvedValue({ uid: 'user-bearer' });
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ prompt: 'a knight' }, { authorization: 'Bearer abc.def.ghi' }) as any,
    );
    expect(res.status).toBe(200);
    expect(verifyIdTokenMock).toHaveBeenCalledWith('abc.def.ghi', true);
    // Rate limiter receives the bearer-derived uid.
    const arg = checkAndIncrementMock.mock.calls[0][0];
    expect(arg.uid).toBe('user-bearer');
  });

  it('accepts emoji prompts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: '🦄 a unicorn' }) as any);
    expect(res.status).toBe(200);
  });

  it('accepts CJK prompts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: '忍者 ninja' }) as any);
    expect(res.status).toBe(200);
  });

  it('accepts accented prompts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'café au lait' }) as any);
    expect(res.status).toBe(200);
  });

  it('hashes IP from x-forwarded-for and threads to rate-limit', async () => {
    await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ prompt: 'hi' }, { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }) as any,
    );
    const arg = checkAndIncrementMock.mock.calls[0][0];
    expect(arg.ipHash).toBe('hashed-ip');
  });
});

// ── Prompt validation ───────────────────────────────────────────────

describe('POST /api/ai/generate — prompt validation', () => {
  it('400 prompt_invalid/required when prompt missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({}) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('prompt_invalid');
    expect(data.details.reason).toBe('required');
    expect(checkAndIncrementMock).not.toHaveBeenCalled();
  });

  it('400 prompt_invalid/too_long for >200 chars', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'x'.repeat(201) }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details.reason).toBe('too_long');
  });

  it('400 prompt_invalid/empty for whitespace-only', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: '   \t\n' }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details.reason).toBe('empty');
  });

  it('400 prompt_invalid/invalid_chars for control byte BEL', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi\x07there' }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details.reason).toBe('invalid_chars');
  });

  it('400 prompt_invalid/invalid_chars for ESC', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi\x1bhere' }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details.reason).toBe('invalid_chars');
  });

  it('400 prompt_invalid/invalid_chars for bidi-override U+202E', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hello‮world' }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details.reason).toBe('invalid_chars');
  });

  it('400 prompt_invalid/invalid_chars for NULL byte', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi\x00there' }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details.reason).toBe('invalid_chars');
  });

  it('400 prompt_invalid/unicode_form for non-NFKC input', async () => {
    // U+FF21 (FULLWIDTH LATIN A) → "A" under NFKC. Sending the
    // fullwidth form means input !== input.normalize('NFKC').
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'ＡＢＣ' }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details.reason).toBe('unicode_form');
  });

  it('400 on non-string prompt', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 42 }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details.reason).toBe('required');
  });

  it('400 on body that is not JSON', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq('not json') as any);
    expect(res.status).toBe(400);
  });
});

// ── Auth ─────────────────────────────────────────────────────────────

describe('POST /api/ai/generate — auth', () => {
  it('401 when no session and no bearer', async () => {
    getServerSessionMock.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('unauthorized');
    expect(checkAndIncrementMock).not.toHaveBeenCalled();
    expect(generateSkinMock).not.toHaveBeenCalled();
  });

  it('401 when bearer is invalid AND session is absent', async () => {
    getServerSessionMock.mockResolvedValue(null);
    verifyIdTokenMock.mockRejectedValue(new Error('bad token'));
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ prompt: 'hi' }, { authorization: 'Bearer bogus' }) as any,
    );
    expect(res.status).toBe(401);
  });

  it('falls back to cookie session when bearer fails', async () => {
    verifyIdTokenMock.mockRejectedValue(new Error('bad token'));
    getServerSessionMock.mockResolvedValue({ uid: 'user-cookie' });
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeReq({ prompt: 'hi' }, { authorization: 'Bearer bogus' }) as any,
    );
    expect(res.status).toBe(200);
    expect(checkAndIncrementMock.mock.calls[0][0].uid).toBe('user-cookie');
  });
});

// ── Rate limit ───────────────────────────────────────────────────────

describe('POST /api/ai/generate — rate limit', () => {
  it('429 with reason hour when hour bucket is full', async () => {
    checkAndIncrementMock.mockResolvedValue({
      allowed: false,
      reason: 'hour',
      resetAt: 1234567890,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe('rate_limited');
    expect(data.reason).toBe('hour');
    expect(generateSkinMock).not.toHaveBeenCalled();
  });

  it('429 with reason day when day bucket is full', async () => {
    checkAndIncrementMock.mockResolvedValue({
      allowed: false,
      reason: 'day',
      resetAt: 1234567890,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.reason).toBe('day');
  });

  it('503 service_paused when aggregate kill-switch trips', async () => {
    checkAndIncrementMock.mockResolvedValue({
      allowed: false,
      reason: 'aggregate',
      resetAt: 1234567890,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('service_paused');
  });

  it('503 service_unavailable when rate-limit transaction throws', async () => {
    checkAndIncrementMock.mockRejectedValue(new Error('firestore down'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(503);
    expect(generateSkinMock).not.toHaveBeenCalled();
  });
});

// ── Groq error mapping ───────────────────────────────────────────────

describe('POST /api/ai/generate — Groq error mapping', () => {
  it('500 service_misconfigured + envKeyShape on GroqEnvError', async () => {
    generateSkinMock.mockRejectedValue(
      new GroqEnvError({ present: false, length: 0, prefix: '' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('service_misconfigured');
    expect(data.debug.envKeyShape).toBeDefined();
    expect(data.debug.envKeyShape).not.toHaveProperty('value');
  });

  it('500 service_misconfigured on GroqAuthError', async () => {
    generateSkinMock.mockRejectedValue(new GroqAuthError());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('service_misconfigured');
  });

  it('429 + Retry-After on GroqRateLimitError', async () => {
    generateSkinMock.mockRejectedValue(new GroqRateLimitError(42));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    const data = await res.json();
    expect(data.error).toBe('rate_limited');
  });

  it('504 timeout on GroqTimeoutError', async () => {
    generateSkinMock.mockRejectedValue(new GroqTimeoutError());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(504);
    const data = await res.json();
    expect(data.error).toBe('timeout');
  });

  it('499 + refund slot on GroqAbortedError with !streamStarted', async () => {
    generateSkinMock.mockRejectedValue(new GroqAbortedError(false));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(499);
    expect(refundSlotMock).toHaveBeenCalledTimes(1);
  });

  it('499 + NO refund on GroqAbortedError with streamStarted=true', async () => {
    generateSkinMock.mockRejectedValue(new GroqAbortedError(true));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(499);
    expect(refundSlotMock).not.toHaveBeenCalled();
  });

  it('422 generation_invalid on GroqValidationError', async () => {
    generateSkinMock.mockRejectedValue(
      new GroqValidationError('palette_index_oor', 'stop', '{...}'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('generation_invalid');
    // The user-facing response must NOT leak the prompt or stack.
    expect(data).not.toHaveProperty('prompt');
    expect(data).not.toHaveProperty('stack');
    // Log entry has the validation category.
    const entry = logGenerationMock.mock.calls[0][0];
    expect(entry.validationFailureCategory).toBe('palette_index_oor');
  });

  it('502 service_unavailable on GroqUpstreamError', async () => {
    generateSkinMock.mockRejectedValue(new GroqUpstreamError('500 from groq'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(502);
  });

  it('500 on completely unknown error', async () => {
    generateSkinMock.mockRejectedValue(new Error('???'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(500);
  });
});

// ── Cloudflare provider — happy paths ────────────────────────────────

describe('POST /api/ai/generate — Cloudflare provider happy paths', () => {
  beforeEach(() => {
    vi.stubEnv('AI_PROVIDER', 'cloudflare');
  });

  it('routes to Cloudflare path and returns its parsed response', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'a knight' }) as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.palette).toEqual(['#112233']);
    expect(data.rows).toHaveLength(64);
    expect(generateSkinFromCloudflareMock).toHaveBeenCalledTimes(1);
    expect(generateSkinFromCloudflareMock.mock.calls[0][0]).toBe('a knight');
    // Groq path should NOT have been called.
    expect(generateSkinMock).not.toHaveBeenCalled();
  });

  it('records provider=cloudflare and model=cf/sdxl-lightning on success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(makeReq({ prompt: 'a knight' }) as any);
    const entry = logGenerationMock.mock.calls[0][0];
    expect(entry.provider).toBe('cloudflare');
    expect(entry.model).toBe('cf/sdxl-lightning');
    expect(entry.success).toBe(true);
    // Tokens are null on the Cloudflare path (not 0 — distinguishes
    // from a "ran but consumed nothing" Groq call).
    expect(entry.tokensIn).toBeNull();
    expect(entry.tokensOut).toBeNull();
    // Cost is 0 for cloudflare.
    expect(entry.costEstimate).toBe(0);
  });

  it('bumps aggregate cloudflare call counter (not token counter)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(makeReq({ prompt: 'hi' }) as any);
    expect(bumpAggregateCloudflareCallsMock).toHaveBeenCalledWith(1);
    expect(bumpAggregateTokensMock).not.toHaveBeenCalled();
  });

  it('falls back to groq when AI_PROVIDER is unset (safe default)', async () => {
    vi.stubEnv('AI_PROVIDER', '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(makeReq({ prompt: 'hi' }) as any);
    expect(generateSkinMock).toHaveBeenCalledTimes(1);
    expect(generateSkinFromCloudflareMock).not.toHaveBeenCalled();
  });

  it('treats unknown AI_PROVIDER values as groq (safe default)', async () => {
    vi.stubEnv('AI_PROVIDER', 'mystery');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(makeReq({ prompt: 'hi' }) as any);
    expect(generateSkinMock).toHaveBeenCalledTimes(1);
    expect(generateSkinFromCloudflareMock).not.toHaveBeenCalled();
  });

  it('still passes through prompt validation, auth, and rate limit', async () => {
    getServerSessionMock.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(401);
    expect(generateSkinFromCloudflareMock).not.toHaveBeenCalled();
  });
});

// ── Cloudflare provider — error mapping ──────────────────────────────

describe('POST /api/ai/generate — Cloudflare provider error mapping', () => {
  beforeEach(() => {
    vi.stubEnv('AI_PROVIDER', 'cloudflare');
  });

  it('500 service_misconfigured on CloudflareEnvError, NO debug body', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(
      new CloudflareEnvError({
        workerUrlShape: { present: false },
        tokenShape: { present: false },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('service_misconfigured');
    // Cloudflare env errors must NOT include `debug` in the user-
    // facing body — operator reads diagnostic from server logs.
    expect(data).not.toHaveProperty('debug');
  });

  it('500 service_misconfigured on CloudflareAuthError', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(new CloudflareAuthError());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('service_misconfigured');
    expect(data).not.toHaveProperty('debug');
  });

  it('429 + Retry-After on CloudflareRateLimitError', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(new CloudflareRateLimitError(42));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    const data = await res.json();
    expect(data.error).toBe('rate_limited');
    expect(data.reason).toBe('aggregate');
  });

  it('504 on CloudflareTimeoutError', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(new CloudflareTimeoutError());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(504);
    const data = await res.json();
    expect(data.error).toBe('timeout');
  });

  it('499 + refund slot on CloudflareAbortedError(streamStarted: false)', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(
      new CloudflareAbortedError(false),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(499);
    expect(refundSlotMock).toHaveBeenCalledTimes(1);
  });

  it('499 + NO refund on CloudflareAbortedError(streamStarted: true) — Neurons billed', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(
      new CloudflareAbortedError(true),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(499);
    expect(refundSlotMock).not.toHaveBeenCalled();
  });

  it('502 service_unavailable on CloudflareUpstreamError', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(
      new CloudflareUpstreamError(500, 'oops'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe('service_unavailable');
  });

  it('422 generation_invalid on ImageProcessingError, with category logged', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(
      new ImageProcessingError('quantize_failed', 'palette empty'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeReq({ prompt: 'hi' }) as any);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('generation_invalid');
    // No prompt/stack leakage.
    expect(data).not.toHaveProperty('prompt');
    expect(data).not.toHaveProperty('stack');
    // Log entry has the validation-failure category.
    const entry = logGenerationMock.mock.calls[0][0];
    expect(entry.validationFailureCategory).toBe('quantize_failed');
    expect(entry.error).toBe('generation_invalid');
    expect(entry.provider).toBe('cloudflare');
  });

  it('Cloudflare error log entries record provider=cloudflare', async () => {
    generateSkinFromCloudflareMock.mockRejectedValue(new CloudflareUpstreamError(500, 'x'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(makeReq({ prompt: 'hi' }) as any);
    const entry = logGenerationMock.mock.calls[0][0];
    expect(entry.provider).toBe('cloudflare');
    expect(entry.model).toBe('cf/sdxl-lightning');
    expect(entry.success).toBe(false);
    expect(entry.tokensIn).toBeNull();
    expect(entry.tokensOut).toBeNull();
  });

  it('rate-limit slot is burned exactly once across both providers', async () => {
    // Cloudflare path: aborted-after-stream-started → slot burned (no refund).
    generateSkinFromCloudflareMock.mockRejectedValue(new CloudflareAbortedError(true));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(makeReq({ prompt: 'hi' }) as any);
    expect(refundSlotMock).not.toHaveBeenCalled();
    expect(checkAndIncrementMock).toHaveBeenCalledTimes(1);
  });
});
