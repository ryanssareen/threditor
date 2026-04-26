// @vitest-environment node
//
// M16 Unit 4 — /api/ai/generate route.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// ── Hoisted mocks ────────────────────────────────────────────────────

const getServerSessionMock = vi.hoisted(() => vi.fn());
const verifyIdTokenMock = vi.hoisted(() => vi.fn());
const checkAndIncrementMock = vi.hoisted(() => vi.fn());
const refundSlotMock = vi.hoisted(() => vi.fn());
const bumpAggregateTokensMock = vi.hoisted(() => vi.fn());
const logGenerationMock = vi.hoisted(() => vi.fn());
const generateSkinMock = vi.hoisted(() => vi.fn());
const getGroqKeyShapeMock = vi.hoisted(() =>
  vi.fn(() => ({ present: true, length: 32, prefix: 'gsk_' })),
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

vi.mock('@/lib/ai/groq', async () => {
  // Return the real error classes + a mocked generateSkin/getGroqKeyShape.
  const actual = await vi.importActual<typeof import('@/lib/ai/groq')>('@/lib/ai/groq');
  return {
    ...actual,
    generateSkin: generateSkinMock,
    getGroqKeyShape: getGroqKeyShapeMock,
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
  getServerSessionMock.mockResolvedValue({ uid: 'user-1' });
  checkAndIncrementMock.mockResolvedValue(allowedGate());
  generateSkinMock.mockResolvedValue(solidResponse());
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
    expect(entry.tokensIn).toBe(500);
    expect(entry.tokensOut).toBe(1500);
    expect(entry.costEstimate).toBeGreaterThan(0);
    expect(bumpAggregateTokensMock).toHaveBeenCalledWith(2000);
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
