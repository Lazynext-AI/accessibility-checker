/**
 * WCAG 2.2 checks — same pure-function idiom as src/scanner.js and
 * src/rules/additional.js. Consumes the pipeline's extracted inputs
 * (html string); no DOM access.
 *
 * Deliberately not implemented here (need a rendered page or multi-page
 * crawl, not a single-page string scan — all now live in the rendered /
 * site-scan paths, see src/rules/focuscycle.js and src/rules/crosspage.js):
 *   - 2.5.8 target size — implemented via rendered box dimensions.
 *   - 2.4.11/2.4.12/2.4.13 focus obscured/appearance — implemented via
 *     rendered focus trace.
 *   - 3.2.6 consistent help — implemented via cross-page crawl.
 *   - 3.3.9 accessible authentication (enhanced) — AAA, needs interactive
 *     functional testing.
 */

export function scanWcag22(html) {
  const issues = [];
  // Element rules run with <script> bodies stripped — markup-shaped JS
  // strings would double-count real elements (see src/scanner.js).
  const src = String(html ?? "").replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, "<script$1></script>");
  if (!src.trim()) return issues;

  // WCAG 3.3.8 — Accessible Authentication (Minimum): credential fields must
  // support password managers / copy-paste entry. Missing autocomplete on
  // credential inputs and paste blocking both defeat that support.
  for (const m of src.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/type=["']password["']/i.test(tag)) continue;
    if (!/autocomplete=["'](?:current-password|new-password)["']/i.test(tag)) {
      issues.push({
        rule: "wcag-3.3.8",
        message: `password input lacks autocomplete for credential managers: ${tag.slice(0, 80)}`,
      });
    }
  }
  for (const m of src.matchAll(/<input\b[^>]*type=["'](?:text|email|password|tel)["'][^>]*>/gi)) {
    if (/\sonpaste\s*=\s*["'][^"']*return\s+false/i.test(m[0]) || /\sonpaste\s*=\s*["'][^"']*preventDefault/i.test(m[0])) {
      issues.push({
        rule: "wcag-3.3.8",
        message: `paste is blocked on an input, defeating credential managers: ${m[0].slice(0, 80)}`,
      });
    }
  }

  // WCAG 3.3.7 — Redundant Entry: don't make users re-enter information
  // already provided. Within a single page the detectable case is duplicate
  // credential/contact fields in one form with no distinguishable purpose
  // (confirm/verify fields are acceptable).
  for (const form of src.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)) {
    const inner = form[1];
    const seen = new Map();
    for (const im of inner.matchAll(/<input\b[^>]*>/gi)) {
      const tag = im[0];
      const type = (tag.match(/type=["']([^"']+)["']/i)?.[1] ?? "text").toLowerCase();
      if (!["email", "password", "tel"].includes(type)) continue;
      // A field explicitly marked as confirmation is not redundant entry.
      if (/confirm|verify|repeat/i.test(tag)) continue;
      const count = (seen.get(type) ?? 0) + 1;
      seen.set(type, count);
      if (count > 1) {
        issues.push({
          rule: "wcag-3.3.7",
          message: `form asks for "${type}" ${count} times — redundant entry of the same data: ${tag.slice(0, 80)}`,
        });
      }
    }
  }

  // WCAG 2.5.7 — Dragging Movements: any dragging interaction must have a
  // single-pointer (non-drag) alternative. String scans can't prove an
  // alternative exists, so warn when drag affordances appear at all.
  for (const m of src.matchAll(/<[a-z][^>]*\bdraggable\s*=\s*["']?true["']?[^>]*>/gi)) {
    issues.push({
      rule: "wcag-2.5.7",
      message: `draggable element needs a non-dragging alternative control: ${m[0].slice(0, 80)}`,
    });
  }
  for (const m of src.matchAll(/<[a-z][^>]*\b(?:ondragstart|ondragover|ondrop)\s*=\s*["'][^"']*["'][^>]*>/gi)) {
    issues.push({
      rule: "wcag-2.5.7",
      message: `inline drag handler needs a non-dragging alternative control: ${m[0].slice(0, 80)}`,
    });
  }

  // Visible Controls — best-practice check (emits bp-visible-controls):
  // interactive controls that only appear on pointer hover give keyboard
  // users no visible target. Drafted as WCAG 2.2 SC 3.2.7 but REMOVED from
  // the final spec (w3c/wcag#3587 — the WG found no binary pass/fail rule
  // survived testing), so published WCAG 2.2 has no 3.2.7. Kept as a
  // warn-class best-practice finding, not a criterion claim. The
  // failure signature in CSS: a hidden-by-default rule (opacity:0,
  // visibility:hidden, display:none) plus a :hover reveal, with no matching
  // :focus/:focus-visible/:focus-within reveal for the same target.
  // Warn-class heuristic over inline <style> blocks; descendant reveals
  // (.row:hover .actions) normalize by stripping the pseudo so
  // .row:focus-within .actions counts as its keyboard counterpart.
  const styleCss = [...src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  if (styleCss) {
    const hiddenSel = new Set();
    const hoverKeys = new Map();
    const focusKeys = new Set();
    for (const m of styleCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decl = m[2];
      const hides = /opacity\s*:\s*0(?:\.0+)?\s*(?:!important)?\s*(?:;|$)/i.test(decl)
        || /visibility\s*:\s*hidden/i.test(decl)
        || /display\s*:\s*none/i.test(decl);
      const reveals = /opacity\s*:\s*(?:1|0?\.[0-9]*[1-9][0-9]*)/i.test(decl)
        || /visibility\s*:\s*visible/i.test(decl)
        || /display\s*:\s*(?:block|inline-block|inline|flex|grid|contents)\b/i.test(decl);
      for (const raw of m[1].split(",")) {
        const sel = raw.trim();
        if (!sel) continue;
        const norm = sel.replace(/\s+/g, " ");
        const hasPseudo = /:(?:hover|focus(?:-within|-visible)?|active)\b/i.test(sel);
        if (hides && !hasPseudo) hiddenSel.add(norm);
        if (reveals && /:hover\b/i.test(sel)) {
          hoverKeys.set(sel.replace(/:hover\b/gi, "").replace(/\s+/g, " ").trim(), sel);
        }
        if (reveals && /:focus(?:-within|-visible)?\b/i.test(sel)) {
          focusKeys.add(sel.replace(/:focus(?:-within|-visible)?\b/gi, "").replace(/\s+/g, " ").trim());
        }
      }
    }
    for (const [key, orig] of hoverKeys) {
      if (focusKeys.has(key)) continue;
      // Require the reveal target to be hidden by default — the tail
      // compound of the normalized selector (or the whole key) must match a
      // hidden rule, otherwise the hover rule isn't concealing anything.
      const tail = key.split(/\s+/).pop();
      if (hiddenSel.has(key) || hiddenSel.has(tail)) {
        issues.push({
          rule: "bp-visible-controls",
          message: `control hidden by default is revealed on :hover only — verify keyboard users can reveal it (needs a :focus/:focus-within counterpart): ${orig.slice(0, 80)}`,
        });
      }
    }
  }

  return issues;
}
