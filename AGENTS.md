# Accessibility Checker — Agent Operating Notes

Standalone repo: `github.com/Lazynext-AI/accessibility-checker`.
Mirrored inside the platform monorepo at `products/accessibility-checker` —
keep the two trees synchronized; a fix that lands in only one silently
diverges the next deploy.

## Deploy — read this first

- **Never `wrangler deploy`.** Deploy via `node scripts/deploy.mjs` with
  `CLOUDFLARE_DEPLOY_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in env.
- The worker's only binding is `PLATFORM` (service binding to `ai-company-os`).
  A plain wrangler deploy omits it → `env.PLATFORM` undefined → error 1101 on
  every scan even though the settings API still lists the binding.
- `deploy.mjs` pushes the same bundle to **both** script names:
  `accessibility-checker` (what the Pages UI calls) and
  `accessibility-checker-api` (mirror). Deploying only one = silent drift.
- `PLATFORM_TOKEN` is intentionally omitted from deploy metadata — omitted
  secrets keep their live value. If the platform `API_TOKEN` rotates, re-set
  `PLATFORM_TOKEN` on both scripts (`wrangler secret put … --name <script>`)
  or every service-binding call **and every unsubscribe link** (HMAC-verified
  with the same secret) starts failing.

## Tests

- `node --test` — bare invocation from the repo root.
  `node --test test/` resolves `test/` as a module path and fails.
- Test gate runs before any commit; product CI must stay green.

## Data model — no direct storage

All state flows through `env.PLATFORM.fetch('/kv/get'|'/kv/put'|…)`
(`worker.js`). Reports `report:*` (30d TTL), monitors `mon:*` (ttl 0),
licenses `license:*`, rate counters `rl:*` (25h TTL), confirm tokens
`pending:*` (15m). Leads/CRM/waitlist land in D1 `ai-company-db` via platform
routes. **Platform KV `/kv/put` defaults `expirationTtl` to 60s** — pass
`ttl: 0` (number) for durable writes; `"0"` as a string fails the `=== 0`
check and silently gets the 60s floor.

## Live verification traps (all bit before)

- `workers.dev` → `workers.dev` subrequests are refused — same-account and
  same-script especially. Verify live behavior via `checker.lazynext.com`
  or GitHub Pages fixtures, not worker-to-worker fetches.
- GitHub Pages serves this repo under `/accessibility-checker/` — fixture
  links must be **relative** (`nav-b.html`), absolute `/nav-b.html` 404s
  outside the subpath.
- Fixture prose must not contain the keywords its rule detects — a
  `nav-a.html` paragraph saying "no breadcrumbs, no aria-current, no
  sitemap" made `wcag-2.4.8` correctly fire on the *prose* and produced a
  false-positive fixture.
- KV reads can serve a ~60s edge-cached value — a persistence check at
  +60–70s can false-positive. Verify durability at ≥120s.
- The report page CSP is `default-src 'none'` — every needed source must
  be named (`img-src 'self'` was added `b69383f` after the same-origin
  badge SVG rendered broken). Report pages are edge-cached 1h — verify
  CSP/HTML changes with a `?cb=N` query param, not a plain reload.

## Coverage honesty

`/rules` exposes the current manifest (74 WCAG criteria + 1 `bp-` best-practice
check — keep README/docs counts in sync whenever it changes). Best-practice
checks exist for real problems with no published criterion (e.g.
`bp-visible-controls`: SC 3.2.7 was cut from WCAG 2.2 before release, so it
must never be labeled `wcag-3.2.7` or claim a conformance level). Do not claim criteria the scanner cannot
honestly detect: media semantics, session/timing behavior, NLP-level
judgment, and form-submission dynamics are out of scope for the current
static + rendered + cross-page architecture. `docs/wcag-coverage.md` is
generated from the live manifest via `npm run gen:coverage`
(`scripts/gen-coverage.mjs`) — regenerate, don't hand-edit;
`test/wcag-coverage-doc.test.mjs` fails when the committed file drifts.
Element detectors must match **markup context**, not bare words: prose can
contain the trigger word (`\bautofocus\b` fired on the `/rules` catalog's own
description column; `\bcaptcha\b` matched "CAPTCHA" in text and
`href="/blog/captcha"` links). Require tag/attribute position
(`<[a-zA-Z][^>]*\sautofocus\b`, attribute-scoped `class|id|src|data-*` for
generic terms) — distinctive vendor tokens may stay free-form.
`wcag-3.1.2` compares the **effective** language (innermost `lang`/`xml:lang`
ancestor, tracked via open-tag stack) against the text's script family —
a correctly `lang`-marked ancestor satisfies the criterion even when the
leaf element itself is unmarked (live FP: example.com's rendered
`<p lang="ar">` blocks; each `lang` value must *match* the script — a
`lang="fr"` wrapper around Arabic still fails).

**Shadow DOM**: the rendered path serializes open shadow roots into
`<template shadowrootmode>` nodes inside `page.html` (platform `scrape.ts`),
so markup rules cover encapsulated content, and the focus census/trace
pierce open roots. **Closed shadow roots stay opaque** — they cannot be
pierced by design, an honest gap. `shadow.html` is the live verification
fixture.

**`<script>` bodies are stripped before element rules run** (`scanner.js`,
`wcag22.js`, `additional.js`, `scanKeyboardStatics`) — markup-shaped JS
strings double-count real elements otherwise. Rules that intentionally
inspect script source (`addEventListener('devicemotion')`, `orientation.lock`,
Escape-handler tokens, captcha) read `srcRaw` in `additional.js`. Script
tags' attributes survive the strip (`src=` stays matchable).

## File map

- `worker.js` — routes + KV/platform helpers (`kvGet`, `kvPut`, `rlHit`,
  `isPro`, `platform`, `unsubSig`)
- `src/scanner.js` — markup scanner + `score()` (**protected file**). Scoring
  is severity-weighted (`score_model: 'weighted-v1'` on results): weights
  derive from `rules/manifest.js` — A=1.0, AA=0.6, AAA=0.35, BP=0.25,
  warn-class detects ×0.5, unknown rules=1.0 — with repeat occurrences of a
  rule at half marginal cost. All weights ≤1.0 so scores only rise vs the old
  flat count; `mon:*` drop-alerts can't false-fire on the model change, and
  stored reports keep their scan-time score honestly.
- `src/scan_pipeline.js` — shared quota + scan + persist core for
  `/scan`, `/mcp`, `/a2a`
- `src/agent_surfaces.js` — MCP server, A2A `message/send`/`tasks/get`,
  agent card, `WIDGET_JS` (a **scan form**, not a chat — its `/scan` calls
  are already quota-gated)
- `src/report_views.js` — report view customization (`?level=`, `?rule=`,
  `?by=page`) + CSV/HTML rendering for `/report/:id` (`.json` returns the stored
  report object — the machine-readable export) — **not** a protected
  file, so report-surface changes belong here, not in `worker.js`
- `src/openapi.js` — the OpenAPI 3.1 doc at `GET /openapi.json`; hand-maintained
  with worker.js, kept honest by `test/openapi.test.mjs` (asserts every route
  literal in worker.js is declared). A new route without a spec entry fails CI.
- `src/rules_catalog.js` — the browsable catalog `/rules` serves for
  `Accept: text/html` (JSON stays default; responses carry `Vary: Accept`)
- `src/rules/` — WCAG rule modules + `manifest.js` (the `/rules` source)
- `scripts/deploy.mjs` — the only supported deploy path
- `scripts/sync-page.mjs` — regenerates `index.html` + fixture serving list
- `docs/disaster_recovery.md` — verified DR plan (restore drill 2026-09-26)
- `docs/infrastructure-audit.md` — live-infra audit with P1–P5 findings

## Email & billing

- Brevo is the only email provider — Resend is fully removed; do not
  reintroduce.
- Dodo is **test-mode** (`test.checkout.dodopayments.com`). The live flip is
  an ops procedure (KYC → live `DODO_API_KEY` + `DODO_API_BASE` → recreate
  product + webhook + `WELCOME20`), documented in the monorepo AGENTS.md —
  not a code change.
- Trial-extension mechanism shipped: `/checkout?trial=extended` reads
  `config:trial_offer` (platform KV, bare day count) → `trial_days` clamped
  15–90 (unset/invalid → 14). `/report/:id` renders the matching CTA —
  offer ON vs OFF flips one `kv/put`, which is a business decision.
