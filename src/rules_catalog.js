// Browsable HTML catalog of the detection manifest — served at GET /rules when
// the client asks for text/html (JSON stays the default for API/SDK callers).
// Rendered server-side from RULES so the page can never drift from what the
// scanner actually emits; docs/wcag-coverage.md is the generated long-form doc.
import { RULES } from './rules/manifest.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// WCAG principle from the criterion's first number; everything non-numbered
// (bp-*, future prefixes) lands in the best-practice group — which is also
// where level "BP" rows sit, since they claim no conformance level.
const PRINCIPLES = [
  ['Perceivable', '1'],
  ['Operable', '2'],
  ['Understandable', '3'],
  ['Robust', '4'],
];
const groupOf = (r) => {
  if (r.level === 'BP' || r.wcag === 'bp') return 'Best practices';
  const m = /^wcag-(\d)\./.exec(r.rule);
  const hit = m && PRINCIPLES.find(([, n]) => n === m[1]);
  return hit ? hit[0] : 'Best practices';
};

const HOW = {
  static: 'markup scan',
  rendered: 'rendered page',
  crosspage: 'site scan',
};

const LEVEL_STYLE = {
  A: 'background:#dbeafe;color:#1e40af',
  AA: 'background:#dcfce7;color:#166534',
  AAA: 'background:#fef3c7;color:#92400e',
  BP: 'background:#f3e8ff;color:#6b21a8',
};

export function rulesCatalogHtml(origin = 'https://checker.lazynext.com') {
  const groups = new Map();
  for (const r of RULES) {
    const g = groupOf(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const ordered = [...PRINCIPLES.map(([name]) => name), 'Best practices'].filter((n) => groups.has(n));
  const wcagCount = RULES.filter((r) => r.level !== 'BP').length;
  const bpCount = RULES.length - wcagCount;

  const section = (name) => `
    <section>
      <h2>${esc(name)}</h2>
      <table>
        <thead><tr><th>Criterion</th><th>Name</th><th>Level</th><th>WCAG</th><th>How it runs</th><th>What it detects</th></tr></thead>
        <tbody>
          ${groups.get(name).map((r) => `<tr><td><code>${esc(r.rule)}</code></td><td>${esc(r.name)}</td><td><span class="lvl" style="${LEVEL_STYLE[r.level] ?? ''}">${esc(r.level)}</span></td><td>${r.level === 'BP' ? '—' : esc(r.wcag)}</td><td>${esc(HOW[r.how] ?? r.how)}</td><td>${esc(r.detects)}</td></tr>`).join('\n          ')}
        </tbody>
      </table>
    </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Detection coverage — Accessibility Checker</title>
<meta name="description" content="Every WCAG criterion the Lazynext Accessibility Checker detects: ${wcagCount} success criteria plus ${bpCount} best-practice check across static, rendered, and cross-page analysis.">
<link rel="canonical" href="${esc(origin)}/rules">
<meta name="robots" content="index,follow">
<style>
  :root { color-scheme: light; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 0; color: #111827; background: #fff; }
  main { max-width: 72rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
  h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
  h2 { font-size: 1.2rem; margin: 2.25rem 0 .75rem; color: #3730a3; }
  .sub { color: #4b5563; max-width: 46rem; }
  table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  th { text-align: left; padding: .5rem .625rem; border-bottom: 2px solid #e5e7eb; color: #374151; white-space: nowrap; }
  td { padding: .5rem .625rem; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  code { font-size: .8rem; background: #f3f4f6; padding: .1rem .3rem; border-radius: .25rem; white-space: nowrap; }
  .lvl { display: inline-block; padding: .1rem .45rem; border-radius: .375rem; font-weight: 600; font-size: .75rem; }
  nav { font-size: .85rem; margin: .75rem 0 0; }
  footer { margin-top: 3rem; font-size: .8rem; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 1rem; }
  a { color: #4338ca; }
</style>
</head>
<body>
<main>
  <h1>Detection coverage</h1>
  <p class="sub">Every rule the scanner can emit: <b>${wcagCount} WCAG success criteria</b> (A, AA, AAA across WCAG 2.0–2.2)
     plus <b>${bpCount} best-practice check</b> — heuristics for real barriers that have no published criterion.
     Machine-readable manifest: <a href="${esc(origin)}/rules"><code>GET /rules</code></a> (JSON). API contract: <a href="${esc(origin)}/openapi.json"><code>openapi.json</code></a>.</p>
  <nav>${ordered.map((n) => `<a href="#${esc(n.toLowerCase().replace(/ /g, '-'))}">${esc(n)}</a>`).join(' · ')}</nav>
  ${ordered.map((n) => section(n).replace('<h2>', `<h2 id="${esc(n.toLowerCase().replace(/ /g, '-'))}">`)).join('\n')}
  <footer>
    <p><a href="${esc(origin)}/">Accessibility Checker</a> by <a href="https://lazynext.com">Lazynext</a> —
       static markup analysis, rendered-page checks (contrast, focus traces, target size, occlusion),
       and whole-site crawls for cross-page criteria.</p>
  </footer>
</main>
</body>
</html>`;
}
