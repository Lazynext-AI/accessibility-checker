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

## Coverage honesty

`/rules` exposes the current manifest (75 rules — keep README/docs counts in
sync whenever it changes). Do not claim criteria the scanner cannot
honestly detect: media semantics, session/timing behavior, NLP-level
judgment, and form-submission dynamics are out of scope for the current
static + rendered + cross-page architecture. `docs/wcag-coverage.md` is
generated from the live manifest — regenerate, don't hand-edit.

## File map

- `worker.js` — routes + KV/platform helpers (`kvGet`, `kvPut`, `rlHit`,
  `isPro`, `platform`, `unsubSig`)
- `src/scan_pipeline.js` — shared quota + scan + persist core for
  `/scan`, `/mcp`, `/a2a`
- `src/agent_surfaces.js` — MCP server, A2A `message/send`/`tasks/get`,
  agent card, `WIDGET_JS` (a **scan form**, not a chat — its `/scan` calls
  are already quota-gated)
- `src/report_views.js` — report view customization (`?level=`, `?rule=`,
  `?by=page`) + CSV/HTML rendering for `/report/:id` — **not** a protected
  file, so report-surface changes belong here, not in `worker.js`
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
