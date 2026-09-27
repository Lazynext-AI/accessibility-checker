import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RULES, RULE_INDEX } from "../src/rules/manifest.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  join(root, "worker.js"),
  join(root, "src/scanner.js"),
  ...readdirSync(join(root, "src/rules"))
    .filter((f) => f.endsWith(".js") && f !== "manifest.js")
    .map((f) => join(root, "src/rules", f)),
];

function emittedIds() {
  const ids = new Set();
  for (const file of sources) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/rule:\s*["'](wcag-[0-9.]+|bp-[a-z0-9-]+)["']/g)) ids.add(m[1]);
  }
  return [...ids].sort();
}

test("manifest covers every rule id the scanner can emit", () => {
  const emitted = emittedIds();
  const listed = RULES.map((r) => r.rule).sort();
  assert.deepEqual(listed, emitted);
});

test("manifest entries carry complete metadata", () => {
  for (const r of RULES) {
    assert.match(r.rule, /^(wcag-\d+\.\d+\.\d+|bp-[a-z0-9-]+)$/, `${r.rule} id shape`);
    assert.ok(r.name.length > 3, `${r.rule} name`);
    if (r.rule.startsWith("wcag-")) {
      // Numbered criteria only: a real published WCAG SC must carry its
      // conformance level and spec version.
      assert.ok(["A", "AA", "AAA"].includes(r.level), `${r.rule} level`);
      assert.ok(["2.0", "2.1", "2.2"].includes(r.wcag), `${r.rule} wcag`);
    } else {
      // bp-* entries are best-practice checks for problems no published
      // criterion covers (e.g. SC 3.2.7 was removed from WCAG 2.2). They
      // must NOT masquerade with a conformance level or spec version.
      assert.equal(r.level, "BP", `${r.rule} level must be BP, not a conformance level`);
      assert.equal(r.wcag, "bp", `${r.rule} wcag must be bp, not a spec version`);
    }
    assert.ok(["static", "rendered", "crosspage"].includes(r.how), `${r.rule} how`);
    assert.ok(r.detects.length > 10, `${r.rule} detects`);
  }
});

test("RULE_INDEX mirrors RULES", () => {
  assert.equal(Object.keys(RULE_INDEX).length, RULES.length);
});
