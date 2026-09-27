// OpenAPI 3.1 description of the REST surface, served at GET /openapi.json.
// Hand-maintained alongside worker.js — test/openapi.test.mjs asserts every
// route the worker exposes is represented here, so the spec can't silently
// drift behind the implementation.

const err = (d) => ({
  description: d,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});
const json = (schema, d = 'OK') => ({
  description: d,
  content: { 'application/json': { schema } },
});

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'Lazynext Accessibility Checker API',
    version: '1.0.0',
    description: [
      'WCAG 2.1/2.2 accessibility scanning: rendered single-page checks,',
      'whole-site crawls, daily score monitoring, and shareable reports.',
      '',
      'All endpoints also answer HEAD (identical headers, no body). Errors are',
      '`{"error": string}` JSON. Quotas: free scans are limited to 3 rendered',
      'scans per IP per day; a Pro `license` (purchase email) raises that to',
      '100/day/IP plus a 500/day per-license ceiling.',
      '',
      'Agent surfaces (MCP JSON-RPC, A2A) run the same scan pipeline and quota;',
      'see `docs/agent-protocols.md` and `/.well-known/agent.json`.',
    ].join('\n'),
    'x-repo': 'https://github.com/Lazynext-AI/accessibility-checker',
  },
  servers: [
    { url: 'https://api.lazynext.com', description: 'API host' },
    { url: 'https://checker.lazynext.com', description: 'brand host (same worker)' },
  ],
  paths: {
    '/': {
      get: {
        summary: 'Service descriptor or product UI',
        description: 'API callers (`Accept` without `text/html`) get a JSON usage doc; browsers — and every request on `checker.lazynext.com` — get the single-page product UI.',
        responses: {
          '200': {
            description: 'JSON descriptor or HTML UI depending on Accept/host',
            content: {
              'application/json': { schema: { type: 'object', additionalProperties: { type: 'string' } } },
              'text/html': { schema: { type: 'string' } },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Liveness probe',
        responses: { '200': json({ type: 'object', properties: { ok: { type: 'boolean' }, service: { type: 'string' } }, required: ['ok', 'service'] }) },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'This OpenAPI document',
        responses: { '200': json({ type: 'object' }) },
      },
    },
    '/rules': {
      get: {
        summary: 'Detection coverage manifest',
        description: 'Every rule the scanner can emit, with WCAG criterion, conformance level, version, and detection method (`static` markup, `rendered` live-trace, or `crosspage` site-scan). JSON by default; `Accept: text/html` returns a browsable catalog (responses vary on `Accept`).',
        responses: {
          '200': {
            description: 'Rule manifest (JSON) or human-readable catalog (HTML)',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/RuleManifest' } },
              'text/html': { schema: { type: 'string' } },
            },
          },
        },
      },
    },
    '/scan': {
      post: {
        summary: 'Scan a page or site for WCAG issues',
        description: 'Provide `url` (public http/https page — rendered via headless browser) or raw `html` (static rules only). `site: true` crawls same-origin pages — 3 pages free, 10 Pro. Free URL scans consume the 3/day/IP quota; `html` scans do not. A Pro `license` email unlocks higher limits, deeper crawls, and `email_report`.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ScanRequest' } } },
        },
        responses: {
          '200': json({ $ref: '#/components/schemas/ScanResult' }),
          '400': err('Provide `{"url"}` or `{"html"}`'),
          '402': err('Free limit reached (3/day) — `upgrade` points at /checkout'),
          '413': err('`html` larger than 512KB'),
          '429': err('Daily scan quota exceeded (Pro IP or license ceiling)'),
          '502': err('Page fetch/crawl failed — `detail` carries the reason'),
        },
      },
    },
    '/report/{id}': {
      get: {
        summary: 'Shareable report (HTML)',
        description: 'Reports persist for 30 days. Append `.csv` or `.pdf` to the id for export formats. Query params filter the view identically across formats: `level` (A|AA|AAA|BP), `rule` (e.g. `wcag-1.4.3`), `by=page` (group site-scan findings by page).',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'level', in: 'query', schema: { type: 'string', enum: ['A', 'AA', 'AAA', 'BP'] } },
          { name: 'rule', in: 'query', schema: { type: 'string' } },
          { name: 'by', in: 'query', schema: { type: 'string', enum: ['page'] } },
        ],
        responses: {
          '200': {
            description: 'Report in the requested format',
            content: {
              'text/html': { schema: { type: 'string' } },
              'text/csv': { schema: { type: 'string' } },
              'application/pdf': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '404': err('Report not found or expired (30-day TTL)'),
          '502': err('PDF export unavailable'),
        },
      },
    },
    '/badge/{id}.svg': {
      get: {
        summary: 'Shields-style score badge for a stored report',
        description: 'Embed `https://api.lazynext.com/badge/{id}.svg` on a scanned site; links back to the report.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'SVG badge', content: { 'image/svg+xml': { schema: { type: 'string' } } } },
          '404': err('Report not found or expired'),
        },
      },
    },
    '/checkout': {
      get: {
        summary: 'Redirect to Pro checkout (Dodo Payments)',
        description: '302 → hosted checkout. `?trial=extended` applies the configured extended-trial offer (clamped 15–90 days; unset/invalid → standard 14-day trial).',
        parameters: [{ name: 'trial', in: 'query', schema: { type: 'string', enum: ['extended'] } }],
        responses: {
          '302': { description: 'Redirect to Dodo hosted checkout' },
          '502': err('Checkout unavailable'),
        },
      },
    },
    '/cancel': {
      post: {
        summary: 'Request Pro cancellation (email-confirmed)',
        description: 'Sends a confirmation link to the purchase email; the subscription ends only after `GET /confirm` consumes the token.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { license: { type: 'string', format: 'email' } }, required: ['license'] } } } },
        responses: {
          '200': json({ $ref: '#/components/schemas/Ok' }, 'Confirmation email sent'),
          '400': err('Purchase email required'),
          '404': err('No active Pro license for that email'),
          '429': err('Confirmation-rate limit (10/day/license, 30/day/IP)'),
        },
      },
    },
    '/lead': {
      post: {
        summary: 'Join the tips + updates list',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] } } } },
        responses: {
          '200': json({ $ref: '#/components/schemas/Ok' }),
          '400': err('Valid email required'),
          '429': err('Rate limit — try again later'),
          '502': err('Lead capture unavailable'),
        },
      },
    },
    '/monitor': {
      get: {
        summary: 'List monitors for a Pro license',
        parameters: [{ name: 'license', in: 'query', required: true, schema: { type: 'string', format: 'email' } }],
        responses: {
          '200': json({ type: 'object', properties: { monitors: { type: 'array', items: { $ref: '#/components/schemas/Monitor' } } }, required: ['monitors'] }),
          '402': err('Pro license required'),
          '502': err('Monitor list unavailable'),
        },
      },
      post: {
        summary: 'Add a daily monitor (email-confirmed)',
        description: 'Daily rendered rescan with score-drop email alerts. Max 50 monitors per license. Sends a confirmation link; the monitor activates on `GET /confirm`.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { license: { type: 'string', format: 'email' }, url: { type: 'string', format: 'uri' } }, required: ['license', 'url'] } } } },
        responses: {
          '200': json({ $ref: '#/components/schemas/ConfirmRequired' }),
          '400': err('Provide `{"url"}`'),
          '402': err('Pro license required — `upgrade` points at /checkout'),
          '429': err('Monitor limit (50) or confirmation-rate limit'),
          '502': err('Could not create confirmation'),
        },
      },
      delete: {
        summary: 'Remove a monitor (email-confirmed)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { license: { type: 'string', format: 'email' }, url: { type: 'string', format: 'uri' } }, required: ['license', 'url'] } } } },
        responses: {
          '200': json({ $ref: '#/components/schemas/ConfirmRequired' }),
          '400': err('Provide `{"url"}`'),
          '402': err('Pro license required'),
          '429': err('Confirmation-rate limit'),
          '502': err('Could not create confirmation'),
        },
      },
    },
    '/confirm': {
      get: {
        summary: 'Consume an emailed confirmation token',
        description: 'Single-use 15-minute tokens created by /cancel and /monitor mutations. Returns an HTML outcome page.',
        parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'HTML confirmation outcome page', content: { 'text/html': { schema: { type: 'string' } } } },
        },
      },
    },
    '/unsubscribe': {
      get: {
        summary: 'Unsubscribe page (signed link from report/alert emails)',
        parameters: [
          { name: 'email', in: 'query', required: true, schema: { type: 'string', format: 'email' } },
          { name: 'sig', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'HTML unsubscribe confirmation page', content: { 'text/html': { schema: { type: 'string' } } } },
          '403': { description: 'Invalid link', content: { 'text/html': { schema: { type: 'string' } } } },
        },
      },
      post: {
        summary: 'Unsubscribe (one-click, RFC 8058)',
        parameters: [
          { name: 'email', in: 'query', required: true, schema: { type: 'string', format: 'email' } },
          { name: 'sig', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': json({ $ref: '#/components/schemas/Ok' }),
          '403': err('Invalid link'),
          '502': err('Unsubscribe write failed'),
        },
      },
    },
    '/mcp': {
      post: {
        summary: 'Model Context Protocol endpoint (JSON-RPC 2.0)',
        description: 'Tools: `scan_url`, `scan_html`, `get_report`, `list_rules` — same pipeline and quota as POST /scan. GET returns 405 (no SSE transport). Wire format: `docs/agent-protocols.md`.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonRpcRequest' } } } },
        responses: { '200': json({ $ref: '#/components/schemas/JsonRpcResponse' }, 'JSON-RPC result or error envelope') },
      },
    },
    '/a2a': {
      post: {
        summary: 'A2A endpoint — message/send, tasks/send, tasks/get',
        description: 'Task ids are report ids: a completed task can be replayed from the stored report while it lives (30 days). Agent card at `/.well-known/agent.json`.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonRpcRequest' } } } },
        responses: { '200': json({ type: 'object' }, 'A2A task/message envelope') },
      },
    },
    '/a2a/tasks/{id}': {
      get: {
        summary: 'REST shortcut for A2A tasks/get',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': json({ type: 'object' }),
          '404': err('Task/report not found or expired'),
        },
      },
    },
    '/.well-known/agent.json': {
      get: {
        summary: 'A2A agent card',
        responses: { '200': json({ type: 'object' }) },
      },
    },
    '/widget.js': {
      get: {
        summary: 'Shadow-DOM embed script',
        description: '`<script src="…/widget.js"></script>` mounts a self-contained scan form on any site; its scans are quota-gated like every other surface.',
        responses: { '200': { description: 'JavaScript embed', content: { 'application/javascript': { schema: { type: 'string' } } } } },
      },
    },
    '/sw.js': {
      get: {
        summary: 'Service worker (PWA shell cache)',
        responses: { '200': { description: 'Service worker source', content: { 'application/javascript': { schema: { type: 'string' } } } } },
      },
    },
    '/manifest.json': {
      get: {
        summary: 'PWA manifest',
        responses: { '200': json({ type: 'object' }) },
      },
    },
    '/llms.txt': {
      get: {
        summary: 'LLM-facing service summary',
        responses: { '200': { description: 'Plain-text summary', content: { 'text/plain': { schema: { type: 'string' } } } } },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          upgrade: { type: 'string', description: 'Present on 402 responses — path to /checkout' },
          detail: { type: 'string' },
          skipped: { type: 'array', items: { type: 'string' } },
          report_error: { type: 'string' },
        },
        required: ['error'],
      },
      Ok: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
      ConfirmRequired: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, confirm: { type: 'string', enum: ['email'], description: 'Mutation completes only via the emailed confirmation link' } },
        required: ['ok', 'confirm'],
      },
      Monitor: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          license: { type: 'string', format: 'email' },
          created: { type: 'number', description: 'epoch ms' },
          last_score: { type: 'number' },
          last_scan: { type: 'number', description: 'epoch ms' },
          alerted: { type: 'boolean' },
        },
      },
      ScanRequest: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri', description: 'Public http/https page. Rendered via headless browser; consumes daily quota.' },
          html: { type: 'string', description: 'Raw markup to scan statically (≤512KB, no quota).' },
          site: { type: 'boolean', description: 'Crawl same-origin pages (3 free / 10 Pro) and add cross-page checks.' },
          license: { type: 'string', format: 'email', description: 'Pro purchase email — higher limits, deeper crawls, monitoring.' },
          email_report: { type: 'boolean', description: 'Pro only: email the report to the license address.' },
        },
      },
      ScanResult: {
        type: 'object',
        properties: {
          score: { type: 'number', minimum: 0, maximum: 100 },
          score_model: { type: 'string', enum: ['weighted-v1'], description: 'Scoring model version — weighted-v1 sums findings weighted by WCAG level and detection confidence (warn-class heuristics count half), repeat instances of the same rule at half marginal weight. Level-A confirmed failures still weigh 1.0.' },
          issues: { type: 'array', items: { $ref: '#/components/schemas/Issue' } },
          rendered: { type: 'boolean', description: 'true when the headless-browser path ran (false = static fallback)' },
          plan: { type: 'string', enum: ['free', 'pro'] },
          report: { type: 'string', format: 'uri', description: 'Shareable report URL (30-day TTL)' },
          render_error: { type: 'string', description: 'Present when rendering failed and the static fallback ran' },
          site: { type: 'boolean' },
          pages: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, score: { type: 'number' }, count: { type: 'number' } } }, description: 'Per-page rollups for site scans' },
          section508: { $ref: '#/components/schemas/Section508' },
          benchmark: { type: 'object', properties: { pct: { type: 'number' }, sites: { type: 'number' } }, description: 'Percentile vs the public scan corpus — present once ≥10 distinct sites are on record' },
        },
        required: ['score', 'issues', 'rendered', 'plan'],
      },
      Issue: {
        type: 'object',
        properties: {
          rule: { type: 'string', description: 'Emitted rule id — `wcag-N.N.N`, `sec508-*`, or `bp-*` (best practice, not a numbered criterion)' },
          level: { type: 'string', enum: ['A', 'AA', 'AAA', 'BP'] },
          message: { type: 'string' },
          url: { type: 'string', description: 'Per-page attribution on site scans' },
          recommendation: { type: 'string', description: 'Fix guidance joined from the ruleset' },
        },
      },
      Section508: {
        type: 'object',
        properties: {
          provisions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, issues: { type: 'number' } } } },
          covered: { type: 'number' },
          total: { type: 'number' },
        },
        description: '36 CFR 1194 clause mapping derived from the WCAG findings',
      },
      RuleManifest: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                rule: { type: 'string' },
                name: { type: 'string' },
                level: { type: 'string', enum: ['A', 'AA', 'AAA', 'BP'] },
                wcag: { type: 'string', description: 'WCAG version the criterion was introduced in, or `bp` for best-practice checks' },
                how: { type: 'string', enum: ['static', 'rendered', 'crosspage'] },
                detects: { type: 'string' },
              },
              required: ['rule', 'name', 'level', 'wcag', 'how', 'detects'],
            },
          },
        },
        required: ['count', 'rules'],
      },
      JsonRpcRequest: {
        type: 'object',
        properties: {
          jsonrpc: { type: 'string', enum: ['2.0'] },
          id: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
          method: { type: 'string' },
          params: { type: 'object' },
        },
        required: ['jsonrpc', 'method'],
      },
      JsonRpcResponse: {
        type: 'object',
        properties: {
          jsonrpc: { type: 'string', enum: ['2.0'] },
          id: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
          result: {},
          error: { type: 'object', properties: { code: { type: 'number' }, message: { type: 'string' }, data: {} } },
        },
      },
    },
  },
};
