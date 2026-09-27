# Accessibility Checker

Real WCAG 2.1 accessibility audits: paste a URL, we render the page in actual
Chromium, press Tab to trace keyboard focus, compute color contrast from
computed styles, and return a scored report with rule citations you can file
as tickets.

**Live:** https://checker.lazynext.com/
**API:** `https://accessibility-checker.dry-hall-6a50.workers.dev`

```bash
curl -X POST https://accessibility-checker.dry-hall-6a50.workers.dev/scan \
  -H 'content-type: application/json' \
  -d '{"url": "https://yoursite.com", "license": "you@example.com", "email_report": true}'
# → {"score": 70, "score_model": "weighted-v1", "issues": [{"rule": "wcag-1.3.1", ...}],
#    "rendered": true, "benchmark": {"pct": 61, "sites": 128},
#    "report": ".../report/<id>"}
```

The score is severity-weighted: confirmed WCAG level-A failures count in
full, AA/AAA findings progressively less, warn-class heuristics at half, and
repeat occurrences of the same rule at half marginal cost — a page full of
minor nits outscores one with a few blocking failures.

Endpoints: `POST /scan` (html or url; `{"url": ..., "site": true}` crawls
same-origin pages — 3 free / 10 Pro — and returns per-page scores; real-site
scans also return `benchmark` — where the score ranks vs the corpus of sites
scanned by this tool, shown once ≥10 sites are in),
`GET /checkout` (trial → paid),
`POST /cancel` (self-service cancellation by purchase email),
`POST /lead` (email capture), `GET /report/:id` (shareable report —
`?level=A|AA|AAA|BP`, `?rule=<id>`, `?by=page` views; CSV/PDF exports honor them),
`GET /badge/:id.svg` (embeddable score badge for a report),
`GET /rules` (the coverage manifest — 74 WCAG criteria + 1 best-practice
check; name, level, WCAG version, and detection path for every check emitted;
`Accept: text/html` returns a browsable catalog, JSON is the default),
`GET /openapi.json` (OpenAPI 3.1 contract for the whole REST surface),
`POST /monitor` / `GET /monitor?license=` / `DELETE /monitor` (Pro daily
monitoring — platform rescans each registered URL and emails a Brevo
alert when a page's score drops ≥ 10 points), `GET /health`.

## Agent surfaces

- **MCP** — `POST /mcp`, JSON-RPC 2.0 (`initialize`, `tools/list`,
  `tools/call`; GET is 405, no SSE). Tools: `scan_url`, `scan_html`,
  `get_report`, `list_rules`. Add to an MCP client:
  `{"mcpServers": {"a11y": {"url": "https://checker.lazynext.com/mcp"}}}`
- **A2A** — agent card at `GET /.well-known/agent.json`; `POST /a2a`
  handles `message/send` (send a text part containing a URL or HTML),
  `tasks/send` (alias), and `tasks/get` (the task id is the persisted
  report id). Scans return as completed tasks with the report artifact.
- **Widget** — `<script src="https://checker.lazynext.com/widget.js"
  data-target="#el"></script>` mounts a Shadow-DOM scan box anywhere;
  optional `data-license="buyer@x.com"` for Pro.
- Scans through MCP/A2A share the `/scan` free quota (3 URL scans/day/IP)
  and persist the same 30-day reports.

## SDKs + CLI

```js
import { AccessibilityChecker } from './sdk/js/index.js';
const a11y = new AccessibilityChecker({ license: 'buyer@x.com' }); // license optional
const { score, issues, report } = await a11y.scan({ url: 'https://example.com' });
await a11y.site('https://example.com');   // same-origin crawl
await a11y.rules();                        // full coverage manifest
```

```go
c := checker.New("buyer@x.com")            // license optional
res, err := c.Scan(checker.ScanOptions{URL: "https://example.com"})
rules, _ := c.Rules()
```

```python
from lazynext_a11y import AccessibilityChecker   # sdk/python, stdlib only
c = AccessibilityChecker(license="buyer@x.com")  # license optional
res = c.scan(url="https://example.com")
```

```sh
lazynext-a11y scan https://example.com --site    # bin/cli.js in sdk/js
lazynext-a11y rules --pretty
lazynext-a11y report <id>                        # CSV to stdout
lazynext-a11y monitor add <url> --license buyer@x.com
```

- `sdk/js` — `index.js` + `index.d.ts`, zero deps, Node 18+ and browsers;
  `bin:` entry `lazynext-a11y` (`node sdk/js/bin/cli.js` pre-install)
- `sdk/go` — `checker` package, standard library only (`go build` clean)
- `sdk/python` — `lazynext_a11y` module, stdlib only (`pip install sdk/python`)
- `scripts/ci-scan.mjs` — CI gate: `node scripts/ci-scan.mjs --url <u> --fail-under 80`

## What it checks

- **Rendered DOM** (via Cloudflare Browser Rendering): landmarks, headings,
  image alt text, form label association (including label-wrapping), vague
  link text, viewport zoom locks
- **Computed-style contrast** (WCAG 1.4.3 + 1.4.6): real luminance math on
  painted styles — 4.5:1 normal / 3:1 large text, plus the 7:1 enhanced tier
- **Additional rules** (`src/rules/additional.js`): heading content (2.4.6),
  label-in-name (2.5.3), viewport max-scale (1.4.4), text spacing overrides
  (1.4.10), language-of-parts (3.1.2), status messages (4.1.3), focus
  visibility (2.4.7 — inline + stylesheet outline suppression), timed
  refresh (2.2.1), autoplay/moving content (1.4.2/2.2.2), autocomplete
  tokens (1.3.5), onfocus context change (3.2.1), onchange auto-submit
  (3.2.2), accesskey / single-char shortcuts (2.1.4), images of text (1.4.5),
  multiple navigation mechanisms (2.4.5), justified text without hyphenation
  (1.4.8 — warn-class heuristic), accessible-name coverage for icon-only
  controls (4.1.2), motion actuation (2.5.4), orientation lock (1.3.4),
  hover/focus content without Escape dismissal (1.4.13 — warn-class), and
  down-event navigation (2.5.2). Plus static coverage for what previously
  needed the browser: duplicate ids (4.1.1), dangling label/aria/label-for
  references + iframe titles + invalid role/aria-attribute names +
  aria-hidden focusables + nested interactive elements (4.1.2), stray
  list/dl items + fieldset/optgroup/table structure + deprecated
  presentational markup (1.3.1), image inputs/areas/canvas/svg without
  alternatives (1.1.1), media without caption tracks (1.2.1), autofocus
  (3.2.1), role/tabindex/scrollable keyboard gaps (2.1.1),
  javascript:/dead/dangling-fragment links (2.4.4), blink content
  (2.3.1), sensory-only instructions (1.3.3 — warn-class), unassociated
  labels (3.3.2), missing section headings on long content (2.4.10 —
  AAA advisory), and unnamed duplicate landmarks (1.3.1)
- **Rendered layout checks**: target size 24×24px (2.5.8 — with inline-link
  and UA-control exemptions), focus not obscured by author overlays (2.4.11),
  visible focus indicator (2.4.13), non-text contrast of control boundaries
  (1.4.11 — 3:1 vs adjacent background), text-spacing override clipping
  (1.4.12 — WCAG metric injection, delta-only), and use of color (1.4.1 —
  prose-scoped: non-underlined in-text links need ≥3:1 vs surrounding text;
  nav/structural links are out of scope by the criterion itself)
- **Keyboard**: real Tab presses in the browser — keyboard-inaccessible
  pages (2.1.1), focus traps (2.1.2), focus-order gaps and cycles (2.4.3),
  dialog Escape handling; statics catch Tab-swallowing handlers and
  undismissable dialogs on pasted HTML too
- **Shadow DOM**: rendered scans serialize open shadow roots into
  `<template shadowrootmode>` markers, so markup rules cover encapsulated
  content; the focus census and Tab trace pierce open roots too. Closed
  roots can't be pierced by design — an honest gap. Element rules ignore
  `<script>` bodies, so markup-shaped JS strings can't double-count real
  elements
- **Cross-page** (`src/rules/crosspage.js`, site scans): consistent
  navigation (3.2.3), consistent identification (3.2.4), consistent help
  mechanisms (3.2.6)
- **WCAG 2.2 + Section 508**: `src/rules/wcag22.js` adds 2.2-era checks
  (accessible auth 3.3.8, redundant entry 3.3.7, dragging 2.5.7, …);
  `src/rules/section508.js` maps findings to 36 CFR 1194 clauses
- **DOM facts**: iframe titles, duplicate ids, aria-hidden focusables,
  autofocus, `target=_blank` without noopener, media captions, table headers,
  skip links

## Pricing

- Free: 3 rendered scans/day per IP
- Pro $9/mo: unlimited scans + emailed reports — `/checkout` (Dodo Payments)
  - **14-day free trial**: card collected up front, auto-converts at day 14;
    cancel any time via `POST /cancel` or the site's cancel link
  - Trial-expiry reminder emailed at day 11

## Architecture

- `src/scanner.js` — dependency-free WCAG engine (the same module the API runs)
- `src/rules/` — additional (per-page statics), crosspage (site-scan checks),
  focuscycle, wcag22, section508 — all wired into the scan pipeline
- `src/crawl.js` + `src/monitor.js` — same-origin site crawl (3 pages free /
  10 Pro) and scheduled rescan-with-alert monitors
- `worker.js` — Cloudflare Worker: scan API, rate limits, license checks,
  shareable reports, lead capture, trial checkout, self-service cancel,
  emailed Pro reports, MCP/A2A/widget/PWA surfaces
- `src/openapi.js` — OpenAPI 3.1 contract served at `/openapi.json`;
  `src/rules_catalog.js` — the HTML coverage catalog `/rules` negotiates to
- `index.html` — the Pages site (scan UI, site scans, monitors, trial CTA,
  cancel, email-report opt-in, 402 lead funnel, localStorage scan history)
- `action.yml` + `scripts/ci-scan.mjs` — GitHub Action for CI gating

## GitHub Action

Gate a deploy on accessibility score:

```yaml
- uses: Lazynext-AI/accessibility-checker@main
  with:
    url: https://staging.example.com
    fail-under: 80            # fail the build below this score
    # license: ${{ secrets.A11Y_LICENSE }}   # Pro: higher limits
    # site: true                             # crawl same-origin pages
    # fail-on: wcag-1.1.1,wcag-2.1.2         # rules that always fail
```

Outputs `score` and `issues`; findings land in the step summary with the
report link. Standalone: `node scripts/ci-scan.mjs --url <u> --fail-under 80`.
- `scripts/` — `sync-page.mjs` regenerates the embedded UI bundle,
  `deploy.mjs` deploys with full bindings (never `wrangler deploy`),
  `ci-scan.mjs` is the CI/standalone CLI
- `test/` — `node --test` suite (277 tests), runs in CI on every push

Built and operated autonomously by Lazynext agents.
