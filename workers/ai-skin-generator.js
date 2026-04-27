/**
 * M17 Unit 2: Cloudflare Worker — SDXL Lightning skin texture source.
 *
 * Surface contract (the Vercel route in `app/api/ai/generate/route.ts`
 * via `lib/ai/cloudflare-client.ts` is the only legitimate caller):
 *
 *   POST /
 *   Authorization: Bearer ${SDXL_TOKEN}
 *   Content-Type:  application/json
 *   { "prompt": "<user-prompt>" }
 *
 *   200 image/png  — raw 512x512 PNG body (binary, NOT base64).
 *   400 application/json { error: "prompt_required" | "prompt_invalid" }
 *   401 application/json { error: "unauthorized" }
 *   415 application/json { error: "unsupported_media_type" }
 *   502 application/json { error: "upstream", code: <string> }
 *   503 application/json { error: "config_error" }
 *
 * The Worker has *no* business logic. Auth, rate limiting, kill
 * switch, /aiGenerations logging, and slot-burn refund policy all
 * live on the Vercel side and are unchanged by M17. This file is
 * intentionally small.
 *
 * Two-key auth window for zero-downtime rotation: `SDXL_TOKEN` is
 * required; `SDXL_TOKEN_PREVIOUS` is optional and accepted in
 * parallel during a rotation. Drop `SDXL_TOKEN_PREVIOUS` after the
 * Vercel env has flipped to the new token.
 */

const MODEL = '@cf/bytedance/stable-diffusion-xl-lightning';

const PROMPT_PREFIX =
  'pixel art, 64x64 minecraft skin texture, character front view, simple flat colors, ';

const PROMPT_MAX_LEN = 400;

const NUM_STEPS = 8;
const GUIDANCE = 7.5;
const WIDTH = 512;
const HEIGHT = 512;

function jsonResponse(body, status, extraHeaders) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function bearerOk(authHeader, env) {
  if (typeof authHeader !== 'string') return false;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (m === null) return false;
  const presented = m[1].trim();
  if (presented.length === 0) return false;
  const current = typeof env.SDXL_TOKEN === 'string' ? env.SDXL_TOKEN : '';
  if (current.length > 0 && constantTimeEquals(presented, current)) return true;
  const previous =
    typeof env.SDXL_TOKEN_PREVIOUS === 'string' ? env.SDXL_TOKEN_PREVIOUS : '';
  if (previous.length > 0 && constantTimeEquals(presented, previous)) return true;
  return false;
}

function validatePrompt(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'prompt_required' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'prompt_required' };
  if (trimmed.length > PROMPT_MAX_LEN) return { ok: false, reason: 'prompt_invalid' };
  // Defensive: control bytes / format codepoints. The Vercel route
  // already rejects these, so this is belt-and-suspenders for any
  // direct caller that bypasses the route.
  if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) {
    return { ok: false, reason: 'prompt_invalid' };
  }
  return { ok: true, prompt: trimmed };
}

async function streamToArrayBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

const handler = {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, {
        Allow: 'POST',
      });
    }

    if (
      typeof env.SDXL_TOKEN !== 'string' ||
      env.SDXL_TOKEN.length === 0 ||
      env.AI === undefined
    ) {
      // Return 503 (config error) rather than 401 so an operator
      // running `wrangler secret list` sees a distinct signal.
      return jsonResponse({ error: 'config_error' }, 503);
    }

    if (!bearerOk(request.headers.get('authorization'), env)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!/^application\/json/i.test(contentType)) {
      return jsonResponse({ error: 'unsupported_media_type' }, 415);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'prompt_required' }, 400);
    }
    const promptCheck = validatePrompt(
      body !== null && typeof body === 'object' ? body.prompt : undefined,
    );
    if (!promptCheck.ok) {
      return jsonResponse({ error: promptCheck.reason }, 400);
    }

    const fullPrompt = `${PROMPT_PREFIX}${promptCheck.prompt}`;

    let modelOutput;
    try {
      modelOutput = await env.AI.run(MODEL, {
        prompt: fullPrompt,
        num_steps: NUM_STEPS,
        guidance: GUIDANCE,
        width: WIDTH,
        height: HEIGHT,
      });
    } catch (err) {
      const code =
        err !== null && typeof err === 'object' && 'name' in err
          ? String(err.name)
          : 'AIRunError';
      return jsonResponse({ error: 'upstream', code }, 502);
    }

    let imageBytes;
    if (modelOutput instanceof ReadableStream) {
      try {
        imageBytes = await streamToArrayBuffer(modelOutput);
      } catch (err) {
        const code =
          err !== null && typeof err === 'object' && 'name' in err
            ? String(err.name)
            : 'StreamReadError';
        return jsonResponse({ error: 'upstream', code }, 502);
      }
    } else if (modelOutput instanceof ArrayBuffer) {
      imageBytes = modelOutput;
    } else if (modelOutput instanceof Uint8Array) {
      imageBytes = modelOutput.buffer.slice(
        modelOutput.byteOffset,
        modelOutput.byteOffset + modelOutput.byteLength,
      );
    } else {
      return jsonResponse(
        { error: 'upstream', code: 'unexpected_response_shape' },
        502,
      );
    }

    if (imageBytes.byteLength < 1024) {
      return jsonResponse(
        { error: 'upstream', code: 'undersized_image' },
        502,
      );
    }

    return new Response(imageBytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
        'Content-Length': String(imageBytes.byteLength),
      },
    });
  },
};

export default handler;
