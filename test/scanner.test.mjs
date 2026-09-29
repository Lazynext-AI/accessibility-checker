import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanHtml, checkContrast, checkFacts, checkFocus, score } from '../src/scanner.js';

const rules = (issues) => issues.map((i) => i.rule);

test('img without alt is wcag-1.1.1', () => {
  const issues = scanHtml('<html lang="en"><head><title>t</title></head><body><main><h1>x</h1><img src="a.png"><a href="/x">read the docs</a></main></body></html>');
  assert.ok(rules(issues).includes('wcag-1.1.1'));
});

test('clean markup avoids the common rules', () => {
  const issues = scanHtml('<html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width"></head><body><main><h1>x</h1><img src="a.png" alt="a"><label>n<input></label><a href="/x">read the docs</a></main></body></html>');
  assert.deepEqual(issues, []);
});

test('low contrast is wcag-1.4.3, good contrast passes', () => {
  const bad = checkContrast([{ tag: 'p', text: 'hi', color: 'rgb(153,153,153)', bg: 'rgb(255,255,255)', size: 16, weight: '400' }]);
  assert.equal(bad[0].rule, 'wcag-1.4.3');
  const good = checkContrast([{ tag: 'p', text: 'hi', color: 'rgb(0,0,0)', bg: 'rgb(255,255,255)', size: 16, weight: '400' }]);
  assert.deepEqual(good, []);
});

test('large bold text uses the 3:1 threshold', () => {
  const els = [{ tag: 'h1', text: 'big', color: 'rgb(120,120,120)', bg: 'rgb(255,255,255)', size: 24, weight: '700' }];
  const issues = checkContrast(els); // ~3.9:1 — fails 4.5 but passes 3:1
  assert.deepEqual(issues, []);
});

test('facts map to the right rules', () => {
  const issues = checkFacts({ iframesNoTitle: 2, duplicateIds: 1, skipLink: false });
  const r = rules(issues);
  assert.ok(r.includes('wcag-4.1.2') && r.includes('wcag-4.1.1') && r.includes('wcag-2.4.1'));
});

test('focus: empty and single-element traces are 2.1.1', () => {
  assert.equal(checkFocus([])[0].rule, 'wcag-2.1.1');
  assert.equal(checkFocus(['a#x', 'a#x', 'a#x', 'a#x', 'a#x', 'a#x', 'a#x', 'a#x', 'a#x', 'a#x'])[0].rule, 'wcag-2.1.1');
});

test('focus: sparse-page silence — single/zero focusables with no pointer-only evidence is conformant', () => {
  // census knows exactly one focusable and no cursor:pointer regions →
  // nothing else asks for interaction; the lone link IS keyboard-operable.
  assert.deepEqual(checkFocus(['a#x'], 1, 0), []);
  assert.deepEqual(checkFocus(['body', 'body', 'body', 'body'], 0, 0), []);
});

test('focus: pointer-only census is 2.1.1 evidence', () => {
  // cursor:pointer regions outside every focusable — framework-bound
  // controls (no onclick attr for the markup statics) still get caught.
  assert.equal(checkFocus(['a#x'], 1, 3)[0].rule, 'wcag-2.1.1');
  assert.match(checkFocus(['a#x'], 1, 3, ['div#cta:Buy'])[0].message, /cursor:pointer/);
  assert.equal(checkFocus(['body', 'body', 'body', 'body'], 0, 4)[0].rule, 'wcag-2.1.1');
});

test('focus: census of many focusables reached only once is 2.1.1', () => {
  assert.equal(checkFocus(['a#x', 'a#x', 'a#x', 'a#x'], 5, 0)[0].rule, 'wcag-2.1.1');
  assert.match(checkFocus(['a#x', 'a#x', 'a#x', 'a#x'], 5, 0)[0].message, /1 of 5/);
});

test('focus: unknown census keeps the conservative warn', () => {
  // Older render builds send no focusable/pointerOnly — warn stays.
  assert.equal(checkFocus(['a#x'], 1)[0].rule, 'wcag-2.1.1');
  assert.equal(checkFocus(['body', 'body'], 0)[0].rule, 'wcag-2.1.1');
});

test('focus: a stuck run among multiple elements is 2.1.2', () => {
  const trace = ['a#x', 'button:y', 'div[role=dialog]', 'div[role=dialog]', 'div[role=dialog]', 'div[role=dialog]', 'div[role=dialog]', 'a#x', 'button:y', 'input:z'];
  assert.equal(checkFocus(trace)[0].rule, 'wcag-2.1.2');
});

test('focus: healthy trace reports nothing', () => {
  const trace = ['a#1', 'a#2', 'a#3', 'button#b', 'a#4', 'input#i', 'a#5', 'a#6', 'a#7', 'a#8'];
  assert.deepEqual(checkFocus(trace), []);
});

test('score stays within 0-100 and drops with more issues', () => {
  const s0 = score([]);
  const s1 = score([{ rule: 'x', message: 'y' }]);
  const s10 = score(Array.from({ length: 10 }, (_, i) => ({ rule: `r${i}`, message: 'm' })));
  assert.equal(s0, 100);
  assert.ok(s1 < s0 && s10 < s1 && s10 >= 0);
});
