// Python SDK coverage via `python3 -m unittest` — runs when python3 is on
// PATH (ubuntu-latest ships one; the test gate skips cleanly elsewhere,
// matching the authed-test convention). The suite asserts the named
// lazynext-a11y User-Agent reaches the wire — the Cloudflare 403 fix.
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);
const SDK = join(dirname(fileURLToPath(import.meta.url)), '..', 'sdk', 'python');

test('python3 -m unittest lazynext_a11y', async (t) => {
  try {
    await execFileP('python3', ['--version'], { timeout: 10000 });
  } catch {
    return t.skip('python3 not installed');
  }
  const { stderr } = await execFileP(
    'python3',
    ['-m', 'unittest', 'test_lazynext_a11y', '-v'],
    { cwd: SDK, timeout: 30000 },
  );
  // unittest reports on stderr; a nonzero exit (failure) throws above.
  if (!/OK/.test(stderr)) throw new Error(`unittest did not report OK:\n${stderr}`);
});
