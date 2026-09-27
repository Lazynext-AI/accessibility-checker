// Route-level tests for worker.js — the fetch handler run in-process against a
// stubbed PLATFORM service binding. Closes the recurring "test suite" task class
// with coverage of the real route surface (health, scan, billing, monitor, lead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

// env.PLATFORM.fetch stub: kvGet/kvPut/kvDelete/kvList read the supplied map;
// other platform routes default to {ok:true} unless overridden per-test.
function mockEnv(kv = {}, handlers = {}) {
  return {
    PLATFORM_TOKEN: 'test-token',
    PLATFORM: {
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        if (handlers[path]) return handlers[path](req);
        if (path === '/kv/get') {
          const b = await req.json();
          return Response.json({ value: kv[b.key] ?? null });
        }
        if (path === '/kv/list') {
          const b = await req.json();
          return Response.json({ keys: Object.keys(kv).filter((k) => k.startsWith(b.prefix ?? '')) });
        }
        return Response.json({ ok: true });
      },
    },
  };
}

const get = (path, opts = {}, env = mockEnv()) =>
  worker.fetch(new Request(`https://checker.test${path}`, { method: 'GET', ...opts }), env);
const post = (path, body, opts = {}, env = mockEnv()) =>
  worker.fetch(new Request(`https://checker.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...opts }), env);

test('GET /health returns service identity', async () => {
  const r = await get('/health');
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.service, 'accessibility-checker');
});

test('GET / serves the usage doc to API callers and the UI to browsers', async () => {
  const api = await (await get('/')).json();
  assert.equal(api.name, 'Accessibility Checker API');
  assert.ok(api.scan.includes('POST /scan'));
  const ui = await get('/', { headers: { accept: 'text/html' } });
  assert.match(ui.headers.get('content-type'), /text\/html/);
  assert.match(await ui.text(), /Accessibility Checker/);
  assert.match(ui.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(ui.headers.get('x-content-type-options'), 'nosniff');
});

test('discovery files serve with correct content types', async () => {
  for (const [path, type] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'xml'], ['/manifest.json', 'manifest'], ['/favicon.svg', 'svg']]) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type') ?? '', new RegExp(type), path);
  }
});

test('unknown routes 404', async () => {
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await post('/nope', {})).status, 404);
});

test('POST /lead validates email and forwards to the platform', async () => {
  assert.equal((await post('/lead', { email: 'nope' })).status, 400);
  let forwarded = null;
  const env = mockEnv({}, { '/leads': async (req) => { forwarded = await req.json(); return Response.json({ ok: true }); } });
  const r = await post('/lead', { email: 'a@b.com' }, {}, env);
  assert.equal(r.status, 200);
  assert.equal(forwarded.email, 'a@b.com');
  assert.equal(forwarded.source, 'accessibility-checker');
});

test('GET /report/:id 404s when absent and escapes stored content', async () => {
  assert.equal((await get('/report/missing')).status, 404);
  const env = mockEnv({
    'report:abc': JSON.stringify({ url: '"><script>alert(1)</script>', ts: 0, score: 88, rendered: false, issues: [{ rule: 'wcag-x', message: '<img onerror=x>' }] }),
  });
  const html = await (await get('/report/abc', {}, env)).text();
  assert.ok(html.includes('&lt;script&gt;'), 'report URL is escaped');
  assert.ok(!html.includes('<script>alert'), 'no raw injected markup');
  assert.ok(html.includes('/report/abc.csv') && html.includes('/report/abc.pdf'), 'report offers exports');
});

test('GET /report/:id.csv exports findings as CSV', async () => {
  const env = mockEnv({
    'report:abc': JSON.stringify({ url: 'https://x', ts: 0, score: 88, rendered: false, issues: [{ rule: 'wcag-x', message: 'say "hi"', fix: 'fix, it' }] }),
  });
  const r = await get('/report/abc.csv', {}, env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /accessibility-report-abc\.csv/);
  const csv = await r.text();
  assert.ok(csv.startsWith('rule,criterion,level,page,finding,fix'));
  assert.ok(csv.includes('"say ""hi"""'), 'quotes escaped');
  assert.ok(csv.includes('"fix, it"'), 'commas quoted');
});

test('GET /badge/:id.svg renders a score-colored SVG badge', async () => {
  assert.equal((await get('/badge/missing.svg')).status, 404);
  const env = mockEnv({
    'report:abc': JSON.stringify({ url: 'https://x', ts: 0, score: 92, rendered: false, issues: [] }),
  });
  const r = await get('/badge/abc.svg', {}, env);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
  const svg = await r.text();
  assert.ok(svg.includes('92/100'), 'badge shows the score');
  assert.ok(svg.includes('#4c1'), 'score >= 80 is green');
  const low = mockEnv({ 'report:low': JSON.stringify({ url: 'https://x', ts: 0, score: 30, issues: [] }) });
  const svgLow = await (await get('/badge/low.svg', {}, low)).text();
  assert.ok(svgLow.includes('#e05d44'), 'score < 50 is red');
});

test('GET /rules returns the full coverage manifest', async () => {
  const r = await get('/rules');
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.count, 75);
  assert.equal(body.rules.length, 75);
  const ids = new Set(body.rules.map((x) => x.rule));
  for (const id of ['wcag-1.1.1', 'wcag-2.1.2', 'wcag-2.5.8', 'wcag-3.3.8', 'wcag-4.1.3'])
    assert.ok(ids.has(id), `missing ${id}`);
  const trap = body.rules.find((x) => x.rule === 'wcag-2.1.2');
  assert.equal(trap.name, 'No Keyboard Trap');
  assert.equal(trap.level, 'A');
});

test('GET /report/:id.pdf proxies the platform PDF render', async () => {
  const env = mockEnv(
    { 'report:abc': JSON.stringify({ url: 'https://x', ts: 0, score: 88, rendered: false, issues: [] }) },
    { '/pdf': async (req) => {
        const b = await req.json();
        assert.equal(b.url, 'https://checker.test/report/abc');
        return new Response('%PDF-fake', { headers: { 'content-type': 'application/pdf' } });
      } },
  );
  const r = await get('/report/abc.pdf', {}, env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /accessibility-report-abc\.pdf/);
});

test('POST /lead is rate limited per IP per day', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const env = mockEnv({ [`rl:lead:anon:${day}`]: '10' });
  const r = await post('/lead', { email: 'a@b.com' }, {}, env);
  assert.equal(r.status, 429);
});

test('GET /checkout redirects to the Dodo session the platform returns', async () => {
  const env = mockEnv({}, { '/api/v1/billing/checkout': async () => Response.json({ checkout_url: 'https://test.checkout.dodopayments.com/session/cks_x' }) });
  const r = await get('/checkout', {}, env);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://test.checkout.dodopayments.com/session/cks_x');
});

test('GET /checkout 502s when the platform checkout fails', async () => {
  const env = mockEnv({}, { '/api/v1/billing/checkout': async () => Response.json({ error: 'x' }, { status: 500 }) });
  assert.equal((await get('/checkout', {}, env)).status, 502);
});

test('POST /cancel validates license and requires mailbox confirmation', async () => {
  assert.equal((await post('/cancel', { license: 'nope' })).status, 400);
  assert.equal((await post('/cancel', { license: 'free@x.com' })).status, 404); // no license:<email> in KV
  let emailed = null;
  const env = mockEnv({ 'license:pro@x.com': 'pro' }, { '/email/send': async (req) => { emailed = await req.json(); return Response.json({ ok: true }); } });
  const r = await post('/cancel', { license: 'pro@x.com' }, {}, env);
  const d = await r.json();
  assert.equal(d.confirm, 'email'); // two-step: nothing cancelled yet
  assert.equal(emailed.to, 'pro@x.com');
});

test('GET /confirm rejects missing/expired tokens', async () => {
  const r = await get('/confirm?token=nonexistent');
  const html = await r.text();
  assert.ok(html.includes('Link expired'));
});

test('POST /scan enforces the free quota on URL scans', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const env = mockEnv({ ['rl:scan:1.2.3.4:' + day]: '3' });
  const r = await post('/scan', { url: 'https://example.com' }, { headers: { 'cf-connecting-ip': '1.2.3.4' } }, env);
  assert.equal(r.status, 402);
  assert.equal((await r.json()).upgrade, '/checkout');
});

test('POST /scan accepts pasted HTML without quota and returns a report URL', async () => {
  const r = await post('/scan', { html: '<html lang="en"><head><title>t</title></head><body><h1>hi</h1></body></html>' });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.plan, 'free');
  assert.equal(typeof d.score, 'number');
  assert.ok(d.report.startsWith('https://checker.test/report/'));
  assert.ok(d.section508);
});

test('POST /scan rejects oversized and missing payloads', async () => {
  assert.equal((await post('/scan', {})).status, 400);
  assert.equal((await post('/scan', { html: 'x'.repeat(513_000) })).status, 413);
});

test('POST /scan persists a report that GET /report/:id serves back', async () => {
  const kv = {};
  const env = mockEnv(kv, {
    '/kv/put': async (req) => { const b = await req.json(); kv[b.key] = b.value; return Response.json({ ok: true }); },
  });
  const scan = await post('/scan', { html: '<html lang="en"><head><title>t</title></head><body><h1>hi</h1></body></html>' }, {}, env);
  const d = await scan.json();
  assert.ok(d.report);
  const rep = await get(new URL(d.report).pathname, {}, env);
  assert.equal(rep.status, 200);
  assert.match(rep.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await rep.text(), /Accessibility report/);
});

test('POST /monitor requires a Pro license', async () => {
  assert.equal((await post('/monitor', { license: 'free@x.com', url: 'https://x.com' })).status, 402);
});
