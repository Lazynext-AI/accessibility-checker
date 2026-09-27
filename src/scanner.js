/**
 * WCAG accessibility scanner — dependency-free ES module.
 * Runs in Cloudflare Workers, browsers, and Node: pure string/DOM-free checks
 * over HTML markup. Ported from accessibility_checker.py so the deployed
 * Worker and the Python engine share one rule set.
 */

export function scanHtml(html) {
  const issues = [];
  // Element rules run with <script> bodies stripped — JS strings routinely
  // carry markup-shaped text ("<img ...>", 'id="x"') that would otherwise
  // double-count real elements. Tag attributes survive (src=, type= stay
  // matchable); scripts inside serialized shadow templates don't execute
  // anyway, so stripping them is semantically correct too.
  const src = String(html ?? "").replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, "<script$1></script>");
  if (!src.trim()) return [{ rule: "empty", message: "No HTML content to scan" }];
  const lower = src.toLowerCase();

  if (lower.includes("<html") && !/<html[^>]*\blang=/i.test(src)) {
    issues.push({ rule: "wcag-3.1.1", message: "<html> is missing a lang attribute" });
  }
  if (lower.includes("<head") && !lower.includes("<title")) {
    issues.push({ rule: "wcag-2.4.2", message: "page is missing a <title>" });
  }

  for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
    if (!/alt\s*=/i.test(m[0])) {
      issues.push({ rule: "wcag-1.1.1", message: `<img> missing alt text: ${m[0].slice(0, 80)}` });
    }
  }

  const headings = [...src.matchAll(/<h([1-6])\b[^>]*>/gi)].map((m) => Number(m[1]));
  if (headings.length) {
    if (headings[0] !== 1) issues.push({ rule: "wcag-1.3.1", message: "first heading is not <h1>" });
    let prev = 0;
    for (const level of headings) {
      if (prev && level > prev + 1) issues.push({ rule: "wcag-1.3.1", message: `heading level skipped (h${level} after h${prev})` });
      prev = level;
    }
  } else {
    issues.push({ rule: "wcag-1.3.1", message: "no headings found on the page" });
  }

  const labelSpans = [...src.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].map((m) => [m.index, m.index + m[0].length]);
  for (const m of src.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    if (/type=["'](?:hidden|submit|button|image)/i.test(tag)) continue;
    const idm = tag.match(/\bid=["']([^"']+)/i);
    const wrapped = labelSpans.some(([s, e]) => m.index > s && m.index < e);
    const labeled = wrapped || (idm && new RegExp(`<label[^>]*\\bfor=["']${idm[1]}["']`, "i").test(src));
    if (!labeled && !/aria-label/i.test(tag)) {
      issues.push({ rule: "wcag-3.3.2", message: `<input> has no associated label: ${tag.slice(0, 80)}` });
    }
  }

  for (const m of src.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, "").trim().toLowerCase();
    if (["click here", "here", "read more", "more", "link"].includes(text)) {
      issues.push({ rule: "wcag-2.4.4", message: `vague link text "${text}"` });
    }
  }

  if (/name=["']viewport["'][^>]*user-scalable=no/i.test(src)) {
    issues.push({ rule: "wcag-1.4.4", message: "viewport disables zoom (user-scalable=no)" });
  }
  if (!/role=["'](?:main|banner|navigation|contentinfo)/i.test(src) && !lower.includes("<main")) {
    issues.push({ rule: "wcag-1.3.1", message: "no landmark region (<main> or role) found" });
  }

  return issues;
}

export function score(issues) {
  // Exponential decay: keeps resolution across the whole range so a site with
  // 30 findings still differentiates from one with 10 (and score-drop alerts
  // stay meaningful). 0 issues = 100; 5 ≈ 72; 10 ≈ 51; 15 ≈ 37; 30 ≈ 14.
  return Math.max(0, Math.round(100 * Math.exp(-issues.length / 15)));
}

// --- rendered-DOM contrast checks (WCAG 1.4.3) -------------------------------

export function parseColor(s) {
  if (!s) return null;
  const m = String(s).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  const h = String(s).match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (h) {
    const hex = h[1].length === 3 ? h[1].split("").map((c) => c + c).join("") : h[1];
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  return null;
}

export function luminance(c) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function checkContrast(styles) {
  const issues = [];
  for (const el of styles ?? []) {
    const fg = parseColor(el.color);
    const bg = parseColor(el.bg);
    if (!fg || !bg || fg.a === 0 || bg.a === 0) continue;
    const l1 = luminance(fg), l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = el.size >= 24 || (el.size >= 18.66 && parseInt(el.weight, 10) >= 700);
    const min = large ? 3 : 4.5;
    if (ratio < min) {
      issues.push({
        rule: "wcag-1.4.3",
        message: `contrast ${ratio.toFixed(2)}:1 below ${min}:1 on <${el.tag}> "${String(el.text).slice(0, 40)}"`,
      });
    }
  }
  return issues;
}

// --- rendered-DOM facts (WCAG 1.1.1, 1.2.1, 1.3.1, 2.4.1, 4.1.2) ------------

export function checkFacts(facts) {
  const issues = [];
  if (!facts) return issues;
  if (facts.iframesNoTitle > 0) issues.push({ rule: "wcag-4.1.2", message: `${facts.iframesNoTitle} <iframe> without a title attribute` });
  if (facts.duplicateIds > 0) issues.push({ rule: "wcag-4.1.1", message: `${facts.duplicateIds} duplicate id attribute(s) on the page` });
  if (facts.ariaHiddenFocusable > 0) issues.push({ rule: "wcag-4.1.2", message: `${facts.ariaHiddenFocusable} focusable element(s) inside aria-hidden containers` });
  if (facts.autofocus > 0) issues.push({ rule: "wcag-3.2.1", message: "autofocus attribute moves focus without user request" });
  if (facts.blankNoopener > 0) issues.push({ rule: "wcag-3.2.5", message: `${facts.blankNoopener} target="_blank" link(s) without rel="noopener"` });
  if (facts.mediaNoCaptions > 0) issues.push({ rule: "wcag-1.2.1", message: `${facts.mediaNoCaptions} <video>/<audio> element(s) without captions` });
  if (facts.tablesNoHeaders > 0) issues.push({ rule: "wcag-1.3.1", message: `${facts.tablesNoHeaders} <table> without header cells (<th>)` });
  if (facts.skipLink === false) issues.push({ rule: "wcag-2.4.1", message: "no skip-navigation link found" });
  return issues;
}

// --- keyboard trace checks (WCAG 2.1.1, 2.1.2, 2.4.3) ------------------------

export function checkFocus(trace) {
  const issues = [];
  if (!Array.isArray(trace) || trace.length === 0) {
    issues.push({ rule: "wcag-2.1.1", message: "no keyboard focus trace captured" });
    return issues;
  }
  const unique = new Set(trace.filter((t) => t && t !== "body"));
  if (unique.size === 0) {
    issues.push({ rule: "wcag-2.1.1", message: "no focusable elements found — page is keyboard-inaccessible" });
    return issues;
  }
  if (unique.size === 1) {
    issues.push({ rule: "wcag-2.1.1", message: "only one focusable element — Tab cannot move through page content" });
    return issues;
  }
  // A real trap: focus gets stuck on one element mid-trace while other
  // focusable elements exist but were never reached afterwards.
  let run = 1, maxRun = 1;
  for (let i = 1; i < trace.length; i++) {
    run = trace[i] === trace[i - 1] ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
  }
  if (maxRun >= 4) {
    issues.push({ rule: "wcag-2.1.2", message: `possible keyboard trap — focus stuck on the same element for ${maxRun} consecutive Tab presses` });
  }
  return issues;
}
