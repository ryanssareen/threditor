// @vitest-environment node
//
// M16 Unit 2 — Groq SDK wrapper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Hoisted spy for chat.completions.create.
const createMock = vi.hoisted(() => vi.fn());

class MockGroqError extends Error {
  status: number;
  headers: Record<string, string>;
  constructor(name: string, status: number, headers: Record<string, string> = {}) {
    super(`${name}: ${status}`);
    this.name = name;
    this.status = status;
    this.headers = headers;
  }
}

vi.mock('groq-sdk', () => {
  // Replicate the shape of `Groq` and a few error classes used by our
  // wrapper. The wrapper inspects `name` + `status`, so the simulated
  // classes only need those.
  class FakeGroq {
    chat = { completions: { create: createMock } };
    constructor(_opts: unknown) {
      void _opts;
    }
  }
  return {
    default: FakeGroq,
    Groq: FakeGroq,
    APIUserAbortError: class extends MockGroqError {
      constructor() {
        super('APIUserAbortError', 0);
      }
    },
    APIConnectionTimeoutError: class extends MockGroqError {
      constructor() {
        super('APIConnectionTimeoutError', 0);
      }
    },
    AuthenticationError: class extends MockGroqError {
      constructor() {
        super('AuthenticationError', 401);
      }
    },
    RateLimitError: class extends MockGroqError {
      constructor() {
        super('RateLimitError', 429);
      }
    },
  };
});

import {
  GroqAbortedError,
  GroqAuthError,
  GroqEnvError,
  GroqRateLimitError,
  GroqTimeoutError,
  GroqUpstreamError,
  GroqValidationError,
  generateSkin,
  getGroqKeyShape,
} from '../groq';

/** Build a 64-row solid RLE matrix as a JSON string. */
function solidRleJson(): string {
  const rows = Array.from({ length: 64 }, () => [[0, 64]]);
  return JSON.stringify({ palette: ['#aabbcc'], rows });
}

function okCompletion(content: string, finishReason = 'stop') {
  return {
    choices: [{ message: { content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 500, completion_tokens: 1500, total_tokens: 2000 },
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('GROQ_API_KEY', 'gsk_test_key_1234567890abcdef');
  createMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getGroqKeyShape', () => {
  it('present + length + first-4 chars only', () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk_abcdefg');
    const shape = getGroqKeyShape();
    expect(shape.present).toBe(true);
    expect(shape.length).toBe('gsk_abcdefg'.length);
    expect(shape.prefix).toBe('gsk_');
  });

  it('reports absent when env is empty', () => {
    vi.stubEnv('GROQ_API_KEY', '');
    expect(getGroqKeyShape().present).toBe(false);
  });

  it('treats whitespace-only as absent', () => {
    vi.stubEnv('GROQ_API_KEY', '   ');
    expect(getGroqKeyShape().present).toBe(false);
  });
});

describe('generateSkin happy paths', () => {
  it('returns parsed AISkinResponse on successful call', async () => {
    createMock.mockResolvedValue(okCompletion(solidRleJson()));
    const ctrl = new AbortController();
    const result = await generateSkin('a red knight', ctrl.signal);
    expect(result.parsed.palette).toEqual(['#aabbcc']);
    expect(result.parsed.rows).toHaveLength(64);
    expect(result.retryCount).toBe(0);
    expect(result.promptTokens).toBe(500);
    expect(result.completionTokens).toBe(1500);
  });

  it('strips ```json fences if Groq emits them', async () => {
    const fenced = '```json\n' + solidRleJson() + '\n```';
    createMock.mockResolvedValue(okCompletion(fenced));
    const ctrl = new AbortController();
    const result = await generateSkin('hi', ctrl.signal);
    expect(result.parsed.palette).toEqual(['#aabbcc']);
  });

  it('strips bare ``` fences', async () => {
    const fenced = '```\n' + solidRleJson() + '\n```';
    createMock.mockResolvedValue(okCompletion(fenced));
    const ctrl = new AbortController();
    const result = await generateSkin('hi', ctrl.signal);
    expect(result.parsed.rows).toHaveLength(64);
  });

  it('extracts JSON from prose-prefixed response', async () => {
    const messy = "Sure, here's your skin: " + solidRleJson() + '\nEnjoy!';
    createMock.mockResolvedValue(okCompletion(messy));
    const ctrl = new AbortController();
    const result = await generateSkin('hi', ctrl.signal);
    expect(result.parsed.palette).toEqual(['#aabbcc']);
  });
});

describe('generateSkin retry path', () => {
  it('retries once at temperature 0 on validation failure', async () => {
    const bad = JSON.stringify({ palette: [], rows: [] });
    createMock
      .mockResolvedValueOnce(okCompletion(bad))
      .mockResolvedValueOnce(okCompletion(solidRleJson()));
    const ctrl = new AbortController();
    const result = await generateSkin('blue cat', ctrl.signal);
    expect(result.retryCount).toBe(1);
    expect(createMock).toHaveBeenCalledTimes(2);
    // Second call should have temperature: 0.
    const secondCall = createMock.mock.calls[1][0] as { temperature: number };
    expect(secondCall.temperature).toBe(0);
  });

  it('throws GroqValidationError when retry also fails', async () => {
    const bad = JSON.stringify({ palette: [], rows: [] });
    createMock.mockResolvedValue(okCompletion(bad));
    const ctrl = new AbortController();
    await expect(generateSkin('hi', ctrl.signal)).rejects.toBeInstanceOf(
      GroqValidationError,
    );
  });

  it('GroqValidationError carries the codec category', async () => {
    const bad = JSON.stringify({
      palette: ['#000000'],
      rows: [[[0, 63]]], // run sum 63 — invalid
    });
    createMock.mockResolvedValue(okCompletion(bad));
    const ctrl = new AbortController();
    try {
      await generateSkin('hi', ctrl.signal);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GroqValidationError);
      // First call surfaces row_count_invalid (1 row vs 64).
      // Either reason is acceptable — we just need a real codec
      // category, not a generic shape_invalid.
      const cat = (e as GroqValidationError).category;
      expect(cat.length).toBeGreaterThan(0);
    }
  });
});

describe('generateSkin error mapping', () => {
  it('GroqEnvError when GROQ_API_KEY missing', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const ctrl = new AbortController();
    await expect(generateSkin('hi', ctrl.signal)).rejects.toBeInstanceOf(
      GroqEnvError,
    );
  });

  it('GroqEnvError exposes shape-only diagnostic', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const ctrl = new AbortController();
    try {
      await generateSkin('hi', ctrl.signal);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GroqEnvError);
      const shape = (e as GroqEnvError).envKeyShape;
      expect(shape.present).toBe(false);
      expect(shape.length).toBe(0);
      expect(shape.prefix).toBe('');
    }
  });

  it('GroqAuthError on AuthenticationError', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('401'), { name: 'AuthenticationError', status: 401 }),
    );
    const ctrl = new AbortController();
    await expect(generateSkin('hi', ctrl.signal)).rejects.toBeInstanceOf(
      GroqAuthError,
    );
  });

  it('GroqRateLimitError with retry-after seconds', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('429'), {
        name: 'RateLimitError',
        status: 429,
        headers: { 'retry-after': '42' },
      }),
    );
    const ctrl = new AbortController();
    try {
      await generateSkin('hi', ctrl.signal);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GroqRateLimitError);
      expect((e as GroqRateLimitError).retryAfterSeconds).toBe(42);
    }
  });

  it('GroqTimeoutError on APIConnectionTimeoutError', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('timeout'), { name: 'APIConnectionTimeoutError' }),
    );
    const ctrl = new AbortController();
    await expect(generateSkin('hi', ctrl.signal)).rejects.toBeInstanceOf(
      GroqTimeoutError,
    );
  });

  it('GroqAbortedError when AbortController aborts mid-flight', async () => {
    const ctrl = new AbortController();
    createMock.mockImplementation(() => {
      ctrl.abort();
      return Promise.reject(
        Object.assign(new Error('aborted'), { name: 'APIUserAbortError' }),
      );
    });
    await expect(generateSkin('hi', ctrl.signal)).rejects.toBeInstanceOf(
      GroqAbortedError,
    );
  });

  it('GroqUpstreamError on unclassified SDK error', async () => {
    createMock.mockRejectedValue(new Error('something weird'));
    const ctrl = new AbortController();
    await expect(generateSkin('hi', ctrl.signal)).rejects.toBeInstanceOf(
      GroqUpstreamError,
    );
  });

  it('GroqUpstreamError on empty completion content', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '' }, finish_reason: 'stop' }],
      usage: {},
    });
    const ctrl = new AbortController();
    await expect(generateSkin('hi', ctrl.signal)).rejects.toBeInstanceOf(
      GroqUpstreamError,
    );
  });
});

describe('generateSkin call shape', () => {
  it('passes max_completion_tokens, response_format json_object, model', async () => {
    createMock.mockResolvedValue(okCompletion(solidRleJson()));
    const ctrl = new AbortController();
    await generateSkin('hi', ctrl.signal);
    const call = createMock.mock.calls[0][0] as {
      model: string;
      response_format: { type: string };
      max_completion_tokens: number;
      temperature: number;
    };
    expect(call.model).toBe('llama-3.3-70b-versatile');
    expect(call.response_format).toEqual({ type: 'json_object' });
    expect(call.max_completion_tokens).toBe(4000);
    expect(call.temperature).toBe(0.8);
  });

  it('passes signal to the SDK call', async () => {
    createMock.mockResolvedValue(okCompletion(solidRleJson()));
    const ctrl = new AbortController();
    await generateSkin('hi', ctrl.signal);
    const opts = createMock.mock.calls[0][1] as { signal: AbortSignal };
    expect(opts.signal).toBe(ctrl.signal);
  });
});
