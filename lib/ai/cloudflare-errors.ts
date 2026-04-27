/**
 * M17 Units 3-5: typed-error tree for the Cloudflare image generation
 * pipeline. Mirrors the discipline of `lib/ai/groq.ts`'s error tree —
 * each error class encodes one failure mode, the route's catch
 * cascade maps each to an HTTP status code without restructuring.
 *
 * NOT a `'server-only'` module. The type definitions are pure JS
 * classes; nothing in this file imports the SDK or the route. It can
 * be imported from tests too. Anything with side effects lives in
 * `cloudflare.ts` / `cloudflare-client.ts`.
 */

/** Discrete categories for `ImageProcessingError`. Logged on /aiGenerations. */
export type ImageProcessingCategory =
  | 'resize_failed'
  | 'quantize_failed'
  | 'rle_failed';

export class ImageProcessingError extends Error {
  readonly category: ImageProcessingCategory;
  constructor(category: ImageProcessingCategory, message?: string) {
    super(message ?? category);
    this.name = 'ImageProcessingError';
    this.category = category;
  }
}

/** Shape-only diagnostic on the Cloudflare worker URL + token env vars. */
export type CloudflareEnvShape = {
  /** Set when CLOUDFLARE_WORKER_URL is present; never the full URL. */
  workerUrlShape: { present: boolean; hostname?: string };
  /** Set when CLOUDFLARE_WORKER_TOKEN is present; NEVER includes length or prefix. */
  tokenShape: { present: boolean };
};

export class CloudflareEnvError extends Error {
  readonly envShape: CloudflareEnvShape;
  constructor(envShape: CloudflareEnvShape, message?: string) {
    super(message ?? 'CLOUDFLARE_WORKER_URL or CLOUDFLARE_WORKER_TOKEN is missing or malformed');
    this.name = 'CloudflareEnvError';
    this.envShape = envShape;
  }
}

export class CloudflareAuthError extends Error {
  constructor(message?: string) {
    super(message ?? 'Cloudflare worker rejected our token');
    this.name = 'CloudflareAuthError';
  }
}

export class CloudflareRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message?: string) {
    super(message ?? 'Cloudflare WAF rate-limited the worker');
    this.name = 'CloudflareRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class CloudflareTimeoutError extends Error {
  constructor(message?: string) {
    super(message ?? 'Cloudflare worker call timed out');
    this.name = 'CloudflareTimeoutError';
  }
}

export class CloudflareAbortedError extends Error {
  /**
   * Coarser semantics than Groq's `streamStarted`. Set to `true` once
   * the `fetch(workerUrl)` promise has *resolved* — the response
   * headers reached us. Once that happens, Cloudflare has already
   * billed Neurons inside the Worker and a refund is no longer
   * appropriate even if `arrayBuffer()` aborted.
   */
  readonly streamStarted: boolean;
  constructor(streamStarted: boolean, message?: string) {
    super(message ?? 'Cloudflare worker call aborted by client');
    this.name = 'CloudflareAbortedError';
    this.streamStarted = streamStarted;
  }
}

export class CloudflareUpstreamError extends Error {
  readonly statusCode: number;
  /** Truncated to ≤200 chars upstream. Log-safe. */
  readonly bodyExcerpt: string;
  constructor(statusCode: number, bodyExcerpt: string, message?: string) {
    super(message ?? `Cloudflare worker returned ${statusCode}`);
    this.name = 'CloudflareUpstreamError';
    this.statusCode = statusCode;
    this.bodyExcerpt = bodyExcerpt;
  }
}
