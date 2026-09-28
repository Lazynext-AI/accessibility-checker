// The coverage doc must always equal scripts/gen-coverage.mjs output — a
// manifest edit committed without regeneration fails here, which closes the
// stale-doc drift class the AGENTS.md "regenerate, don't hand-edit" note
// could not previously enforce.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { generateDoc } from '../scripts/gen-coverage.mjs';
import { RULES } from '../src/rules/manifest.js';

const DOC_PATH = new URL('../docs/wcag-coverage.md', import.meta.url);

test('docs/wcag-coverage.md matches generator output', () => {
  assert.equal(readFileSync(DOC_PATH, 'utf8'), generateDoc());
});

test('generator counts match the manifest', () => {
  const doc = generateDoc();
  const wcag = RULES.filter((r) => r.level !== 'BP');
  for (const r of wcag) assert.ok(doc.includes(`| ${r.rule} —`), `missing row for ${r.rule}`);
  assert.ok(doc.startsWith(`# WCAG Coverage Reference\n\n${wcag.length} WCAG success criteria`));
});
