#!/usr/bin/env node
// lazynext-a11y — Accessibility Checker CLI. Wraps the JS SDK; no dependencies.
//   lazynext-a11y scan https://example.com [--site] [--license KEY]
//   lazynext-a11y scan-html page.html
//   lazynext-a11y rules [--pretty]
//   lazynext-a11y report <id> [--json] # CSV (or raw JSON object) to stdout
//   lazynext-a11y monitor list|add|remove [url] --license KEY
//   lazynext-a11y agent-card
// Flags: --api URL (or LAZYNEXT_A11Y_API), --license KEY (or LAZYNEXT_A11Y_LICENSE)

import { readFileSync } from "node:fs";
import { AccessibilityChecker } from "../index.js";

const HELP = `lazynext-a11y — WCAG accessibility scanning from the terminal

USAGE
  lazynext-a11y <command> [args] [flags]

COMMANDS
  scan <url>              Rendered scan (free: 3/day/IP, no key needed)
  scan-html <file>        Scan pasted/local HTML — no quota, no render
  rules                   Full WCAG coverage manifest (JSON)
  report <id>             Stored report as CSV on stdout
                          (--json → parsed object; --level/--rule filter)
  report-url <id>         Print the HTML report URL
  badge <id>              Print the badge SVG URL
  monitor list            List Pro monitors (needs --license)
  monitor add <url>       Add a daily monitor — confirmation email first
  monitor remove <url>    Remove a monitor — confirmation email first
  agent-card              A2A agent card (JSON)

FLAGS
  --site                  Crawl same-origin pages (3 free / 10 Pro)
  --json                  report: emit the raw report object (JSON export)
  --level <A|AA|AAA|BP>   report --json: filter findings by conformance level
  --rule <id>             report --json: filter findings by rule id
  --api <base>            API base (default https://checker.lazynext.com;
                          env: LAZYNEXT_A11Y_API)
  --license <key>         Pro license key (env: LAZYNEXT_A11Y_LICENSE)
  --pretty                Indent JSON output
  -h, --help              This help
  -v, --version           Print version

Exit codes: 0 ok, 1 API/IO error, 2 usage error.
`;

function version() {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return pkg.version;
}

function parse(argv) {
  const args = { pos: [], pretty: false, site: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api") args.api = argv[++i];
    else if (a === "--license") args.license = argv[++i];
    else if (a === "--site") args.site = true;
    else if (a === "--json") args.json = true;
    else if (a === "--level") args.level = argv[++i];
    else if (a === "--rule") args.rule = argv[++i];
    else if (a === "--pretty") args.pretty = true;
    else if (a === "-h" || a === "--help") args.help = true;
    else if (a === "-v" || a === "--version") args.ver = true;
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else args.pos.push(a);
  }
  return args;
}

function out(data, pretty) {
  process.stdout.write(JSON.stringify(data, null, pretty ? 2 : 0) + "\n");
}

function usage(msg) {
  if (msg) process.stderr.write(`error: ${msg}\n\n`);
  process.stderr.write(HELP);
  process.exit(2);
}

async function main() {
  const a = parse(process.argv.slice(2));
  if (a.ver) return process.stdout.write(`${version()}\n`);
  const cmd = a.pos[0];
  if (a.help || !cmd) return process.stdout.write(HELP);

  const api = a.api ?? process.env.LAZYNEXT_A11Y_API;
  const license = a.license ?? process.env.LAZYNEXT_A11Y_LICENSE ?? "";
  const c = new AccessibilityChecker({ ...(api ? { baseUrl: api } : {}), license });

  switch (cmd) {
    case "scan": {
      const url = a.pos[1] ?? usage("scan needs a URL");
      out(await c.scan({ url, site: a.site }), a.pretty);
      break;
    }
    case "scan-html": {
      const file = a.pos[1] ?? usage("scan-html needs a file path");
      const html = readFileSync(file, "utf8");
      out(await c.scan({ html }), a.pretty);
      break;
    }
    case "rules":
      out(await c.rules(), a.pretty);
      break;
    case "report": {
      const id = a.pos[1] ?? usage("report needs a report id");
      if (a.json) out(await c.report(id, { level: a.level, rule: a.rule }), a.pretty);
      else process.stdout.write(await c.reportCsv(id));
      break;
    }
    case "report-url": {
      const id = a.pos[1] ?? usage("report-url needs a report id");
      process.stdout.write(c.reportUrl(id) + "\n");
      break;
    }
    case "badge": {
      const id = a.pos[1] ?? usage("badge needs a report id");
      process.stdout.write(c.badgeUrl(id) + "\n");
      break;
    }
    case "monitor": {
      const sub = a.pos[1];
      const url = a.pos[2];
      if (!license) usage(`monitor ${sub ?? ""} needs --license (or LAZYNEXT_A11Y_LICENSE)`);
      if (sub === "list") out(await c.monitorList(), a.pretty);
      else if (sub === "add") out(await c.monitorAdd(url ?? usage("monitor add needs a URL")), a.pretty);
      else if (sub === "remove") out(await c.monitorRemove(url ?? usage("monitor remove needs a URL")), a.pretty);
      else usage("monitor subcommand: list | add <url> | remove <url>");
      break;
    }
    case "agent-card":
      out(await c.agentCard(), a.pretty);
      break;
    default:
      usage(`unknown command ${cmd}`);
  }
}

main().catch((e) => {
  process.stderr.write(`lazynext-a11y: ${e.message}\n`);
  process.exit(1);
});
