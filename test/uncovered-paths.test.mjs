// Coverage of the algorithm paths the main suites leave unexercised:
// worker.js site-scan crawl path, rendered-scan path + cache-bust fragment
// handling, render-failure fetch fallback, the three /monitor methods,
// monitor.js record-fold branch edges, scanner.js early returns and
// parseColor forms, focuscycle cycle-without-census + Escape branches, and
// crawl.js's malformed-URL skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { scanHtml, parseColor, checkFocus } from '../src/scanner.js';
import { checkFocusDepth } from '../src/rules/focuscycle.js';
import { extractLinks, crawlSite } from '../src/crawl.js';
import {
  monitorKey, buildMonitorRecord, updateMonitorRecord, listMonitorsForEmail, DROP_THRESHOLD,
} from '../src/monitor.js';

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

const PRO = { 'license:pro@x.com': 'pro' };

// --- worker.js: favicon + static edge -----------------------------------------

test('GET /favicon.ico 301-redirects to the real SVG icon', async () => {
  const r = await get('/favicon.ico');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://checker.test/favicon.svg');
});

// --- worker.js: site-scan path (crawlSite via global fetch) -------------------

function stubFetch(t, impl) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => { globalThis.fetch = orig; });
}

const SITE_PAGES = {
  'https://s.test/': '<html><head><title>Home</title></head><body><main><a href="/about">about</a></main></body></html>',
  'https://s.test/about': '<html><head><title>About</title></head><body><main><a href="/">home</a></main></body></html>',
};

const htmlRes = (html, status = 200) =>
  new Response(html, { status, headers: { 'content-type': 'text/html' } });

test('POST /scan with site:true crawls same-origin pages and aggregates', async (t) => {
  stubFetch(t, async (u) => {
    const key = new URL(u).origin + new URL(u).pathname;
    return SITE_PAGES[key] ? htmlRes(SITE_PAGES[key]) : new Response('nope', { status: 404 });
  });
  const r = await post('/scan', { url: 'https://s.test/', site: true });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.site, true);
  assert.ok(Array.isArray(d.pages) && d.pages.length >= 1);
  assert.ok(d.pages.every((p) => typeof p.score === 'number' && typeof p.count === 'number'));
  assert.match(d.report, /\/report\//);
});

test('POST /scan site:true 502s when no pages can be crawled', async (t) => {
  stubFetch(t, async () => new Response('nope', { status: 500 }));
  const r = await post('/scan', { url: 'https://down.test/', site: true });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /no pages could be crawled/);
});

// Fetch failures inside crawlSite are counted as skipped, not thrown — the
// 'site crawl failed' 502 needs crawlSite itself to throw, e.g. a response
// whose body stream dies mid-read.
test('POST /scan site:true 502s when the crawl itself throws', async (t) => {
  stubFetch(t, async () => ({
    status: 200,
    headers: { get: () => 'text/html' },
    text: async () => { throw new Error('stream died'); },
  }));
  const r = await post('/scan', { url: 'https://s.test/', site: true });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /site crawl failed/);
});

// --- worker.js: rendered path + fallback --------------------------------------

test('POST /scan rendered path merges every ruleset and marks rendered', async () => {
  const env = mockEnv({}, {
    '/render': () => Response.json({
      html: '<html><body><main><a href="#">x</a><img src="a.png"></main></body></html>',
      styles: [{ text: 'faint', color: 'rgb(200,200,200)', bg: 'rgb(255,255,255)', size: 16, weight: '400', tag: 'p' }],
      facts: { iframesNoTitle: 1, duplicateIds: 0, ariaHiddenFocusable: 0, autofocus: 0, blankNoopener: 0, mediaNoCaptions: 0, tablesNoHeaders: 0, skipLink: false },
      focus: ['body', 'a'],
      focusable: 1,
      escape: null,
      undersized: [], obscured: [], noFocusInd: [], nontextContrast: [], spacingClip: [],
    }),
  });
  const r = await post('/scan', { url: 'https://x.test/#frag' }, {}, env);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.rendered, true);
  const rules = new Set(d.issues.map((i) => i.rule));
  assert.ok(rules.has('wcag-4.1.2')); // iframe fact
  assert.ok(rules.has('wcag-1.4.3')); // rendered contrast
});

test('POST /scan defaults the render viewport to mobile', async () => {
  let renderBody;
  const env = mockEnv({}, {
    '/render': async (req) => {
      renderBody = await req.json();
      return Response.json({ html: '<html><body><h1>x</h1></body></html>', styles: [], facts: {}, focus: [], focusable: 1, viewport: 'mobile' });
    },
  });
  const r = await post('/scan', { url: 'https://x.test/' }, {}, env);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(renderBody.viewport, 'mobile');
  assert.equal(d.rendered, true);
  assert.equal(d.viewport, 'mobile');
});

test('POST /scan honors viewport=desktop and echoes it in the result', async () => {
  let renderBody;
  const env = mockEnv({}, {
    '/render': async (req) => {
      renderBody = await req.json();
      return Response.json({ html: '<html><body><h1>x</h1></body></html>', styles: [], facts: {}, focus: [], focusable: 1, viewport: 'desktop' });
    },
  });
  const r = await post('/scan', { url: 'https://x.test/', viewport: 'desktop' }, {}, env);
  const d = await r.json();
  assert.equal(renderBody.viewport, 'desktop');
  assert.equal(d.viewport, 'desktop');
});

test('POST /scan records desktop when the render response carries no viewport echo', async () => {
  const env = mockEnv({}, {
    '/render': () => Response.json({ html: '<html><body><h1>x</h1></body></html>', styles: [], facts: {}, focus: [], focusable: 1 }),
  });
  const r = await post('/scan', { url: 'https://x.test/' }, {}, env);
  const d = await r.json();
  assert.equal(d.rendered, true);
  assert.equal(d.viewport, 'desktop'); // pre-viewport renders were desktop
});

test('buildMonitorRecord pins the subscribe-time viewport', () => {
  assert.equal(buildMonitorRecord({ email: 'a@b.c', url: 'https://x.test', viewport: 'desktop' }).viewport, 'desktop');
  assert.equal(buildMonitorRecord({ email: 'a@b.c', url: 'https://x.test' }).viewport, 'mobile');
  assert.equal(buildMonitorRecord({ email: 'a@b.c', url: 'https://x.test', viewport: 'bogus' }).viewport, 'mobile');
});

test('POST /scan falls back to a plain fetch when /render fails', async (t) => {
  stubFetch(t, async () => new Response('<html><body><img src="x.png"></body></html>', { status: 200 }));
  const env = mockEnv({}, { '/render': () => new Response('boom', { status: 500 }) });
  const r = await post('/scan', { url: 'https://x.test/' }, {}, env);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.rendered, false);
  assert.equal(d.viewport, undefined); // static fallback ran no render
  assert.match(d.render_error, /render 500/);
  assert.ok(d.issues.some((i) => i.rule === 'wcag-1.1.1')); // img without alt
});

test('POST /scan survives a fallback fetch that also fails', async (t) => {
  stubFetch(t, async () => { throw new Error('offline'); });
  const env = mockEnv({}, { '/render': () => new Response('boom', { status: 503 }) });
  const r = await post('/scan', { url: 'https://x.test/' }, {}, env);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.rendered, false);
  assert.match(d.render_error, /render 503/);
  assert.ok(Array.isArray(d.issues)); // empty body still gets static markup checks
});

// --- worker.js: /monitor POST/DELETE/GET --------------------------------------

test('POST /monitor gates on Pro and validates the URL', async () => {
  assert.equal((await post('/monitor', { license: 'free@x.com', url: 'https://x.test' })).status, 402);
  assert.equal((await post('/monitor', { license: 'pro@x.com', url: 'notaurl' }, {}, mockEnv(PRO))).status, 400);
  const ok = await post('/monitor', { license: 'pro@x.com', url: 'https://x.test' }, {}, mockEnv(PRO));
  const d = await ok.json();
  assert.equal(d.confirm, 'email');
});

test('DELETE /monitor gates on Pro and requires a URL', async () => {
  const del = (body, env = mockEnv()) => worker.fetch(
    new Request('https://checker.test/monitor', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
  assert.equal((await del({ license: 'free@x.com', url: 'https://x.test' })).status, 402);
  assert.equal((await del({ license: 'pro@x.com' }, mockEnv(PRO))).status, 400);
  const ok = await del({ license: 'pro@x.com', url: 'https://x.test' }, mockEnv(PRO));
  assert.equal((await ok.json()).confirm, 'email');
});

test('GET /monitor lists records owned by the license', async () => {
  const kv = {
    ...PRO,
    'mon:pro@x.com:aa': JSON.stringify({ url: 'https://a.test', email: 'pro@x.com', last_score: 90 }),
    'mon:pro@x.com:bb': JSON.stringify({ url: 'https://b.test', email: 'pro@x.com', last_score: 80 }),
    'mon:other@x.com:cc': JSON.stringify({ url: 'https://c.test', email: 'other@x.com', last_score: 70 }),
  };
  assert.equal((await get('/monitor?license=free@x.com')).status, 402);
  const r = await get('/monitor?license=pro@x.com', {}, mockEnv(kv));
  const d = await r.json();
  assert.equal(d.monitors.length, 2);
  assert.ok(d.monitors.every((m) => m.email === 'pro@x.com'));
});

// --- monitor.js: record-fold branch edges -------------------------------------

test('monitorKey tolerates empty and null inputs', () => {
  assert.equal(monitorKey('a@b.com', '').startsWith('mon:a@b.com:'), true);
  assert.equal(monitorKey(null, 'https://x.com').startsWith('mon::'), true);
  assert.equal(monitorKey(undefined, null), monitorKey('', ''));
});

test('buildMonitorRecord normalizes null inputs', () => {
  const r = buildMonitorRecord({ email: null, url: undefined });
  assert.equal(r.email, '');
  assert.equal(r.url, '');
  assert.equal(r.last_score, null);
  assert.equal(r.scans, 0);
});

test('updateMonitorRecord: first scan never counts as a drop', () => {
  const r = updateMonitorRecord(buildMonitorRecord({ email: 'a@b.com', url: 'https://x.com' }), 5);
  assert.equal(r.scoreDropped, false);
  assert.equal(r.last_score, 5);
  assert.equal(r.alerts, 0);
  assert.equal(r.scans, 1);
});

test('updateMonitorRecord: drop alert fires exactly at the threshold', () => {
  const base = { ...buildMonitorRecord({ email: 'a@b.com', url: 'https://x.com' }), last_score: 50 };
  const atThreshold = updateMonitorRecord(base, 50 - DROP_THRESHOLD);
  assert.equal(atThreshold.scoreDropped, true);
  assert.equal(atThreshold.alerts, 1);
  const underThreshold = updateMonitorRecord(base, 50 - DROP_THRESHOLD + 1);
  assert.equal(underThreshold.scoreDropped, false);
  assert.equal(underThreshold.alerts, 0);
  const improved = updateMonitorRecord(base, 90);
  assert.equal(improved.scoreDropped, false);
});

test('updateMonitorRecord tolerates records missing scans/alerts fields', () => {
  const r = updateMonitorRecord({ last_score: 100 }, 50);
  assert.equal(r.scans, 1);
  assert.equal(r.alerts, 1);
  assert.equal(r.scoreDropped, true);
});

test('listMonitorsForEmail: empty map, non-owner keys, email-field fallback', () => {
  assert.deepEqual(listMonitorsForEmail({}, 'a@b.com'), []);
  const kv = {
    'mon:other@x.com:aa': { url: 'https://a.test', email: 'other@x.com' },
    'legacy-key-without-prefix': { url: 'https://b.test', email: 'a@b.com' },
    'mon:a@b.com:zz': { url: 'https://z.test', email: 'a@b.com' },
  };
  const list = listMonitorsForEmail(kv, 'A@B.com');
  assert.equal(list.length, 2); // email fallback + key prefix; non-owner excluded
  assert.ok(list.some((m) => m.key === 'legacy-key-without-prefix'));
});

// --- scanner.js: early returns + parseColor forms ------------------------------

test('scanHtml flags vague link text (2.4.4) and zoom-disabled viewport (1.4.4)', () => {
  const issues = scanHtml('<html><meta name="viewport" content="width=device-width, user-scalable=no"><body><a href="/x">click here</a></body></html>');
  const rules = new Set(issues.map((i) => i.rule));
  assert.ok(rules.has('wcag-2.4.4'));
  assert.ok(rules.has('wcag-1.4.4'));
});

test('parseColor handles null, garbage, short hex, and rgba alpha', () => {
  assert.equal(parseColor(null), null);
  assert.equal(parseColor('not-a-color'), null);
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
});

test('checkFocus early returns for empty, body-only, and single-element traces', () => {
  assert.match(checkFocus([])[0].message, /no keyboard focus trace/);
  assert.match(checkFocus(null)[0].message, /no keyboard focus trace/);
  assert.match(checkFocus(['body', 'body'])[0].message, /no focusable elements found/);
  assert.match(checkFocus(['body', 'a', 'a', 'a'])[0].message, /only one focusable element/);
});

// --- focuscycle.js: cycle without census + escape branches ---------------------

test('checkFocusDepth: tail cycle without a focusable census warns generically', () => {
  const issues = checkFocusDepth(['a', 'b', 'a', 'b', 'a', 'b'], undefined, null);
  const cyc = issues.find((i) => i.rule === 'wcag-2.1.2');
  assert.ok(cyc);
  assert.match(cyc.message, /stuck cycling among 2 element\(s\)/);
  assert.doesNotMatch(cyc.message, /other focusable/);
});

test('checkFocusDepth: Escape probe fires only when the dialog ignores it', () => {
  const trap = checkFocusDepth(['a', 'b'], 2, { inDialog: true, responds: false });
  assert.ok(trap.some((i) => i.rule === 'wcag-2.1.2' && /Escape/i.test(i.message)));
  assert.equal(checkFocusDepth(['a', 'b'], 2, { inDialog: true, responds: true }).filter((i) => i.rule === 'wcag-2.1.2').length, 0);
  assert.equal(checkFocusDepth(['a', 'b'], 2, { inDialog: false, responds: false }).filter((i) => i.rule === 'wcag-2.1.2').length, 0);
});

// --- crawl.js: malformed-URL skip ----------------------------------------------

test('extractLinks skips hrefs that fail URL parsing instead of throwing', () => {
  const links = extractLinks('<a href="http://[">bad</a><a href="/good">ok</a>', 'https://s.test/');
  assert.equal(links.length, 1);
  assert.equal(links[0], 'https://s.test/good');
});

test('crawlSite survives pages whose links are all malformed', async () => {
  const r = await crawlSite('https://s.test/', {
    fetchImpl: async () => htmlRes('<a href="http://[">bad</a><a href="mailto:x@y">mail</a>'),
    delayMs: 0,
  });
  assert.equal(r.pages.length, 1);
});

// --- worker.js: confirm-email + Pro-scan rate limits --------------------------

const kvWriteback = (kv) => ({
  '/kv/put': async (req) => {
    const b = await req.json();
    kv[b.key] = b.value;
    return Response.json({ ok: true });
  },
});
const today = () => new Date().toISOString().slice(0, 10);

test('POST /cancel 429s once the license hits the daily confirm cap', async () => {
  const kv = { ...PRO, [`rl:confirm:pro@x.com:${today()}`]: '10' };
  const r = await post('/cancel', { license: 'pro@x.com' }, {}, mockEnv(kv, kvWriteback(kv)));
  assert.equal(r.status, 429);
  // A fresh license under the cap still goes through.
  const kv2 = { ...PRO };
  const ok = await post('/cancel', { license: 'pro@x.com' }, {}, mockEnv(kv2, kvWriteback(kv2)));
  assert.equal((await ok.json()).confirm, 'email');
});

test('POST /monitor + DELETE /monitor share the per-license confirm cap', async () => {
  const kv = { ...PRO, [`rl:confirm:pro@x.com:${today()}`]: '10' };
  const env = mockEnv(kv, kvWriteback(kv));
  assert.equal((await post('/monitor', { license: 'pro@x.com', url: 'https://x.test' }, {}, env)).status, 429);
  const del = (body) => worker.fetch(
    new Request('https://checker.test/monitor', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
  assert.equal((await del({ license: 'pro@x.com', url: 'https://x.test' })).status, 429);
});

test('POST /monitor 429s at the 50-monitor license cap', async () => {
  const kv = { ...PRO };
  for (let i = 0; i < 50; i++) kv[`mon:pro@x.com:m${i}`] = JSON.stringify({ url: `https://x${i}.test`, email: 'pro@x.com' });
  const r = await post('/monitor', { license: 'pro@x.com', url: 'https://new.test' }, {}, mockEnv(kv, kvWriteback(kv)));
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /monitor limit reached/);
});

test('POST /scan 429s a Pro IP over the daily licensed-scan quota', async () => {
  const kv = { ...PRO, [`rl:pro:anon:${today()}`]: '100' };
  const r = await post('/scan', { url: 'https://x.test', license: 'pro@x.com' }, {}, mockEnv(kv, kvWriteback(kv)));
  assert.equal(r.status, 429);
});
