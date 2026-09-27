// Go SDK coverage via `go test` — runs when a Go toolchain is on PATH
// (ubuntu-latest ships one; the test gate skips cleanly elsewhere, matching
// the authed-test convention). Also asserts gofmt-clean, the Go equivalent
// of the repo's whitespace hygiene lint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);
const SDK = join(dirname(fileURLToPath(import.meta.url)), '..', 'sdk', 'go');

async function hasGo() {
  try {
    await execFileP('go', ['version'], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

test('go test . — checker package', async (t) => {
  if (!(await hasGo())) return t.skip('go toolchain not installed');
  await execFileP('go', ['test', '.'], { cwd: SDK, timeout: 120000 });
});

test('gofmt clean', async (t) => {
  if (!(await hasGo())) return t.skip('go toolchain not installed');
  const { stdout } = await execFileP('gofmt', ['-l', '.'], { cwd: SDK, timeout: 10000 });
  assert.equal(stdout.trim(), '', `gofmt-dirty files: ${stdout}`);
});
