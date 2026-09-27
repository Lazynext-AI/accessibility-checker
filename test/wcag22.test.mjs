import { test } from "node:test";
import assert from "node:assert/strict";
import { scanWcag22 } from "../src/rules/wcag22.js";

const rules = (html) => scanWcag22(html).map((i) => i.rule);

test("3.3.8 flags password input without autocomplete", () => {
  const issues = scanWcag22(`<form><input type="password" name="pw"></form>`);
  assert.ok(issues.some((i) => i.rule === "wcag-3.3.8" && /autocomplete/.test(i.message)));
});

test("3.3.8 accepts password input with autocomplete", () => {
  assert.deepEqual(
    rules(`<input type="password" autocomplete="current-password">`),
    []
  );
  assert.deepEqual(
    rules(`<input type="password" autocomplete="new-password">`),
    []
  );
});

test("3.3.8 flags paste blocking", () => {
  const issues = scanWcag22(`<input type="email" onpaste="return false">`);
  assert.ok(issues.some((i) => i.rule === "wcag-3.3.8" && /paste/.test(i.message)));
});

test("3.3.7 flags duplicate email fields in one form", () => {
  const issues = scanWcag22(
    `<form><input type="email" name="a"><input type="email" name="b"></form>`
  );
  assert.ok(issues.some((i) => i.rule === "wcag-3.3.7"));
});

test("3.3.7 allows a confirm-marked duplicate", () => {
  assert.deepEqual(
    rules(`<form><input type="password" autocomplete="new-password"><input type="password" name="confirm" autocomplete="new-password"></form>`),
    []
  );
});

test("3.3.7 does not fire across separate forms", () => {
  assert.deepEqual(
    rules(`<form><input type="email"></form><form><input type="email"></form>`),
    []
  );
});

test("2.5.7 flags draggable elements", () => {
  assert.ok(rules(`<div draggable="true">drag me</div>`).includes("wcag-2.5.7"));
  assert.ok(rules(`<li draggable=true>x</li>`).includes("wcag-2.5.7"));
});

test("2.5.7 flags inline drag handlers", () => {
  assert.ok(rules(`<div ondrop="handleDrop(event)">zone</div>`).includes("wcag-2.5.7"));
  assert.ok(rules(`<img src="a.png" ondragstart="d()">`).includes("wcag-2.5.7"));
});

test("bp-visible-controls flags hover-only reveal with no focus counterpart", () => {
  const issues = scanWcag22(
    `<style>.actions { opacity: 0 } .card:hover .actions { opacity: 1 }</style><div class="card"><button class="actions">go</button></div>`
  );
  assert.ok(issues.some((i) => i.rule === "bp-visible-controls"));
});

test("bp-visible-controls accepts a focus-within counterpart", () => {
  assert.deepEqual(
    rules(`<style>.actions { opacity: 0 } .card:hover .actions { opacity: 1 } .card:focus-within .actions { opacity: 1 }</style>`),
    []
  );
});

test("bp-visible-controls accepts a :focus-visible counterpart on the same selector", () => {
  assert.deepEqual(
    rules(`<style>button.ghost { opacity: 0 } button.ghost:hover { opacity: 1 } button.ghost:focus-visible { opacity: 1 }</style>`),
    []
  );
});

test("bp-visible-controls flags display:none hover reveal without focus", () => {
  const issues = scanWcag22(
    `<style>.menu button { display: none } .menu:hover button { display: block }</style>`
  );
  assert.ok(issues.some((i) => i.rule === "bp-visible-controls"));
});

test("bp-visible-controls ignores hover styling when nothing is hidden", () => {
  assert.deepEqual(
    rules(`<style>a:hover { opacity: 0.8 } button:hover { display: block }</style>`),
    []
  );
});

test("bp-visible-controls flags visibility:hidden revealed only on :hover", () => {
  const issues = scanWcag22(
    `<style>.tools { visibility: hidden } li:hover .tools { visibility: visible }</style>`
  );
  assert.ok(issues.some((i) => i.rule === "bp-visible-controls"));
});

test("clean html produces no issues", () => {
  assert.deepEqual(
    rules(`<form><input type="email" name="e" autocomplete="email"><input type="password" autocomplete="current-password"></form>`),
    []
  );
  assert.deepEqual(scanWcag22(""), []);
  assert.deepEqual(scanWcag22(null), []);
});
