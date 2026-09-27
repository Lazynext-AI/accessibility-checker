# Performance Optimization — Measured Baseline

Performance analysis for the Accessibility Checker, based on measurements
taken against the live deployment (2026-09-25), not generic recommendations.

## Measured baseline

| Path | Latency | Notes |
|---|---|---|
| `GET /`, `/health`, `/rules` | ~50ms | Static + JSON, edge-served |
| `POST /scan` (pasted HTML) | ~410ms | Pure ruleset — no network |
| `POST /scan` (URL, small page) | ~7s | Rendered scan after fix (was ~48-64s) |
| `POST /scan` (URL, heavy page) | ~12s | 1184-focusable Wikipedia page, all probes active |
| Platform `/kv/get`, `/query` | ~90-130ms | KV + D1 round-trips |
| `/checkout` redirect | ~310ms | Dodo session creation |
| `GET /api/v1/billing/funnel` | ~460ms | Multi-KV aggregate |

Worker bundles: product 218KB, platform 986KB — far under the 10MB limit;
startup is not a bottleneck.

## Where the time actually goes

1. **Ruleset is a rounding error.** `scanHtml` on a 217KB page runs in ~3ms;
   `checkContrast` over ~5k styled nodes ~7ms. String/DOM analysis is not
   worth optimizing.
2. **Browser Rendering dominates rendered scans.** Each keyboard press and
   `page.evaluate` is a websocket round-trip to the managed browser (~0.4-0.6s
   observed). The original trace loop issued 3 RTs per Tab press × 24 presses
   plus a 8-press backtrace and click probes — ~100 RTs ≈ 45-60s even for a
   page with a single link.
3. **Cold browser launches add variance.** A fresh `puppeteer.launch` when the
   Browser Rendering pool is cold costs tens of seconds.

## Fixes applied (2026-09-25)

- **Merged per-Tab evaluates into one** (`readFocusProbe`) — entry label,
  occlusion check (2.4.11) and focus-indicator check (2.4.13) in a single
  round-trip instead of two.
- **Early exits in the forward trace** — the loop breaks once the diagnostic
  signature is established: a ≥4-press stall (the trap signature the rules
  look for) or every focusable element visited (coverage proven). Subset
  cycles can't reach full coverage, so they run the whole press window.
  Same for the Shift+Tab backtrace (break at ≥4-stall).
- **Census-tracking press budget (2026-09-28)** — the coverage guard needs
  `trace.length >= focusable`, so `maxTab = min(max(focusable + 2, 24), 64)`:
  every census ≤64 now gets a provable coverage verdict (the old cap went
  flat at 24 presses for >40 focusables, silently disabling the wcag-2.4.3
  coverage finding there). Larger pages still get the full 64-press window —
  coverage stays unprovable, but stall/cycle detection reaches nearly 3×
  deeper into the tab order than the old 24-press cap.
- **Browser session reuse** — `puppeteer.sessions()` + `connect` to an idle
  session before falling back to `launch(keep_alive: 120s)`; `disconnect()`
  leaves the browser warm for the next request instead of terminating it.
- **Deep-probe gating** — Escape, backtrace and click probes are skipped when
  the focusable census is empty or the forward trace already hard-stalled
  (≥4): the trap signature is established and ~20 round-trips inside a
  trapped page cannot change the outcome. The backtrace also early-exits on
  reaching `body` or the first forward-focused element (both are excluded
  downstream anyway) or a completed 2-cycle tail; the Escape probe's
  before-state and in-dialog reads are merged into one evaluate and skipped
  entirely when focus sits on `<body>`.

Result: a minimal page renders+probes in ~7s (was 48-64s). A 1184-focusable
page ran the full probe suite in ~12s with warm session reuse at the old
24-press cap (~28s at the current 64-press budget — the price of the deeper
tab-order window). Trapped and
keyboard-inaccessible pages are the fastest class — the gate fires before
the deep probes. trap.html/trap2.html verified end-to-end post-change with
identical wcag-2.4.3 + wcag-2.1.2 findings; focusable-trap.html (48
focusables, mid-page cycle) verifies the coverage guard now fires past the
old 40-element boundary, and focusable-clean.html (50 focusables) verifies
the extended band returns a conclusive clean verdict.

## Remaining levers (not yet needed)

- Coverage stays unprovable for censuses >64 focusables — deeper interactive
  reach would need a smarter traversal than linear Tab presses.
- Scan-level caching by URL hash for repeat scans within a TTL window.
- Click-probe sleeps are wall-clock (350ms per trigger) and could shrink
  with a `waitForSelector`-style poll instead of a fixed delay.

## What was explicitly rejected

Recommendations that don't apply to this architecture: code splitting and
tree shaking (single-file worker bundle, no UI bundle to split), CDN ("use a
CDN" — the service already runs on Cloudflare's global edge), New
Relic/Datadog (not in the stack), WebAssembly/WebGL (no compute-bound or
graphics workload), and jQuery/cheerio-style HTML parsing (the scanner runs a
custom ruleset with zero runtime dependencies).
