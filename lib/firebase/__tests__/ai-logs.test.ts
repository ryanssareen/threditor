// @vitest-environment node
//
// M16 Unit 3 — /aiGenerations log writer.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const setMock = vi.hoisted(() => vi.fn());
const docMock = vi.hoisted(() =>
  vi.fn(() => ({
    id: 'gen-doc-id',
    set: setMock,
  })),
);

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
  },
  Timestamp: {
    fromMillis: (ms: number) => ({ __sentinel: 'timestamp', millis: ms }),
  },
}));

vi.mock('../admin', () => ({
  getAdminFirebase: () => ({
    db: {
      collection: () => ({ doc: docMock }),
    },
  }),
}));

import { logGeneration, redactPrompt } from '../ai-logs';

beforeEach(() => {
  vi.clearAllMocks();
  setMock.mockResolvedValue(undefined);
});

describe('redactPrompt', () => {
  it('redacts email addresses', () => {
    expect(redactPrompt('contact alice@example.com')).toContain('[REDACTED:email]');
  });

  it('redacts phone-shaped numbers', () => {
    expect(redactPrompt('call 555-867-5309 now')).toContain('[REDACTED:phone]');
  });

  it('redacts credit-card-shaped digits', () => {
    expect(redactPrompt('cc 4111 1111 1111 1111')).toContain('[REDACTED:cc]');
  });

  it('leaves non-PII text untouched', () => {
    expect(redactPrompt('a knight in red armor')).toBe('a knight in red armor');
  });

  it('does not redact short numeric strings', () => {
    expect(redactPrompt('64x64 grid')).toBe('64x64 grid');
  });
});

describe('logGeneration', () => {
  it('writes a doc with success=true and returns the doc id', async () => {
    const id = await logGeneration({
      uid: 'user-1',
      prompt: 'a knight',
      model: 'llama-3.3-70b',
      provider: 'groq',
      success: true,
      retryCount: 0,
      finishReason: 'stop',
      tokensIn: 500,
      tokensOut: 1500,
      costEstimate: 0.0027,
    });
    expect(id).toBe('gen-doc-id');
    expect(setMock).toHaveBeenCalledTimes(1);
    const written = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(written.uid).toBe('user-1');
    expect(written.prompt).toBe('a knight');
    expect(written.provider).toBe('groq');
    expect(written.success).toBe(true);
    expect(written.tokensIn).toBe(500);
    expect(written.tokensOut).toBe(1500);
    expect(written.error).toBeNull();
    expect(written.validationFailureCategory).toBeNull();
  });

  it('writes a doc with success=false and error category', async () => {
    await logGeneration({
      uid: 'user-1',
      prompt: 'bad prompt',
      model: 'llama-3.3-70b',
      provider: 'groq',
      success: false,
      error: 'generation_invalid',
      validationFailureCategory: 'palette_index_oor',
      retryCount: 1,
      finishReason: 'stop',
      tokensIn: 500,
      tokensOut: 800,
      costEstimate: 0.0011,
    });
    const written = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(written.success).toBe(false);
    expect(written.error).toBe('generation_invalid');
    expect(written.validationFailureCategory).toBe('palette_index_oor');
    expect(written.retryCount).toBe(1);
  });

  it('writes provider=cloudflare with null token counts on the cloudflare path', async () => {
    await logGeneration({
      uid: 'user-1',
      prompt: 'a knight',
      model: 'cf/sdxl-lightning',
      provider: 'cloudflare',
      success: true,
      retryCount: 0,
      finishReason: 'stop',
      tokensIn: null,
      tokensOut: null,
      costEstimate: 0,
    });
    const written = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(written.provider).toBe('cloudflare');
    expect(written.model).toBe('cf/sdxl-lightning');
    expect(written.tokensIn).toBeNull();
    expect(written.tokensOut).toBeNull();
    expect(written.costEstimate).toBe(0);
  });

  it('redacts prompt PII before writing', async () => {
    await logGeneration({
      uid: 'user-1',
      prompt: 'reach me at alice@example.com',
      model: 'llama',
      provider: 'groq',
      success: true,
      retryCount: 0,
      finishReason: 'stop',
      tokensIn: 100,
      tokensOut: 200,
      costEstimate: 0.0001,
    });
    const written = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(written.prompt).toContain('[REDACTED:email]');
    expect(written.prompt).not.toContain('alice@example.com');
  });

  it('returns null and does not throw when Firestore set rejects', async () => {
    setMock.mockRejectedValue(new Error('firestore down'));
    const id = await logGeneration({
      uid: 'user-1',
      prompt: 'hi',
      model: 'llama',
      provider: 'groq',
      success: true,
      retryCount: 0,
      finishReason: 'stop',
      tokensIn: 100,
      tokensOut: 200,
      costEstimate: 0.0001,
    });
    expect(id).toBeNull();
  });

  it('does not include ipHash on the log doc', async () => {
    await logGeneration({
      uid: 'user-1',
      prompt: 'hi',
      model: 'llama',
      provider: 'groq',
      success: true,
      retryCount: 0,
      finishReason: 'stop',
      tokensIn: 100,
      tokensOut: 200,
      costEstimate: 0.0001,
    });
    const written = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect('ipHash' in written).toBe(false);
  });
});
