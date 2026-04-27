// M17 Unit 2: auth + envelope tests for ai-skin-generator Worker.
//
// Runs under Node's built-in test runner. Workers' `env.AI.run` is
// stubbed; native `Request`/`Response`/`ReadableStream` come from
// undici (Node 20+). No Wrangler / Miniflare dependency.
//
//   node --test workers/__tests__/auth.test.mjs

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import worker from '../ai-skin-generator.js';

// 1×1 transparent PNG (>1024 bytes after padding) — large enough to
// pass the undersized-image guard.
function makeFakePng(byteLength = 4096) {
  const out = new Uint8Array(byteLength);
  // PNG signature so a downstream sniff would still recognize it.
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // Fill the rest with deterministic noise so byte-equality assertions
  // are meaningful.
  for (let i = 8; i < out.length; i++) out[i] = i & 0xff;
  return out;
}

function makeReq(opts = {}) {
  const headers = new Headers({
    'content-type': 'application/json',
    ...(opts.headers ?? {}),
  });
  return new Request('http://localhost/', {
    method: opts.method ?? 'POST',
    headers,
    body:
      opts.body !== undefined
        ? typeof opts.body === 'string'
          ? opts.body
          : JSON.stringify(opts.body)
        : undefined,
  });
}

function makeEnv({
  token = 'test-token-32-chars-aaaaaaaaaaaa',
  prevToken,
  aiOutput = makeFakePng(),
  aiThrows,
} = {}) {
  return {
    SDXL_TOKEN: token,
    SDXL_TOKEN_PREVIOUS: prevToken,
    AI: {
      run: async () => {
        if (aiThrows !== undefined) throw aiThrows;
        return aiOutput;
      },
    },
  };
}

const VALID_AUTH = { authorization: 'Bearer test-token-32-chars-aaaaaaaaaaaa' };

describe('ai-skin-generator Worker — auth', () => {
  it('accepts a valid bearer token (200, image/png)', async () => {
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: 'a knight' } }),
      makeEnv(),
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 1024, 'response body should be the PNG');
  });

  it('rejects a missing Authorization header (401)', async () => {
    const res = await worker.fetch(
      makeReq({ body: { prompt: 'a knight' } }),
      makeEnv(),
    );
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'unauthorized');
  });

  it('rejects a wrong bearer token (401)', async () => {
    const res = await worker.fetch(
      makeReq({
        headers: { authorization: 'Bearer wrong-value' },
        body: { prompt: 'a knight' },
      }),
      makeEnv(),
    );
    assert.equal(res.status, 401);
  });

  it('rejects malformed Authorization header (401)', async () => {
    const res = await worker.fetch(
      makeReq({
        headers: { authorization: 'Basic abc' },
        body: { prompt: 'a knight' },
      }),
      makeEnv(),
    );
    assert.equal(res.status, 401);
  });

  it('accepts the previous token during rotation window', async () => {
    const env = makeEnv({
      token: 'new-token-32-chars-bbbbbbbbbbbbb',
      prevToken: 'old-token-32-chars-aaaaaaaaaaaaa',
    });
    const res = await worker.fetch(
      makeReq({
        headers: { authorization: 'Bearer old-token-32-chars-aaaaaaaaaaaaa' },
        body: { prompt: 'a knight' },
      }),
      env,
    );
    assert.equal(res.status, 200);
  });

  it('returns 503 config_error when SDXL_TOKEN is missing on the Worker', async () => {
    const env = makeEnv();
    delete env.SDXL_TOKEN;
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: 'a knight' } }),
      env,
    );
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.error, 'config_error');
  });
});

describe('ai-skin-generator Worker — request shape', () => {
  it('400 prompt_required on empty body', async () => {
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: {} }),
      makeEnv(),
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'prompt_required');
  });

  it('400 prompt_required on missing prompt field', async () => {
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { not_a_prompt: 'hi' } }),
      makeEnv(),
    );
    assert.equal(res.status, 400);
  });

  it('400 prompt_required on whitespace-only prompt', async () => {
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: '   ' } }),
      makeEnv(),
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'prompt_required');
  });

  it('400 prompt_invalid on prompt with control bytes', async () => {
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: 'hi\x07there' } }),
      makeEnv(),
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'prompt_invalid');
  });

  it('400 prompt_invalid on prompt longer than 400 chars', async () => {
    const res = await worker.fetch(
      makeReq({
        headers: VALID_AUTH,
        body: { prompt: 'x'.repeat(500) },
      }),
      makeEnv(),
    );
    assert.equal(res.status, 400);
  });

  it('415 on non-JSON Content-Type', async () => {
    const res = await worker.fetch(
      makeReq({
        headers: { ...VALID_AUTH, 'content-type': 'text/plain' },
        body: 'a knight',
      }),
      makeEnv(),
    );
    assert.equal(res.status, 415);
  });

  it('400 on malformed JSON body', async () => {
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: 'not json' }),
      makeEnv(),
    );
    assert.equal(res.status, 400);
  });

  it('405 on non-POST methods', async () => {
    const res = await worker.fetch(
      makeReq({ method: 'GET', headers: VALID_AUTH }),
      makeEnv(),
    );
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  });
});

describe('ai-skin-generator Worker — model error mapping', () => {
  it('502 upstream when env.AI.run throws', async () => {
    const env = makeEnv({ aiThrows: Object.assign(new Error('boom'), { name: 'AIError' }) });
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: 'hi' } }),
      env,
    );
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.error, 'upstream');
    assert.equal(data.code, 'AIError');
  });

  it('502 upstream when model returns a non-binary shape', async () => {
    const env = makeEnv({ aiOutput: { unexpected: 'object' } });
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: 'hi' } }),
      env,
    );
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.code, 'unexpected_response_shape');
  });

  it('502 upstream when model returns a tiny buffer (<1024 bytes)', async () => {
    const env = makeEnv({ aiOutput: new Uint8Array(100) });
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: 'hi' } }),
      env,
    );
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.code, 'undersized_image');
  });

  it('reads ReadableStream model output to a full PNG body', async () => {
    const png = makeFakePng(8192);
    const stream = new ReadableStream({
      start(controller) {
        // Split into two chunks to exercise the loop.
        controller.enqueue(png.slice(0, 4000));
        controller.enqueue(png.slice(4000));
        controller.close();
      },
    });
    const env = makeEnv({ aiOutput: stream });
    const res = await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: 'hi' } }),
      env,
    );
    assert.equal(res.status, 200);
    const buf = new Uint8Array(await res.arrayBuffer());
    assert.equal(buf.byteLength, png.byteLength);
    // First 8 bytes match the PNG signature.
    assert.deepEqual(Array.from(buf.slice(0, 8)), [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });
});

describe('ai-skin-generator Worker — model invocation', () => {
  it('passes the user prompt with a pixel-art prefix to env.AI.run', async () => {
    let capturedArgs;
    const env = {
      SDXL_TOKEN: 'test-token-32-chars-aaaaaaaaaaaa',
      AI: {
        run: async (model, args) => {
          capturedArgs = { model, args };
          return makeFakePng();
        },
      },
    };
    await worker.fetch(
      makeReq({ headers: VALID_AUTH, body: { prompt: 'a red knight' } }),
      env,
    );
    assert.equal(capturedArgs.model, '@cf/bytedance/stable-diffusion-xl-lightning');
    assert.match(capturedArgs.args.prompt, /pixel art/i);
    assert.match(capturedArgs.args.prompt, /minecraft skin/i);
    assert.match(capturedArgs.args.prompt, /a red knight/i);
    assert.equal(capturedArgs.args.num_steps, 8);
    assert.equal(capturedArgs.args.guidance, 7.5);
    assert.equal(capturedArgs.args.width, 512);
    assert.equal(capturedArgs.args.height, 512);
  });
});
