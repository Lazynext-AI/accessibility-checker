// score() weighting — the model derives weights from the rules manifest:
// WCAG level (A=1.0 anchor, AA=0.6, AAA=0.35, BP=0.25), warn-class heuristics
// at half, and repeat occurrences of one rule at half marginal cost.

import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../src/scanner.js';
import { RULES } from '../src/rules/manifest.js';

const iss = (rule, n = 1) => Array.from({ length: n }, (_, i) => ({ rule, message: `m${i}` }));
const byLevel = (level) => RULES.filter((r) => r.level === level && !/warn-class/i.test(r.detects)).map((r) => r.rule);
const warnRules = () => RULES.filter((r) => /warn-class/i.test(r.detects)).map((r) => r.rule);

test('score: empty and unknown-rule behavior preserved', () => {
  assert.equal(score([]), 100);
  assert.equal(score([{ rule: 'x', message: 'y' }]), score(iss('x')));
  // Unknown rules count 1.0 each — same as the pre-weighted flat model when
  // the findings are distinct rules.
  const distinct = Array.from({ length: 10 }, (_, i) => ({ rule: `u${i}`, message: 'm' }));
  assert.equal(score(distinct), Math.round(100 * Math.exp(-10 / 15)));
  // Ten repeats of one unknown rule get the half-marginal discount (w=5.5).
  assert.equal(score(iss('nope', 10)), Math.round(100 * Math.exp(-5.5 / 15)));
});

test('score: confirmed A-level issue weighs 1.0 (flat-model anchor)', () => {
  const a = byLevel('A');
  assert.ok(a.length > 5, 'manifest must carry A-level rules');
  const ten = a.slice(0, 10).flatMap((r) => iss(r));
  assert.equal(score(ten), Math.round(100 * Math.exp(-10 / 15)));
});

test('score: level ordering — A costs more than AA costs more than AAA', () => {
  const one = (lvl) => score(iss(byLevel(lvl)[0]));
  assert.ok(one('A') < one('AA'), 'A finding should score lower than AA');
  assert.ok(one('AA') < one('AAA'), 'AA finding should score lower than AAA');
});

test('score: warn-class heuristic costs half of its level weight', () => {
  const warnAAA = warnRules().find((r) => RULES.find((m) => m.rule === r).level === 'AAA');
  const hardAAA = byLevel('AAA')[0];
  assert.ok(warnAAA, 'manifest must carry AAA warn-class rules');
  assert.ok(score(iss(warnAAA)) > score(iss(hardAAA)), 'warn finding should score higher than confirmed');
});

test('score: best-practice finding weighs less than any criterion', () => {
  const bp = RULES.find((r) => r.level === 'BP');
  assert.ok(bp, 'manifest must carry the bp- rule');
  assert.ok(score(iss(bp.rule)) > score(iss(byLevel('AAA')[0])));
});

test('score: repeat occurrences of one rule cost half marginal weight', () => {
  const r = byLevel('A')[0];
  // w = 1 + 3*0.5 = 2.5 for four same-rule findings.
  assert.equal(score(iss(r, 4)), Math.round(100 * Math.exp(-2.5 / 15)));
  // And repeats of one rule outscore the same count of distinct A rules.
  const distinct = byLevel('A').slice(0, 4).flatMap((x) => iss(x));
  assert.ok(score(iss(r, 4)) > score(distinct));
});

test('score: weighted sum can only rise vs the flat model', () => {
  const mixed = [
    ...iss(byLevel('A')[0], 3),
    ...iss(byLevel('AA')[0]),
    ...iss(byLevel('AAA')[0], 2),
    ...iss('bp-visible-controls'),
    ...iss('unknown-rule', 2),
  ];
  assert.ok(score(mixed) >= Math.round(100 * Math.exp(-mixed.length / 15)));
});
