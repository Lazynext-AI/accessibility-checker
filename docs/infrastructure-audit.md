# Accessibility Checker — Infrastructure Audit

Technical audit of the production deployment at `checker.lazynext.com`, with
verified observations and prioritized recommendations.

## Architecture summary

| Layer | Implementation | State |
|---|---|---|
| Edge | Cloudflare Workers (`accessibility-checker` + `accessibility-checker-api` mirror) | Deployed |
| Domain | `checker.lazynext.com` branded Pages/Worker route | Live |
| Storage | KV `EPHEMERAL` (scans, leads, monitors, licenses, rate limits) + D1 (`ai-company-db` for CRM/waitlist) | Live |
| Rendering | Browser Rendering `/render` (contrast census, focus trace, target-size rects) | Live |
| Billing | Dodo Payments (test-mode) — products, checkout, webhooks, trials, discounts | Test-mode |
| Email | Brevo (sole provider) — lead capture, sequences, monitor alerts | Live |
| Auth | OAuth (product worker) + internal-token routes + `lzk_` API keys | Live |
| Platform link | `PLATFORM` service binding + `PLATFORM_TOKEN` secret | Live |

## Verified strengths

- **Deploy parity.** Both script names deploy the same 14-module bundle via
  `scripts/deploy.mjs`, which omits `PLATFORM_TOKEN` from metadata so the live
  secret is never overwritten by a stale local value.
- **Cache-busting.** All scan fetches append `_lz=<ts>` so edge-cached stale
  HTML cannot poison monitor rescan scores (was the source of a real 63-vs-100
  false-negative before the fix).
- **Quota gating.** Free tier is a real 3/day/IP cap returning clean `402`
  with an upgrade path — not a soft suggestion. Pro keys bypass.
- **Monitor loop.** Daily sweep re-scans `mon:*` entries via the `A11Y`
  service binding (same-account workers.dev fetches are refused), checks the
  license gate, writes `mon:last_sweep` breadcrumbs, and alerts on ≥10-pt
  drops. Skipped-monitor count is recorded, not silently dropped.
- **Test coverage.** 211 tests, 100% line coverage across all source files,
  94.76% branch coverage. `uncovered-paths.test.mjs` pins the previously
  dead routes (502 crawlers, monitor methods, favicon 301, cacheBust).

## Findings & recommendations

**P1 — Dodo is test-mode.** All checkout URLs resolve to
`test.checkout.dodopayments.com`. The flip is a documented 4-step op (KYC →
live `DODO_API_KEY` + `DODO_API_BASE` → recreate product + webhook +
WELCOME20), not a code change. Blocks revenue.

**P2 — Monitor sweep is sweep-keyed, not interval-keyed.** `seq:last_run` has
a one-tick KV edge-cache lag — a get can serve the pre-prime value for one
tick, so sequences fire on the *second* tick after priming. Transient and
self-correcting, but ops checks that read `mon:last_sweep` too early can
mistake it for a dead loop. Recommendation: document the lag (done — AGENTS.md)
rather than add complexity to mask it.

**P3 — `wcag-2.1.2` keyboard-trap detector is conservative.** The focus-trace
check fires on ≥4 consecutive Tabs on one element. A page with exactly one
link can trip it. Trade-off is intentional (warn over miss) and documented,
but interactive Browser Rendering verification would sharpen it. Not
actionable without a bounded-interaction harness.

**P4 — Report KV TTL — resolved.** `report:*` writes pass `ttl: 2592000`
(30d) in `scan_pipeline.js`, so every key auto-expires — a daily-scanning
monitor caps at ~30 live report keys. Growth is TTL-bounded by construction;
a retro-prune sweep would only delete keys already queued for expiry. No
code needed.

**P5 — Mirror-drift guard — resolved.** The dual-script deploy
(`accessibility-checker` + `accessibility-checker-api`) is enforced by
convention via `scripts/deploy.mjs`, but nothing detected a manual
single-script deploy. `scripts/health_check.py` (launchd, every 15 min) now
fetches `/rules` — the deterministic 75-rule manifest — from both
workers.dev origins and fails the `a11y-mirror` check on any byte
difference or fetch failure, alerting on state transitions like the other
checks. The same run also covers `checker.lazynext.com`/`api.lazynext.com`
health (the workers-domain 522 trap).

## Deferred (blocked on owner action)

- **Live billing** — Dodo KYC at `app.dodopayments.com/verification`, then the
  documented secret flip.
- **R2 backup retention** — deploy token lacks R2 Storage Edit scope; needs a
  scope add or dedicated R2 token.
- **Marketing/outbound strategy** — channel + spend decision is a business
  call; the agent surfaces (sales draft, funnel, nurture) are built and will
  execute once direction is set.

## Verification note

Every claim above was verified against the live deployment or repo state
during this audit — no inferred behavior. The criteria coverage map lives in
`docs/wcag-coverage.md` (generated from `GET /rules`).
