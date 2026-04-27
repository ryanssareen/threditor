# `ai-skin-generator` Cloudflare Worker (M17)

A thin Worker around `@cf/bytedance/stable-diffusion-xl-lightning`. The
Vercel-hosted Next.js route at `app/api/ai/generate/route.ts` is the
only legitimate caller; this Worker has no business logic of its own.

## Surface

```
POST /
Authorization: Bearer ${SDXL_TOKEN}
Content-Type:  application/json
{ "prompt": "<user-prompt>" }
```

Response on success: `200 image/png` with the raw 512×512 PNG body
(binary, **not** base64). Errors are JSON: `400 prompt_required` /
`prompt_invalid`, `401 unauthorized`, `415 unsupported_media_type`,
`502 upstream`, `503 config_error`.

The Worker prepends a fixed pixel-art prefix to the user prompt and
sends it to SDXL Lightning at `num_steps: 8, guidance: 7.5,
width: 512, height: 512`.

## Why a Worker, not a direct `env.AI.run` from Vercel?

`env.AI` is a Cloudflare-runtime binding, not an HTTP API. Vercel's
Node runtime cannot bind to it. The Worker is the smallest possible
adapter: it exposes the binding as authenticated HTTP.

## Deploy

```bash
# One-time
npm install -g wrangler
wrangler login

# Deploy
cd workers
wrangler deploy

# Set secrets (reads stdin, NOT committed)
wrangler secret put SDXL_TOKEN
# Optional, only during rotation:
wrangler secret put SDXL_TOKEN_PREVIOUS
```

After deploy, copy the printed URL (e.g.
`https://ai-skin-generator.<account>.workers.dev`) into the Vercel env:

```bash
vercel env add CLOUDFLARE_WORKER_URL production
vercel env add CLOUDFLARE_WORKER_URL preview
vercel env add CLOUDFLARE_WORKER_URL development
# Same for CLOUDFLARE_WORKER_TOKEN with the SDXL_TOKEN value.
```

## Token rotation (planned cadence: ≥90 days; immediate on incident)

The Worker accepts both `SDXL_TOKEN` and `SDXL_TOKEN_PREVIOUS` for
zero-downtime rotation:

1. `wrangler secret put SDXL_TOKEN_PREVIOUS` — set to the *current*
   token (so the existing Vercel-side value keeps working).
2. `wrangler secret put SDXL_TOKEN` — set to the *new* token.
3. Update `CLOUDFLARE_WORKER_TOKEN` in every Vercel environment to
   the new token. Confirm propagation with a smoke test.
4. `wrangler secret delete SDXL_TOKEN_PREVIOUS` once Vercel is fully
   rolled over.

Without the dual-token window, there is a brief mismatched-token
period during which user requests fail with 500. Use the window.

## WAF rate-limit rule

Configured in the Cloudflare dashboard (Security → WAF → Rate limiting
rules). Snapshot lives in `workers/waf-rules.json` for change tracking.

Current rule:

- **Match:** `http.host eq "ai-skin-generator.<account>.workers.dev"`
- **Threshold:** 60 requests / 60 seconds / IP
- **Action:** `block`
- **Mitigation duration:** 60 seconds

The 60/min/IP threshold accommodates Vercel's egress IP concentration
(all production traffic shares a small pool of egress IPs). The
per-uid 30/day cap on the Vercel route is the real abuse defense.

## Local dev

```bash
cd workers
wrangler dev
# Worker is at http://localhost:8787
# Set local secrets in workers/.dev.vars (not committed):
echo 'SDXL_TOKEN=local-test-token' > .dev.vars
```

## Troubleshooting

| Symptom                              | Likely cause                                | Action                                                 |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------ |
| Vercel route returns 500 `service_misconfigured` | `CLOUDFLARE_WORKER_URL` or `CLOUDFLARE_WORKER_TOKEN` missing/whitespace | Check Vercel env, redeploy or wait for env cache       |
| Worker returns 401                   | Token mismatch (missing/wrong)              | Compare Vercel `CLOUDFLARE_WORKER_TOKEN` with `wrangler secret list` |
| Worker returns 503 `config_error`    | `SDXL_TOKEN` not set on the Worker          | `wrangler secret put SDXL_TOKEN`                       |
| Worker returns 429                   | WAF rate limit tripped (60/min/IP)          | Investigate caller; raise limit only if egress-IP self-DoS |
| Worker returns 502 `upstream`        | SDXL Lightning model failure / cold start   | Check `wrangler tail`, retry; report to Cloudflare if persistent |
| Generation times out at 30s          | SDXL cold start                             | Cold starts can take 8–12s. Repeat call usually fast.  |

## Tests

```bash
node --test workers/__tests__/auth.test.mjs
```

The auth tests use stubbed Workers globals (`Request`, `Response`,
`ReadableStream`) and a fake `env.AI.run` — they do not require
Wrangler or a real Cloudflare deployment.
