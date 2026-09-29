// Plan-tier tests — pro/agency level semantics introduced with the Agency
// tier: license:<email> values map to entitlement levels that gate monitor
// caps, crawl depth, checkout product choice, and white-label reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { reportHtml } from '../src/report_views.js';

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

const get = (path, env = mockEnv(), headers = {}) =>
  worker.fetch(new Request(`https://checker.test${path}`, { headers }), env);
const post = (path, body, env = mockEnv()) =>
  worker.fetch(new Request(`https://checker.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);

test('/checkout defaults to the pro monthly product', async () => {
  let seen = null;
  const env = mockEnv({}, {
    '/api/v1/billing/checkout': async (req) => {
      seen = await req.json();
      return Response.json({ checkout_url: 'https://test.checkout.dodopayments.com/x' });
    },
  });
  const r = await get('/checkout', env);
  assert.equal(r.status, 302);
  assert.equal(seen.product_id, 'pdt_0NoEqD9VCMUZnIogq4Epy');
  assert.equal(seen.plan, 'pro');
  assert.equal(seen.trial_days, 14);
});

test('/checkout?plan=agency&term=annual picks the agency-annual product', async () => {
  let seen = null;
  const env = mockEnv({}, {
    '/api/v1/billing/checkout': async (req) => {
      seen = await req.json();
      return Response.json({ checkout_url: 'https://test.checkout.dodopayments.com/x' });
    },
  });
  const r = await get('/checkout?plan=agency&term=annual', env);
  assert.equal(r.status, 302);
  assert.equal(seen.product_id, 'pdt_0Nofjy47Y9PR6pdx3KF3U');
  assert.equal(seen.plan, 'agency');
});

test('monitor cap is 5 on pro and 50 on agency', async () => {
  const mons = (email, n) => Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`mon:${email}:u${i}`, '{}']),
  );
  // pro at 5 → rejected; agency at 5 → accepted (email-confirm path)
  const proEnv = mockEnv({ 'license:p@x.com': 'pro', ...mons('p@x.com', 5) });
  const rp = await post('/monitor', { license: 'p@x.com', url: 'https://x.com' }, proEnv);
  assert.equal(rp.status, 429);
  assert.match((await rp.json()).error, /monitor limit reached \(5\)/);

  const agEnv = mockEnv({ 'license:a@x.com': 'agency', ...mons('a@x.com', 5) });
  const ra = await post('/monitor', { license: 'a@x.com', url: 'https://x.com' }, agEnv);
  assert.equal(ra.status, 200);
  assert.equal((await ra.json()).confirm, 'email');
});

test('unknown paid plan names still get pro-level entitlements', async () => {
  const env = mockEnv({ 'license:o@x.com': 'team' });
  const r = await post('/monitor', { license: 'o@x.com', url: 'https://x.com' }, env);
  assert.equal(r.status, 200); // not 402 — 'team' counts as paid
});

test('agency reports render white-label — no promos or branding', () => {
  const rep = { url: 'https://x.com', ts: 1700000000000, rendered: false, score: 91, plan: 'agency' };
  const html = reportHtml('r1', rep, [], {}, {}, 'https://checker.test', 30);
  assert.ok(!html.includes('Go Pro'), 'no upsell on agency reports');
  assert.ok(!html.includes('Embed this badge'), 'no badge promo');
  assert.ok(!html.includes('Run your own scan'), 'no product CTA');
  assert.ok(html.includes('Accessibility report'), 'report still renders');
});

test('pro/free reports keep the upsell footer', () => {
  const rep = { url: 'https://x.com', ts: 1700000000000, rendered: false, score: 91, plan: 'free' };
  const html = reportHtml('r2', rep, [], {}, {}, 'https://checker.test', 0);
  assert.ok(html.includes('Go Pro'));
  assert.ok(html.includes('Embed this badge'));
});
