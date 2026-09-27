// SDK CLI tests — spawns bin/cli.js against a stub HTTP server so flag
// parsing, env-var config, wire format, and exit codes are all covered
// offline (no live API dependency in the test gate). execFile must stay
// async: a sync spawn blocks the event loop that serves the stub → deadlock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const execFileP = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'sdk', 'js', 'bin', 'cli.js');

let server;
let base;
const requests = []; // { method, path, body }

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method, path: req.url, body });
      if (req.url === '/rules') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ rules: [{ id: 'wcag-1.1.1', name: 'alt text' }] }));
      }
      if (req.url === '/scan' && req.method === 'POST') {
        const { url } = JSON.parse(body || '{}');
        if (url === 'https://rate-limited.example') {
          res.statusCode = 429;
          return res.end(JSON.stringify({ error: 'daily quota reached' }));
        }
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ id: 'r1', score: 80, issues: [], report: `/report/r1` }));
      }
      if (req.url === '/report/r1.csv') {
        res.setHeader('content-type', 'text/csv');
        return res.end('rule,criterion,impact\nwcag-1.1.1,alt text,serious\n');
      }
      if (req.url?.startsWith('/report/r1.json')) {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ score: 80, issues: [{ rule: 'wcag-1.1.1', message: 'img missing alt' }] }));
      }
      if (req.url?.startsWith('/monitor')) {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ monitors: [] }));
      }
      if (req.url === '/.well-known/agent.json') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ name: 'accessibility-checker', protocolVersion: '0.3' }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(
  () =>
    new Promise((r) => {
      server.closeAllConnections?.();
      server.close(() => r());
    }),
);

async function run(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
      timeout: 15000,
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('rules returns the manifest over --api flag', async () => {
  const r = await run(['rules', '--api', base]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { rules: [{ id: 'wcag-1.1.1', name: 'alt text' }] });
});

test('rules returns the manifest over LAZYNEXT_A11Y_API env', async () => {
  const r = await run(['rules'], { LAZYNEXT_A11Y_API: base });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { rules: [{ id: 'wcag-1.1.1', name: 'alt text' }] });
});

test('scan posts the URL body and prints the result', async () => {
  requests.length = 0;
  const r = await run(['scan', 'https://example.com', '--api', base]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).score, 80);
  assert.equal(requests.at(-1).path, '/scan');
  assert.deepEqual(JSON.parse(requests.at(-1).body), { url: 'https://example.com' });
});

test('scan --site carries site:true', async () => {
  requests.length = 0;
  const r = await run(['scan', 'https://example.com', '--site', '--api', base]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(requests.at(-1).body).site, true);
});

test('scan --license forwards the license key', async () => {
  requests.length = 0;
  const r = await run(['scan', 'https://example.com', '--api', base, '--license', 'pro-key']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(requests.at(-1).body).license, 'pro-key');
});

test('scan-html reads the file and posts html body', async () => {
  const f = join(tmpdir(), `a11y-cli-${process.pid}.html`);
  writeFileSync(f, '<html><body><img src="x.png"></body></html>');
  try {
    requests.length = 0;
    const r = await run(['scan-html', f, '--api', base]);
    assert.equal(r.status, 0, r.stderr);
    const sent = JSON.parse(requests.at(-1).body);
    assert.match(sent.html, /<img src="x.png">/);
  } finally {
    unlinkSync(f);
  }
});

test('report <id> writes the CSV to stdout', async () => {
  const r = await run(['report', 'r1', '--api', base]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^rule,criterion,impact\nwcag-1\.1\.1/);
});

test('report <id> --json prints the parsed report object', async () => {
  requests.length = 0;
  const r = await run(['report', 'r1', '--json', '--api', base]);
  assert.equal(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.score, 80);
  assert.equal(requests.at(-1).path, '/report/r1.json');
});

test('report <id> --json --level forwards the view filter', async () => {
  requests.length = 0;
  const r = await run(['report', 'r1', '--json', '--level', 'A', '--api', base]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(requests.at(-1).path, /^\/report\/r1\.json\?level=A/);
});

test('report-url and badge print URLs without a server call', async () => {
  requests.length = 0;
  const a = await run(['report-url', 'r1', '--api', 'https://x.test']);
  assert.equal(a.stdout.trim(), 'https://x.test/report/r1');
  const b = await run(['badge', 'r1', '--api', 'https://x.test']);
  assert.equal(b.stdout.trim(), 'https://x.test/badge/r1.svg');
  assert.equal(requests.length, 0);
});

test('monitor list requires a license', async () => {
  const r = await run(['monitor', 'list', '--api', base], { LAZYNEXT_A11Y_LICENSE: '' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs --license/);
});

test('monitor list works with license', async () => {
  const r = await run(['monitor', 'list', '--api', base, '--license', 'pro-key']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(requests.at(-1).path, /license=pro-key/);
});

test('agent-card fetches the well-known doc', async () => {
  const r = await run(['agent-card', '--api', base]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).name, 'accessibility-checker');
});

test('usage errors exit 2 with help on stderr', async () => {
  const r = await run(['bogus', '--api', base]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command bogus/);
  const r2 = await run(['scan', '--api', base]);
  assert.equal(r2.status, 2);
});

test('API errors exit 1 with the message on stderr', async () => {
  const r = await run(['scan', 'https://rate-limited.example', '--api', base]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /429.*daily quota/);
});

test('--version matches package.json', async () => {
  const r = await run(['--version']);
  const pkg = JSON.parse(readFileSync(join(CLI, '..', '..', 'package.json'), 'utf8'));
  assert.equal(r.stdout.trim(), pkg.version);
});
