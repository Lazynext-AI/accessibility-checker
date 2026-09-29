#!/usr/bin/env node
// CI gate for the Accessibility Checker API.
// Posts a scan, prints findings, exits 1 when the score is under the
// threshold or a fail-on rule is present. Works standalone and inside
// the GitHub Action (action.yml).
//
//   node scripts/ci-scan.mjs --url https://example.com [--site]
//     [--license you@example.com] [--fail-under 80]
//     [--fail-on wcag-1.1.1,wcag-2.1.2] [--api https://…/scan]

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, "")] = args[i + 1];

const url = opt.url;
const api = opt.api ?? "https://checker.lazynext.com/scan";
const failUnder = Number(opt["fail-under"] ?? 80);
const failOn = new Set((opt["fail-on"] ?? "").split(",").map(s => s.trim()).filter(Boolean));
const site = opt.site === "true" || opt.site === "1";
const license = opt.license;

if (!url) {
  console.error("usage: ci-scan.mjs --url <url> [--site] [--license <email>] [--fail-under <n>] [--fail-on <rules>] [--api <endpoint>]");
  process.exit(2);
}

const body = { url };
if (site) body.site = true;
if (license) body.license = license;

const ATTEMPTS = 3;
const TIMEOUT_MS = 120_000;
let res = null;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    res = await fetch(api, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok && res.status >= 500 && attempt < ATTEMPTS) {
      console.error(`scan attempt ${attempt}/${ATTEMPTS} got HTTP ${res.status}; retrying`);
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 5000)));
      continue;
    }
    break;
  } catch (err) {
    if (attempt === ATTEMPTS) throw err;
    const ms = Math.min(2000 * attempt, 5000);
    console.error(`scan attempt ${attempt}/${ATTEMPTS} failed (${err.name}); retrying in ${ms}ms`);
    await new Promise((r) => setTimeout(r, ms));
  }
}
const data = await res.json().catch(() => null);
if (!res.ok || !data) {
  console.error(`scan failed: HTTP ${res.status} ${JSON.stringify(data)}`);
  process.exit(2);
}

const issues = data.issues ?? [];
const score = data.score ?? 0;
const pages = data.pages?.length ?? (site ? 0 : 1);

console.log(`Accessibility score: ${score}/100${data.rendered ? " (rendered)" : ""}${pages ? ` across ${pages} page(s)` : ""}`);
if (data.report) console.log(`Report: ${data.report}`);
for (const i of issues) {
  const where = i.url ? `${i.url} — ` : "";
  console.log(`  ${i.rule}: ${where}${i.message}`);
}

// GitHub Actions step summary
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  const lines = [
    `## Accessibility scan — ${score}/100`,
    ``,
    `| Rule | Page | Finding | Fix |`,
    `|---|---|---|---|`,
    ...issues.slice(0, 50).map(i =>
      `| \`${i.rule}\` | ${i.url ?? url} | ${i.message} | ${i.fix ?? "—"} |`),
    ``,
    data.report ? `[Full report](${data.report})` : "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

const failHits = [...failOn].filter(r => issues.some(i => i.rule === r));
if (failHits.length) {
  console.error(`FAIL: required-rule violation(s): ${failHits.join(", ")}`);
  process.exit(1);
}
if (score < failUnder) {
  console.error(`FAIL: score ${score} < ${failUnder}`);
  process.exit(1);
}
console.log("PASS");
