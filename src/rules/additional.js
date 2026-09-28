/**
 * Additional WCAG checks — same pure-function idiom as src/scanner.js.
 * Consumes the pipeline's extracted inputs (html string, styles array);
 * no DOM access. Wired in worker.js next to scanHtml/checkContrast.
 *
 * Deliberately not implemented here:
 *   - 3.2.3 consistent-navigation / 3.2.4 consistent-identification —
 *     live in src/rules/crosspage.js (need multi-page data, wired into
 *     the site-scan path only).
 *   - 3.3.2 labels-or-instructions — already covered by scanHtml's
 *     input/label association check.
 *   - 1.4.4 resize-text — scanHtml already flags user-scalable=no; this
 *     module adds the maximum-scale companion check.
 */

import { parseColor, luminance } from "../scanner.js";

const FOCUSABLE = "(?:a\\b|button\\b|input\\b|select\\b|textarea\\b|\\w+\\s[^>]*tabindex)";

export function scanAdditionalHtml(html) {
  const issues = [];
  const srcRaw = String(html ?? "");
  // Element/attribute rules run on `src` with <script> bodies stripped —
  // markup-shaped JS strings double-count real elements otherwise. The few
  // checks that intentionally inspect script source (devicemotion listeners,
  // orientation.lock, Escape-handler tokens, captcha) use `srcRaw`.
  const src = srcRaw.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, "<script$1></script>");
  if (!src.trim()) return issues;

  // WCAG 2.4.6 — empty headings and labels describe nothing.
  for (const m of src.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const inner = m[1].replace(/<[^>]+>/g, "").trim();
    if (!inner) {
      issues.push({ rule: "wcag-2.4.6", message: `empty heading: ${m[0].slice(0, 60)}` });
    }
  }
  for (const m of src.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)) {
    const inner = m[1].replace(/<[^>]+>/g, "").trim();
    if (!inner && !/<(input|select|textarea)\b/i.test(m[1])) {
      issues.push({ rule: "wcag-2.4.6", message: `empty <label> wraps no control: ${m[0].slice(0, 60)}` });
    }
  }

  // WCAG 2.5.3 — accessible name must contain the visible label text.
  for (const m of src.matchAll(/<(a|button)\b([^>]*aria-label=["']([^"']*)["'][^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const aria = m[3].trim().toLowerCase();
    const visible = m[4].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (visible && aria && !aria.includes(visible)) {
      issues.push({
        rule: "wcag-2.5.3",
        message: `aria-label "${m[3].slice(0, 40)}" does not contain visible text "${visible.slice(0, 40)}"`,
      });
    }
  }

  // WCAG 1.4.4 / 1.4.10 — viewport maximum-scale caps zoom and blocks reflow.
  const vp = src.match(/<meta\b[^>]*name=["']viewport["'][^>]*>/i)?.[0] ?? "";
  const maxScale = vp.match(/maximum-scale\s*=\s*([\d.]+)/i);
  if (maxScale && parseFloat(maxScale[1]) < 2) {
    issues.push({ rule: "wcag-1.4.4", message: `viewport maximum-scale=${maxScale[1]} limits zoom below 200%` });
  }
  // Fixed pixel widths on layout containers prevent reflow at 320px.
  for (const m of src.matchAll(/<(body|main|section|div)\b[^>]*style=["'][^"']*width\s*:\s*(\d{4,})px/gi)) {
    issues.push({ rule: "wcag-1.4.10", message: `<${m[1].toLowerCase()}> has fixed ${m[2]}px width — cannot reflow at 320px` });
    break; // one representative finding is enough
  }

  // WCAG 1.3.2 — Meaningful Sequence: the DOM order assistive tech reads
  // must match the visual order. Markup-visible order-breaking signals:
  // CSS `order` (flex/grid reordering), reversed flex directions, and
  // `unicode-bidi: bidi-override` (explicitly reorders characters). All are
  // warn-class: a sighted user sees the CSS result but the DOM may already
  // be in the correct order regardless — these flag the pattern to review.
  const ORDER_SIGNALS = [
    { re: /(?:^|[^-\w])order\s*:\s*-?\d/i, label: "CSS `order` property reorders flex/grid children" },
    { re: /flex-direction\s*:\s*(?:row|column)-reverse/i, label: "reversed flex-direction presents children backwards" },
    { re: /unicode-bidi\s*:\s*bidi-override/i, label: "unicode-bidi:bidi-override reverses character order" },
  ];
  const cssSources = [...src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
    .concat([...src.matchAll(/\bstyle=["']([^"']*)["']/gi)].map((m) => m[1]));
  for (const css of cssSources) {
    const hit = ORDER_SIGNALS.find((s) => s.re.test(css));
    if (hit) {
      issues.push({ rule: "wcag-1.3.2", message: `${hit.label} — verify visual order matches DOM order` });
      break;
    }
  }
  // aria-flowto explicitly overrides the reading sequence for AT users;
  // presence is the warning signal (the override itself may be justified).
  if (/\baria-flowto\s*=/i.test(src)) {
    issues.push({ rule: "wcag-1.3.2", message: "aria-flowto overrides the reading sequence — verify it preserves a meaningful order" });
  }

  // WCAG 3.1.2 — runs of non-Latin script whose *effective* language doesn't
  // match the text. `lang` inherits through ancestors, so checking only the
  // leaf element's own attribute false-positives on compliant pages —
  // localized <p lang="ar"> blocks in example.com's rendered DOM tripped
  // exactly that live. Walk the open-tag stack instead: the innermost lang
  // (own attr or inherited) must agree with the text's script family.
  // Symbols and emoji aren't language parts, so only letter-script runs
  // count. A run under NO lang anywhere is unmarked — still a violation.
  const LANG_PART_FAMS = [
    { name: "Arabic", re: /[؀-ۿݐ-ݿࢠ-ࣿ]/, langs: /^(ar|fa|ur|ps|sd|ug|ks|ckb|prs|bal|lrc|mzn|glk|aeb|shu|zdj)/i },
    { name: "Hebrew", re: /[֐-׿יִ-אָ]/, langs: /^(he|iw|yi|lad|jpr|jrb)/i },
    { name: "Han", re: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2A6DF}]/u, langs: /^(zh|ja|ko|vi|lzh|och)/i },
    { name: "kana", re: /[぀-ヿㇰ-ㇿｦ-ﾝ]/, langs: /^ja/i },
    { name: "Hangul", re: /[가-힯ᄀ-ᇿ]/, langs: /^ko/i },
    { name: "Bopomofo", re: /[ㄅ-ㄭㆠ-ㆺ]/, langs: /^(zh|hak|cjy)/i },
    { name: "Cyrillic", re: /[Ѐ-ӿԀ-ԯ]/, langs: /^(be|bg|kk|ky|mk|mn|ru|sr|tg|tt|uk|uz|cv|os|ba|ce|ab|sah|udm|mhr|myv|xal|ady|kbd)/i },
    { name: "Devanagari", re: /[ऀ-ॿ꣠-ꣿ]/, langs: /^(hi|mr|ne|sa|kok|doi|mai|bho|awa|mag|new|raj|sat|brx|hne|hoj|kru|lif|noe|pnb|rwr|swv|gom|ks)/i },
    { name: "Bengali", re: /[ঀ-৿]/, langs: /^(bn|as|mni|sat|rkt|bpy|ctg)/i },
    { name: "Gurmukhi", re: /[਀-੿]/, langs: /^(pa|pnb|skr)/i },
    { name: "Gujarati", re: /[ઁ-૿]/, langs: /^(gu|kej|kfr|muh|rab|vaj)/i },
    { name: "Oriya", re: /[଀-୿]/, langs: /^(or|kxv)/i },
    { name: "Tamil", re: /[஀-௿]/, langs: /^(ta|bfq|irh|ptq|taq|uay)/i },
    { name: "Telugu", re: /[ఀ-౿]/, langs: /^(te|gon|lrm|wbq|yan)/i },
    { name: "Kannada", re: /[ಀ-೿]/, langs: /^(kn|kgj|kfa|kfd|sdm|tcy|ull)/i },
    { name: "Malayalam", re: /[ഀ-ൿ]/, langs: /^(ml|ajp|mjs|mnr|sgc)/i },
    { name: "Sinhala", re: /[඀-෿]/, langs: /^(si|pi)/i },
    { name: "Thai", re: /[฀-๿]/, langs: /^(th|tts|sou|kdt|lwl|mfp)/i },
    { name: "Lao", re: /[ກ-໿]/, langs: /^(lo|blt|hnj|kjg|phu|sdt|tts)/i },
    { name: "Tibetan", re: /[ༀ-࿿]/, langs: /^(bo|dz|adx|kgy|lhp|loy|sgd)/i },
    { name: "Myanmar", re: /[က-႟]/, langs: /^(my|blk|kar|ksw|mnw|shn|rki|pwo|kht|csh|zom)/i },
    { name: "Georgian", re: /[Ⴀ-ჿ]/, langs: /^(ka|lzz|sva|xmf|ive|oss)/i },
    { name: "Armenian", re: /[԰-և]/, langs: /^(hy|xcl|hyw|axm)/i },
    { name: "Greek", re: /[Ͱ-Ͽἀ-῿]/, langs: /^(el|grc|cpg|pnt|tsd|yej|jge)/i },
    { name: "Ethiopic", re: /[ሀ-፿ⶀ-ⷿ꬀-ꬿ]/, langs: /^(am|ti|gez|har|om|wal|byn|xan|sgw|tir|tig|bhr|dae|gmz|njm|sto)/i },
    { name: "Cherokee", re: /[Ꭰ-᏿ꭰ-ꭿ]/, langs: /^chr/i },
    { name: "Mongolian", re: /[ᠠ-ᢲ]/, langs: /^(mn|mvf|oih)/i },
    { name: "Tifinagh", re: /[ⴰ-⵿]/, langs: /^(ber|shi|tzm|zgh|rif|tmh|ttq|thv|thz|mzb|taq|siz|zen|jbe)/i },
    { name: "N'Ko", re: /[߀-߿]/, langs: /^(nqo|emk|bam|dyu|man|mlq|msc|jud)/i },
    { name: "Syriac", re: /[܀-ݿ]/, langs: /^(syc|aii|arc|tru|cld|amw|mid|syn|bhn|bji|hrt|kqd|myz|sam|tmr)/i },
    { name: "Vai", re: /[ꕉ-ꖿ]/, langs: /^vai/i },
    { name: "Lisu", re: /[ꓐ-꓿]/, langs: /^(lis|atb|hpo|tpo|ytl|ztp)/i },
  ];
  const VOID_TAGS = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
  const RAWTEXT_TAGS = new Set(["script", "style", "textarea"]);
  const stack = []; // {tag, raw, eff} — eff = effective lang (own attr or inherited)
  for (const m of src.matchAll(/<!--[\s\S]*?-->|<\/(\w+)\s*>|<(\w+)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g)) {
    if (m[1]) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === m[1].toLowerCase()) { stack.length = i; break; }
      }
      continue;
    }
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = m[3] || "";
      if (VOID_TAGS.has(tag) || attrs.trimEnd().endsWith("/")) continue;
      const lm = attrs.match(/(?:^|\s)(?:xml:)?lang\s*=\s*["']?([\w-]+)/i);
      stack.push({ tag, raw: RAWTEXT_TAGS.has(tag), eff: lm ? lm[1].toLowerCase() : stack.length ? stack[stack.length - 1].eff : "" });
      continue;
    }
    if (!m[4] || stack.some((s) => s.raw)) continue;
    const text = m[4].trim();
    if (text.length < 8) continue;
    const eff = stack.length ? stack[stack.length - 1].eff : "";
    const bad = LANG_PART_FAMS.filter((f) => f.re.test(text)).find((f) => !f.langs.test(eff));
    if (!bad) continue;
    issues.push({
      rule: "wcag-3.1.2",
      message: `<${stack.length ? stack[stack.length - 1].tag : "body"}> contains ${bad.name}-script text without a matching lang attribute (effective lang: ${eff || "none"}): "${text.slice(0, 40)}"`,
    });
    break;
  }

  // WCAG 4.1.3 — status/toast regions that assistive tech can't announce.
  for (const m of src.matchAll(/<(\w+)\b([^>]*(?:class|id)=["'][^"']*(?:toast|notification|snackbar|alert|status)[^"']*["'][^>]*)>/gi)) {
    const attrs = m[2];
    if (/role=["'](?:status|alert|log|marquee|timer)["']/i.test(attrs)) continue;
    if (/aria-live\s*=/i.test(attrs)) continue;
    issues.push({
      rule: "wcag-4.1.3",
      message: `<${m[1].toLowerCase()}> looks like a status region but has no role/aria-live: ${m[0].slice(0, 70)}`,
    });
    break;
  }

  // WCAG 2.4.7 — inline outline suppression on focusable elements.
  const outlineNone = new RegExp(`<${FOCUSABLE}[^>]*style=["'][^"']*outline\\s*:\\s*(?:none|0)[^"']*["']`, "i");
  if (outlineNone.test(src)) {
    issues.push({ rule: "wcag-2.4.7", message: "focusable element has inline outline:none — focus indicator may be invisible" });
  }
  // Stylesheet-level suppression is the common real-world failure: a <style>
  // block kills the focus outline globally with no :focus/:focus-visible
  // alternative providing a replacement indicator (outline/box-shadow/border).
  const css = [...src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  if (css) {
    const suppresses =
      /:focus(?:-visible|-within)?\s*[^{}]*\{[^}]*\boutline\s*:\s*(?:none|0)\b/i.test(css) ||
      /(?:^|[};]\s*)(?:\*|a|button|input|select|textarea)\s*\{[^}]*\boutline\s*:\s*(?:none|0)\b/i.test(css);
    const alternative =
      /:focus(?:-visible|-within)?\s*[^{}]*\{[^}]*\b(?:outline\s*:\s*(?!none\b|0\b)|box-shadow|border)/i.test(css);
    if (suppresses && !alternative) {
      issues.push({
        rule: "wcag-2.4.7",
        message: "stylesheet suppresses the focus outline with no :focus/:focus-visible replacement indicator",
      });
    }
  }

  // WCAG 3.2.1 — focusing a control must not trigger a context change
  // (navigation, form submit, window.open). The onfocus handler attribute
  // is the literal mechanism.
  for (const m of src.matchAll(/\bonfocus\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    if (/(?:window\.)?location\s*(?:\.|=\s*)|\.submit\s*\(|\.click\s*\(|window\.open\s*\(/i.test(m[2])) {
      issues.push({
        rule: "wcag-3.2.1",
        message: `onfocus handler navigates or submits — receiving focus must not change context: ${m[0].slice(0, 80)}`,
      });
      break;
    }
  }

  // WCAG 3.2.2 — changing a control's value must not auto-submit or
  // navigate (the classic <select> jump-menu violation).
  for (const m of src.matchAll(/\bon(?:change|input|select)\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    if (/\.submit\s*\(|(?:window\.)?location\s*(?:\.|=\s*)|window\.open\s*\(/i.test(m[2])) {
      issues.push({
        rule: "wcag-3.2.2",
        message: `onchange/oninput handler submits or navigates on value change — users must be able to review input: ${m[0].slice(0, 80)}`,
      });
      break;
    }
  }

  // WCAG 2.2.1 — timed refresh/redirect the user can't control.
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(src)) {
    issues.push({ rule: "wcag-2.2.1", message: "<meta http-equiv=refresh> reloads or redirects on a timer without user control" });
    // WCAG 2.2.4 (AAA) — no interruptions at all: ANY meta refresh fails at
    // Level AAA, even with a long delay the A-level check would tolerate.
    issues.push({ rule: "wcag-2.2.4", message: "<meta http-equiv=refresh> interrupts the user — at Level AAA timed refreshes are never allowed" });
  }

  // WCAG 1.4.2 / 2.2.2 — audio that auto-plays, or moving content with no
  // pause/stop control. Muted video has no audio track to control, so it is
  // skipped (a hero-video pattern, not a violation in practice).
  for (const m of src.matchAll(/<audio\b[^>]*\bautoplay\b[^>]*>/gi)) {
    issues.push({ rule: "wcag-1.4.2", message: `autoplaying <audio> needs a pause/stop control: ${m[0].slice(0, 70)}` });
    break;
  }
  for (const m of src.matchAll(/<video\b([^>]*)\bautoplay\b([^>]*)>/gi)) {
    if (/\bmuted\b/i.test(m[1] + m[2])) continue;
    issues.push({ rule: "wcag-1.4.2", message: `autoplaying <video> (not muted) needs a pause/stop control: ${m[0].slice(0, 70)}` });
    break;
  }
  if (/<marquee\b/i.test(src)) {
    issues.push({ rule: "wcag-2.2.2", message: "<marquee> scrolls without a way to pause or stop it" });
  }

  // WCAG 1.3.5 — inputs collecting the user's personal data need an
  // autocomplete token so browsers and AT can fill them programmatically.
  // (Password fields are covered separately by wcag-3.3.8.)
  const PERSONAL = /name|e-?mail|phone|\btel\b|addr|street|\bcity\b|\bzip\b|postal|country|\borg\b|company|cc-|card|\bbirth|dob|\bage\b|gender|user|login/i;
  for (const m of src.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const type = (tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] ?? "text").toLowerCase();
    if (["hidden", "submit", "button", "checkbox", "radio", "file", "image", "reset", "password", "search", "range", "number", "date", "time", "color"].includes(type)) continue;
    if (/\bautocomplete\s*=/i.test(tag)) continue;
    // Match the field's own identifier (name/id value), not the raw tag —
    // "name=" as an attribute name would otherwise match the PERSONAL regex.
    const fieldId = tag.match(/\b(?:name|id)\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    if (type === "email" || type === "tel" || PERSONAL.test(fieldId)) {
      issues.push({
        rule: "wcag-1.3.5",
        message: `input collecting personal data lacks autocomplete: ${tag.slice(0, 80)}`,
      });
    }
  }

  // WCAG 2.1.4 (A) — Character Key Shortcuts: single-key shortcuts must be
  // turn-offable, remappable, or active only on focus. `accesskey` creates
  // exactly that kind of shortcut, and inline key handlers that act on a
  // bare e.key/keyCode with no modifier guard do the same.
  for (const m of src.matchAll(/<[a-z][^>]*\baccesskey\s*=\s*["'][^"']*["'][^>]*>/gi)) {
    issues.push({
      rule: "wcag-2.1.4",
      message: `accesskey creates a single-key shortcut with no off switch or remapping: ${m[0].slice(0, 80)}`,
    });
  }
  for (const m of src.matchAll(/<[a-z][^>]*\bonkey(?:down|press|up)\s*=\s*(["'])([\s\S]*?)\1[^>]*>/gi)) {
    const code = m[2];
    if (!/(?:\bkey\b|keyCode|which)\b/.test(code)) continue;
    if (/(ctrlKey|altKey|metaKey|shiftKey)/.test(code)) continue; // modified shortcut is allowed
    if (/(location|href|submit\s*\(|\.click\s*\(|window\.open|dispatch)/.test(code)) {
      issues.push({
        rule: "wcag-2.1.4",
        message: `single-character key handler triggers an action with no modifier requirement: ${m[0].slice(0, 80)}`,
      });
    }
  }

  // WCAG 1.4.5 (AA) — Images of Text: a long sentence-like alt on an <img>
  // means the image is really presenting text — screen magnification and
  // user font/color overrides can't reach rasterized text.
  for (const m of src.matchAll(/<img\b[^>]*>/gi)) {
    const alt = m[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    if (alt.length >= 40 && alt.trim().split(/\s+/).length >= 4) {
      issues.push({
        rule: "wcag-1.4.5",
        message: `image appears to present text — use real text instead of an image of text: alt="${alt.slice(0, 60)}"`,
      });
      // WCAG 1.4.9 (AAA) — Images of Text (No Exception): Level AAA permits
      // no images of text at all except pure decoration and logotypes —
      // the AA customization/essential escape doesn't exist. Same
      // heuristic minus the logo/brand exemption.
      if (!/logo|brand|badge/i.test(m[0] + alt)) {
        issues.push({
          rule: "wcag-1.4.9",
          message: `non-logo image of text fails AAA outright (only decoration/logotype exempt): alt="${alt.slice(0, 60)}"`,
        });
      }
    }
    // WCAG 1.1.1 — an alt that just echoes the image filename ("IMG_2045.jpg",
    // "logo.png") isn't a text alternative; it conveys nothing to AT. Flag alt
    // values that literally carry an image extension or exactly equal the src
    // basename (extension stripped). Requires alt= present — the missing-alt
    // case already reports from scanner.js.
    const trimmedAlt = alt.trim();
    if (trimmedAlt) {
      const srcFile = m[0].match(/\bsrc\s*=\s*["']([^"']+?)["']/i)?.[1]
        ?.split("?")[0].split("/").pop() ?? "";
      const base = srcFile.replace(/\.[^.]+$/, "").toLowerCase();
      if (/\.(?:jpe?g|png|gif|webp|avif|bmp|tiff?|svg)$/i.test(trimmedAlt) ||
          (base && trimmedAlt.replace(/\.[^.]+$/, "").toLowerCase() === base)) {
        issues.push({
          rule: "wcag-1.1.1",
          message: `<img> alt text is just the filename — write a real description: alt="${trimmedAlt.slice(0, 60)}"`,
        });
      }
    }
  }

  // WCAG 2.4.5 (AA) — Multiple Ways: a content page should offer more than
  // the nav menu alone (site search or a sitemap link). Flagged only when a
  // link-heavy page has a nav but no second mechanism — small pages and
  // process steps are out of scope by the criterion itself.
  {
    const linkCount = src.match(/<a\b[^>]*\bhref\s*=/gi)?.length ?? 0;
    const hasNav = /<nav\b|role\s*=\s*["']navigation["']/i.test(src);
    const hasSearch = /type\s*=\s*["']search["']|role\s*=\s*["']search["']/i.test(src);
    const hasSitemapLink = /<a\b[^>]*href\s*=\s*["'][^"']*sitemap[^"']*["']/i.test(src);
    if (linkCount > 15 && hasNav && !hasSearch && !hasSitemapLink) {
      issues.push({
        rule: "wcag-2.4.5",
        message: "this page offers only one way to navigate (the nav menu) — provide a second mechanism such as search or a sitemap link",
      });
    }
  }

  // WCAG 1.4.8 (AAA) — Visual Presentation: justified text without
  // hyphenation creates uneven "rivers" that impair readability.
  for (const m of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/text-align\s*:\s*justify/i.test(m[1]) && !/hyphens\s*:\s*(?:auto|manual)/i.test(m[1])) {
      issues.push({
        rule: "wcag-1.4.8",
        message: "stylesheet uses text-align:justify without hyphenation — uneven word spacing harms readability",
      });
      break;
    }
  }
  for (const m of src.matchAll(/<[a-z][^>]*\bstyle\s*=\s*["'][^"']*text-align\s*:\s*justify[^"']*["'][^>]*>/gi)) {
    if (!/hyphens\s*:\s*(?:auto|manual)/i.test(m[0])) {
      issues.push({
        rule: "wcag-1.4.8",
        message: `justified text without hyphenation: ${m[0].slice(0, 80)}`,
      });
      break;
    }
  }

  // WCAG 4.1.2 (A) — Name, Role, Value: a control with no accessible name is
  // announced as "button" or "link" with nothing after it. An icon-only
  // control needs aria-label/aria-labelledby/title — an inner <img alt> or
  // <svg><title> also counts as a name source.
  for (const m of src.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const attrs = m[2], inner = m[3];
    if (m[1].toLowerCase() === "a" && !/\bhref\s*=/i.test(attrs)) continue;
    if (/\baria-label(?:ledby)?\s*=\s*["'][^"']+["']/i.test(attrs)) continue;
    if (/\btitle\s*=\s*["'][^"']+["']/i.test(attrs)) continue;
    if (/<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(inner)) continue;
    if (/<svg\b[\s\S]*<title[\s>]/i.test(inner)) continue;
    const text = inner.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
    if (text) continue;
    issues.push({
      rule: "wcag-4.1.2",
      message: `<${m[1].toLowerCase()}> has no accessible name — icon-only controls need aria-label/aria-labelledby/title: ${m[0].slice(0, 70)}`,
    });
  }

  // WCAG 2.5.4 (A) — Motion Actuation: functionality triggered by shaking or
  // tilting the device must have a control-based alternative. The listeners
  // are the literal mechanism; nothing else produces them.
  if (/\bondevice(?:motion|orientation)\s*=|addEventListener\s*\(\s*["']device(?:motion|orientation)["']/i.test(srcRaw)) {
    issues.push({
      rule: "wcag-2.5.4",
      message: "device motion/orientation listener detected — provide a button/control alternative for shake-or-tilt actions",
    });
  }

  // WCAG 1.3.4 (AA) — Orientation: content must not lock to one orientation.
  // screen.orientation.lock() is the literal mechanism (orientation media
  // queries alone are legitimate responsive design, so they are not flagged).
  if (/\borientation\s*\.\s*lock\s*\(|lockOrientation\s*\(/i.test(srcRaw)) {
    issues.push({
      rule: "wcag-1.3.4",
      message: "screen orientation lock detected — content must work in both portrait and landscape unless essential",
    });
  }

  // WCAG 1.4.13 (AA) — Content on Hover or Focus: content revealed by hover/
  // focus must be dismissible without moving the pointer (Escape), hoverable,
  // and persistent. Flagged when a handler unhides content and no Escape
  // handling exists anywhere on the page — warn-class heuristic.
  {
    const reveals = /\bon(?:mouseover|mouseenter|focus)\s*=\s*(["'])[\s\S]*?\1/i.test(srcRaw) &&
      /\b(?:display|visibility|opacity|hidden|classList|style\.)/i.test(srcRaw);
    const escapable = /Escape|keyCode\s*[=!]=+\s*27|key\s*===?\s*["']Escape/i.test(srcRaw);
    if (reveals && !escapable) {
      issues.push({
        rule: "wcag-1.4.13",
        message: "content revealed on hover/focus with no Escape dismissal — hover content must be dismissible without moving the pointer",
      });
    }
  }

  // WCAG 2.5.2 (A) — Pointer Cancellation: actions must fire on the up event,
  // not the down event, so users can slide off to cancel. Flagged only when a
  // down-event handler performs an irreversible action (navigate/submit/click)
  // — passive handlers for visual feedback are not the violation.
  for (const m of src.matchAll(/\bon(?:mouse|pointer|touch)down\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    if (/(?:window\.)?location\s*(?:\.|=\s*)|\.submit\s*\(|\.click\s*\(|window\.open\s*\(/i.test(m[2])) {
      issues.push({
        rule: "wcag-2.5.2",
        message: `down-event handler navigates/submits — actions should fire on the up event so they can be cancelled: ${m[0].slice(0, 80)}`,
      });
      break;
    }
  }

  // WCAG 2.5.1 (A) — Pointer Gestures: functionality using path-based or
  // multipoint gestures needs a single-pointer alternative. Detectable
  // statically: iOS ongesture* handlers are the literal multipoint mechanism,
  // and pointerdown+pointermove on the same element is the literal path-
  // tracking mechanism. Warn-class — whether an alternative exists can't be
  // verified without executing the gesture.
  for (const m of src.matchAll(/<(\w+)\b([^>]*)>/gi)) {
    const attrs = m[2];
    if (/\bongesture(?:start|change|end)\s*=/i.test(attrs)) {
      issues.push({
        rule: "wcag-2.5.1",
        message: `<${m[1].toLowerCase()}> handles multipoint gestures (ongesture*) — provide a single-pointer alternative`,
      });
    } else if (/\bonpointerdown\s*=/i.test(attrs) && /\bonpointermove\s*=/i.test(attrs)) {
      issues.push({
        rule: "wcag-2.5.1",
        message: `<${m[1].toLowerCase()}> tracks a pointer path (pointerdown+pointermove) — provide a single-tap/click alternative`,
      });
    }
  }

  // ------------------------------------------------------------------
  // Static mirrors of rendered-facts checks + structural violations that
  // need no DOM. These give pasted HTML, fetched pages, and crawled pages
  // the same coverage rendered scans get via checkFacts.
  // ------------------------------------------------------------------

  // WCAG 4.1.1 — duplicate id values break aria-labelledby/label-for lookups.
  {
    const ids = [...src.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    const seen = new Set(), dupes = new Set();
    for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
    if (dupes.size) {
      issues.push({
        rule: "wcag-4.1.1",
        message: `duplicate id value(s) — ids must be unique for label/aria references to resolve: ${[...dupes].slice(0, 3).join(", ")}`,
      });
    }
  }

  // WCAG 4.1.2 — id references that resolve to nothing. aria-labelledby,
  // aria-describedby, and label for= must each point at a real element.
  {
    const idSet = new Set([...src.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
    const missing = new Set();
    for (const m of src.matchAll(/\b(?:aria-labelledby|aria-describedby|for)\s*=\s*["']([^"']+)["']/gi)) {
      for (const ref of m[1].trim().split(/\s+/)) {
        if (ref && !idSet.has(ref)) missing.add(ref);
      }
    }
    if (missing.size) {
      issues.push({
        rule: "wcag-4.1.2",
        message: `label/aria reference(s) point at ids that don't exist on this page: ${[...missing].slice(0, 3).join(", ")}`,
      });
    }
  }

  // WCAG 4.1.2 — <iframe> needs a title so AT can announce its purpose.
  for (const m of src.matchAll(/<iframe\b([^>]*)>/gi)) {
    if (!/\btitle\s*=\s*["'][^"']+["']/i.test(m[1]) && !/\baria-label\s*=\s*["'][^"']+["']/i.test(m[1])) {
      issues.push({ rule: "wcag-4.1.2", message: `<iframe> has no title — assistive tech cannot announce its purpose: ${m[0].slice(0, 70)}` });
    }
  }

  // WCAG 4.1.2 — role values that aren't valid ARIA roles expose a broken
  // semantic to AT (typos and invented roles announce nothing useful).
  {
    const ROLES = new Set("alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document feed figure form grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem".split(" "));
    const bad = new Set();
    for (const m of src.matchAll(/\brole\s*=\s*["']([^"']+)["']/gi)) {
      for (const r of m[1].trim().toLowerCase().split(/\s+/)) {
        if (r && !ROLES.has(r) && r !== "presentation") bad.add(r);
      }
    }
    if (bad.size) {
      issues.push({
        rule: "wcag-4.1.2",
        message: `invalid ARIA role value(s) — assistive tech ignores roles it doesn't know: ${[...bad].slice(0, 3).join(", ")}`,
      });
    }
  }

  // WCAG 4.1.2 — interactive elements nested inside each other produce
  // unpredictable activation for keyboards and AT.
  for (const m of src.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (/<(?:a|button|input|select|textarea)\b/i.test(m[2])) {
      issues.push({
        rule: "wcag-4.1.2",
        message: `<${m[1].toLowerCase()}> contains a nested interactive element — controls must not contain other controls: ${m[0].slice(0, 80)}`,
      });
      break;
    }
  }

  // WCAG 4.1.2 / 1.3.1 — an element hidden from AT that is itself focusable
  // (or sets a tabindex) is reachable by keyboard but invisible to screen
  // readers — the two channels desynchronize.
  for (const m of src.matchAll(/<(\w+)\b([^>]*\baria-hidden\s*=\s*["']true["'][^>]*)>/gi)) {
    const tag = m[1].toLowerCase(), attrs = m[2];
    if (/\btabindex\s*=\s*["']?-?\d+|\bhref\s*=/i.test(attrs) || ["a", "button", "input", "select", "textarea"].includes(tag)) {
      issues.push({
        rule: "wcag-4.1.2",
        message: `<${tag}> is aria-hidden but still keyboard-focusable — hidden-from-AT content must not take focus: ${m[0].slice(0, 70)}`,
      });
      break;
    }
  }

  // WCAG 4.1.2 — aria-* attribute names that aren't real ARIA attributes
  // (typos like aria-lable, invented props) are silently ignored by AT.
  {
    const ARIA_ATTRS = new Set([
      "activedescendant", "atomic", "autocomplete", "braillelabel", "brailleroledescription",
      "busy", "checked", "colcount", "colindex", "colindextext", "colspan", "controls",
      "current", "describedby", "description", "details", "disabled", "dropeffect",
      "errormessage", "expanded", "flowto", "grabbed", "haspopup", "hidden", "invalid",
      "keyshortcuts", "label", "labelledby", "level", "live", "modal", "multiline",
      "multiselectable", "orientation", "owns", "placeholder", "posinset", "pressed",
      "readonly", "relevant", "required", "roledescription", "rowcount", "rowindex",
      "rowindextext", "rowspan", "selected", "setsize", "sort", "valuemax", "valuemin",
      "valuenow", "valuetext",
    ]);
    const badAttrs = new Set();
    for (const m of src.matchAll(/\baria-([a-z]+)\s*=/gi)) {
      const a = m[1].toLowerCase();
      if (!ARIA_ATTRS.has(a)) badAttrs.add("aria-" + a);
    }
    if (badAttrs.size) {
      issues.push({
        rule: "wcag-4.1.2",
        message: `invalid ARIA attribute name(s) — assistive tech ignores attributes it doesn't know: ${[...badAttrs].slice(0, 3).join(", ")}`,
      });
    }
  }

  // WCAG 4.1.2 — valid aria-* names with invalid values: booleans/enumerated
  // attributes accept only a fixed vocabulary; anything else is silently
  // ignored by AT (axe's aria-valid-attr-value). Covers the enumerable set —
  // freeform attrs (label/labelledby/describedby/valuetext…) are skipped by
  // design.
  {
    const ENUM = {
      atomic: ["true", "false"], busy: ["true", "false"], checked: ["true", "false", "mixed", "undefined"],
      current: ["true", "false", "page", "step", "location", "date", "time"],
      disabled: ["true", "false"], dropeffect: ["copy", "execute", "link", "move", "none", "popup"],
      expanded: ["true", "false", "undefined"], grabbed: ["true", "false", "undefined"],
      haspopup: ["true", "false", "menu", "listbox", "tree", "grid", "dialog"],
      hidden: ["true", "false", "undefined"], invalid: ["true", "false", "grammar", "spelling"],
      live: ["off", "polite", "assertive"], modal: ["true", "false"],
      multiline: ["true", "false"], multiselectable: ["true", "false"],
      orientation: ["horizontal", "vertical", "undefined"], pressed: ["true", "false", "mixed", "undefined"],
      readonly: ["true", "false"], relevant: ["additions", "removals", "text", "all", "additions text"],
      required: ["true", "false"], selected: ["true", "false", "undefined"],
      sort: ["ascending", "descending", "none", "other"],
    };
    const bad = [];
    for (const m of src.matchAll(/\baria-([a-z]+)\s*=\s*["']([^"']*)["']/gi)) {
      const a = m[1].toLowerCase();
      const allowed = ENUM[a];
      if (!allowed) continue;
      const v = m[2].trim().toLowerCase();
      if (!allowed.includes(v)) bad.push(`aria-${a}="${m[2]}"`);
      if (bad.length >= 3) break;
    }
    if (bad.length) {
      issues.push({
        rule: "wcag-4.1.2",
        message: `ARIA attribute has a value outside its vocabulary — AT ignores it: ${bad.join(", ")}`,
      });
    }
  }

  // WCAG 4.1.2 — roles with missing required ARIA attributes (axe's
  // aria-required-attr). A custom widget claiming these roles without its
  // state attributes is unusable to AT. Covers the common widget roles.
  {
    const REQUIRED = {
      checkbox: ["aria-checked"], radio: ["aria-checked"], switch: ["aria-checked"],
      slider: ["aria-valuenow"], spinbutton: ["aria-valuenow"], scrollbar: ["aria-valuenow"],
      option: ["aria-selected"], combobox: ["aria-expanded"],
      tab: ["aria-selected"], row: ["aria-rowindex"], rowheadercell: ["aria-sort"],
    };
    const seen = new Set();
    for (const m of src.matchAll(/<(\w+)\b([^>]*\brole\s*=\s*["']([^"']*)["'][^>]*)>/gi)) {
      const roles = m[3].toLowerCase().split(/\s+/).filter(Boolean);
      const reqd = roles.map((r) => REQUIRED[r]).find(Boolean);
      if (!reqd || seen.has(roles[0])) continue;
      const missing = reqd.filter((a) => !new RegExp(`\\b${a}\\s*=`, "i").test(m[2]));
      if (missing.length) {
        issues.push({
          rule: "wcag-4.1.2",
          message: `role="${roles[0]}" is missing required ${missing.join("/")} — AT can't expose the widget's state`,
        });
        seen.add(roles[0]);
        if (seen.size >= 3) break;
      }
    }
  }

  // WCAG 4.1.2 — aria-hidden on <body> removes the entire page from the
  // accessibility tree; always a defect (it survives into the DOM this way).
  if (/<body\b[^>]*aria-hidden\s*=\s*["']true["']/i.test(src)) {
    issues.push({
      rule: "wcag-4.1.2",
      message: "<body aria-hidden=true> hides the whole page from assistive technology",
    });
  }

  // WCAG 4.1.2 — aria-label/aria-labelledby on <div>/<span>/<p> without a
  // naming-capable role is dropped by AT (the generic role is name-prohibited
  // and <p> maps to paragraph, also name-prohibited). A role attribute that
  // supports naming (button, navigation, …) legitimates it, so only flag the
  // role-less / generic cases.
  for (const m of src.matchAll(/<(div|span|p)\b([^>]*aria-label(?:ledby)?\s*=\s*["'][^"']+["'][^>]*)>/gi)) {
    if (/\brole\s*=\s*["'](?!generic["']|none["']|presentation["'])[^"']+["']/i.test(m[2])) continue;
    issues.push({
      rule: "wcag-4.1.2",
      message: `<${m[1].toLowerCase()}> has aria-label but no naming-capable role — assistive tech ignores the label: ${m[0].slice(0, 80)}`,
    });
    break;
  }

  // WCAG 1.3.1 — landmark regions of the same type must be distinguishable:
  // two <main>/banner/contentinfo landmarks with no unique accessible name
  // can't be told apart in landmark navigation.
  {
    const landmarkHits = [];
    for (const m of src.matchAll(/<(main|nav)\b([^>]*)>|<(\w+)\b([^>]*\brole\s*=\s*["'](banner|contentinfo|main|navigation|complementary|search|form|region)["'][^>]*)>/gi)) {
      // Only <main>/<nav> tags are unconditional landmarks — header/footer/
      // aside/section are context-dependent (article-nested headers aren't
      // banners), so counting them would false-positive. Explicit role=
      // always is a landmark regardless of nesting.
      const ltype = m[1] ? (m[1].toLowerCase() === "nav" ? "navigation" : "main") : m[5].toLowerCase();
      const named = /\baria-label(?:ledby)?\s*=\s*["'][^"']+["']/i.test(m[2] || m[4] || "");
      landmarkHits.push({ ltype, named });
    }
    const counts = new Map();
    for (const h of landmarkHits) if (!h.named) counts.set(h.ltype, (counts.get(h.ltype) ?? 0) + 1);
    const dups = [...counts.entries()].filter(([t, n]) => n > 1 && ["main", "banner", "contentinfo", "navigation", "complementary", "search"].includes(t)).map(([t]) => t);
    if (dups.length) {
      issues.push({
        rule: "wcag-1.3.1",
        message: `multiple unnamed "${dups.join('", "')}" landmarks — same-type landmarks need aria-label to be told apart`,
      });
    }
  }

  // WCAG 1.3.1 — list/table structure must be real, not visual-only.
  {
    // <li> outside <ul>/<ol>: strip every valid list block; leftovers violate.
    const noLists = src.replace(/<(?:ul|ol)\b[^>]*>[\s\S]*?<\/(?:ul|ol)>/gi, "");
    if (/<li\b/i.test(noLists)) {
      issues.push({ rule: "wcag-1.3.1", message: "<li> found outside a <ul>/<ol> — list items need a real list parent" });
    }
    const noDls = src.replace(/<dl\b[^>]*>[\s\S]*?<\/dl>/gi, "");
    if (/<d[dt]\b/i.test(noDls)) {
      issues.push({ rule: "wcag-1.3.1", message: "<dt>/<dd> found outside a <dl> — definition terms need a definition-list parent" });
    }
    // <fieldset> without a <legend> has no group label (technique H71).
    for (const m of src.matchAll(/<fieldset\b[^>]*>([\s\S]*?)<\/fieldset>/gi)) {
      if (!/<legend\b[^>]*>[\s\S]*?<\/legend>/i.test(m[1])) {
        issues.push({ rule: "wcag-1.3.1", message: "<fieldset> has no <legend> — grouped controls need a group label" });
        break;
      }
    }
    // <optgroup> without label announces options with no group name.
    for (const m of src.matchAll(/<optgroup\b([^>]*)>/gi)) {
      if (!/\blabel\s*=\s*["'][^"']+["']/i.test(m[1])) {
        issues.push({ rule: "wcag-1.3.1", message: `<optgroup> has no label — option groups need a name: ${m[0].slice(0, 70)}` });
      }
    }
    // A <table> with no <th> can't be a properly-marked data table; if it's
    // for layout it should be marked role=presentation instead.
    for (const m of src.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
      if (/\brole\s*=\s*["'](?:presentation|none)["']/i.test(m[1])) continue;
      if (!/<th\b/i.test(m[2])) {
        issues.push({
          rule: "wcag-1.3.1",
          message: "<table> has no header cells (<th>) — data tables need headers; layout tables need role=\"presentation\"",
        });
        break;
      }
    }
    // Deprecated presentational markup — styling belongs in CSS, not markup.
    if (/<(?:font|center|big|tt|strike|acronym|applet)\b|\b(?:align|bgcolor|cellpadding|cellspacing|valign|hspace)\s*=/i.test(src)) {
      issues.push({
        rule: "wcag-1.3.1",
        message: "deprecated presentational markup (<font>/<center>/align=/bgcolor=…) — use CSS for presentation",
      });
    }
  }

  // WCAG 1.1.1 — non-text content needs a text alternative.
  {
    for (const m of src.matchAll(/<input\b[^>]*\btype\s*=\s*["']image["'][^>]*>/gi)) {
      if (!/\balt\s*=\s*["'][^"']+["']/i.test(m[0])) {
        issues.push({ rule: "wcag-1.1.1", message: `<input type="image"> has no alt — image buttons need a text alternative: ${m[0].slice(0, 70)}` });
      }
    }
    for (const m of src.matchAll(/<area\b([^>]*)>/gi)) {
      if (!/\balt\s*=\s*["'][^"']+["']/i.test(m[1])) {
        issues.push({ rule: "wcag-1.1.1", message: `<area> in an image map has no alt — map regions need text alternatives: ${m[0].slice(0, 70)}` });
      }
    }
    for (const m of src.matchAll(/<(object|embed|canvas)\b([^>]*)>([\s\S]*?)<\/\1>|<(object|embed)\b([^>]*)\/?>/gi)) {
      const tag = (m[1] ?? m[4]).toLowerCase(), attrs = m[2] ?? m[5] ?? "", inner = m[3] ?? "";
      if (/\b(?:title|aria-label|alt)\s*=\s*["'][^"']+["']/i.test(attrs)) continue;
      if (tag !== "embed" && inner.replace(/<[^>]+>/g, "").trim()) continue; // fallback text present
      if (tag === "embed") {
        issues.push({ rule: "wcag-1.1.1", message: `<embed> has no title/fallback — non-text content needs an alternative: ${m[0].slice(0, 70)}` });
      } else {
        issues.push({ rule: "wcag-1.1.1", message: `<${tag}> has no title or fallback content — non-text content needs an alternative: ${m[0].slice(0, 70)}` });
      }
      break;
    }
    // <svg role="img"> declares itself meaningful — then it needs a name.
    for (const m of src.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi)) {
      if (!/\brole\s*=\s*["']img["']/i.test(m[1])) continue;
      if (/<title[\s>]/i.test(m[2]) || /\baria-label(?:ledby)?\s*=\s*["'][^"']+["']/i.test(m[1])) continue;
      issues.push({ rule: "wcag-1.1.1", message: '<svg role="img"> has no <title>/aria-label — a meaningful image needs an accessible name' });
      break;
    }
  }

  // WCAG 1.2.1 / 1.2.5 — prerecorded media needs captions and, for video,
  // audio description. Burned-in captions/description satisfy these, so the
  // messages say "verify" rather than "missing".
  for (const m of src.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
    if (/<track\b[^>]*\bkind\s*=\s*["'](?:captions|subtitles)["']/i.test(m[2])) continue;
    if (/\bmuted\b/i.test(m[1])) {
      issues.push({
        rule: "wcag-1.2.1",
        message: "muted <video> has no <track kind=captions> — video-only content still needs an alternative (transcript or audio description)",
      });
    } else {
      issues.push({
        rule: "wcag-1.2.2",
        message: "<video> has no <track kind=captions> — verify captions aren't burned in; prerecorded video with audio needs synchronized captions",
      });
    }
    break;
  }
  for (const m of src.matchAll(/<audio\b([^>]*)>([\s\S]*?)<\/audio>/gi)) {
    if (/<track\b[^>]*\bkind\s*=\s*["'](?:captions|subtitles)["']/i.test(m[2])) continue;
    if (/(?:transcript|aria-label)\s*=/i.test(m[1])) continue;
    issues.push({
      rule: "wcag-1.2.1",
      message: "<audio> has no <track> or transcript link — prerecorded audio needs a text alternative",
    });
    break;
  }

  // WCAG 1.2.5 (AA) — prerecorded video needs audio description (or a media
  // alternative). Burned-in description satisfies it, so warn-class "verify".
  // Skip silent/visual-only video (<video muted> can't carry meaningful audio).
  for (const m of src.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
    if (/\bmuted\b/i.test(m[1])) continue;
    if (/<track\b[^>]*\bkind\s*=\s*["']descriptions["']/i.test(m[2])) continue;
    issues.push({
      rule: "wcag-1.2.5",
      message: "<video> has no <track kind=descriptions> — verify the audio track is self-describing or provide audio description (AA)",
    });
    break;
  }

  // WCAG 2.4.9 (AAA) — links whose purpose can't be determined from link text
  // alone. Detectable statically: the same visible text pointing at different
  // hrefs is ambiguous out of context ("Read more" → /a and → /b). Inverse of
  // 3.2.4 (same target, different labels). Warn-class.
  {
    const byText = new Map();
    for (const m of src.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      if (!text || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;
      if (!byText.has(text)) byText.set(text, new Set());
      byText.get(text).add(href.split(/[?#]/)[0]);
    }
    for (const [text, hrefs] of byText) {
      if (hrefs.size < 2) continue;
      issues.push({
        rule: "wcag-2.4.9",
        message: `link text "${text.slice(0, 40)}" points at ${hrefs.size} different targets — purpose is ambiguous out of context (AAA)`,
      });
    }
  }

  // WCAG 3.2.1 — autofocus moves focus on load without a user request,
  // disorienting screen-reader and keyboard users (same criterion as the
  // rendered-facts check; this covers static scans). The \s anchor requires
  // attribute position inside a tag — prose mentions ("the autofocus
  // attribute"), data-autofocus, and class="autofocus" don't count.
  if (/<[a-zA-Z][^>]*\sautofocus\b/i.test(src)) {
    issues.push({ rule: "wcag-3.2.1", message: "autofocus moves focus without user request — let users choose where to start" });
  }

  // WCAG 2.1.1 — keyboard access. Three zero/low-FP mechanisms:
  {
    // role="button/link/checkbox/switch/tab" on a non-interactive tag with no
    // tabindex — it looks like a control but can't receive keyboard focus.
    for (const m of src.matchAll(/<(\w+)\b([^>]*\brole\s*=\s*["'](?:button|link|checkbox|switch|tab|menuitem|option|radio)["'][^>]*)>/gi)) {
      const tag = m[1].toLowerCase();
      if (["a", "button", "input", "select", "textarea", "summary"].includes(tag)) continue;
      if (!/\btabindex\s*=/i.test(m[2])) {
        issues.push({
          rule: "wcag-2.1.1",
          message: `<${tag} role="…"> has no tabindex — keyboard users can't reach this control: ${m[0].slice(0, 70)}`,
        });
        break;
      }
    }
    // onclick on a non-interactive element with neither role nor tabindex —
    // a mouse-only control.
    for (const m of src.matchAll(/<(div|span|p|li|td|tr|img|section|article|header|footer|label)\b([^>]*\bonclick\s*=[^>]*)>/gi)) {
      if (!/\brole\s*=|\btabindex\s*=/i.test(m[2])) {
        issues.push({
          rule: "wcag-2.1.1",
          message: `<${m[1].toLowerCase()}> has onclick but no role/tabindex — a mouse-only control keyboard users can't operate: ${m[0].slice(0, 70)}`,
        });
        break;
      }
    }
    // tabindex="-1" on a natively interactive element removes it from the
    // tab order entirely.
    for (const m of src.matchAll(/<(a|button|input|select|textarea)\b([^>]*\btabindex\s*=\s*["']?-1[^>]*)>/gi)) {
      if (m[1].toLowerCase() === "a" && !/\bhref\b/i.test(m[2])) continue; // <a> without href isn't focusable anyway
      if (m[1].toLowerCase() === "input" && /\btype\s*=\s*["']hidden["']/i.test(m[2])) continue;
      issues.push({
        rule: "wcag-2.1.1",
        message: `<${m[1].toLowerCase()}> has tabindex="-1" — the control is removed from the keyboard tab order: ${m[0].slice(0, 70)}`,
      });
      break;
    }
    // Scrollable regions need tabindex="0" or keyboard users can't scroll
    // them — the common <pre>/code-block failure (WCAG technique F73-ish).
    const scrollWarn = (snippet) => {
      issues.push({
        rule: "wcag-2.1.1",
        message: `scrollable region (overflow:auto/scroll) has no tabindex — keyboard users can't scroll it: ${snippet.slice(0, 60)}`,
      });
      // WCAG 2.1.3 (AAA — keyboard, no exception): the same mechanism is also
      // the AAA criterion, so AAA-level consumers see the violation tagged.
      issues.push({
        rule: "wcag-2.1.3",
        message: `scrollable region isn't keyboard-reachable — fails Level AAA keyboard access outright: ${snippet.slice(0, 60)}`,
      });
    };
    let scrollFlag = false;
    for (const m of src.matchAll(/<(\w+)\b([^>]*\bstyle\s*=\s*["'][^"']*overflow(?:-[xy])?\s*:\s*(?:auto|scroll)[^"']*["'][^>]*)>/gi)) {
      if (["html", "body"].includes(m[1].toLowerCase())) continue;
      if (!/\btabindex\s*=/i.test(m[2])) { scrollWarn(m[0]); scrollFlag = true; break; }
    }
    if (!scrollFlag && css) {
      const scrollClasses = new Set();
      for (const m of css.matchAll(/\.([\w-]+)[^{}]*\{[^}]*overflow(?:-[xy])?\s*:\s*(?:auto|scroll)/gi)) scrollClasses.add(m[1]);
      for (const cls of scrollClasses) {
        const elRe = new RegExp(`<(\\w+)\\b([^>]*\\bclass\\s*=\\s*["'][^"']*\\b${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^"']*["'][^>]*)>`, "i");
        const el = src.match(elRe);
        if (el && !/\btabindex\s*=/i.test(el[2])) { scrollWarn(el[0]); break; }
      }
    }
  }

  // WCAG 2.4.4 — link mechanics that break purpose/keyboard expectations.
  {
    for (const m of src.matchAll(/<a\b[^>]*\bhref\s*=\s*["']javascript:/gi)) {
      issues.push({
        rule: "wcag-2.4.4",
        message: `href="javascript:" pseudo-protocol — use a real URL or a <button>: ${m[0].slice(0, 70)}`,
      });
      break;
    }
    // <a> with no href, no role, no tabindex — a dead/click-only anchor that
    // isn't focusable and announces as plain text.
    for (const m of src.matchAll(/<a\b([^>]*)>/gi)) {
      if (/\bhref\s*=/i.test(m[1])) continue;
      if (/\b(?:role|tabindex|id|name)\s*=/i.test(m[1])) continue; // name anchors / js-focus targets
      issues.push({
        rule: "wcag-2.4.4",
        message: `<a> with no href/role/tabindex is not a keyboard-reachable link: ${m[0].slice(0, 70)}`,
      });
      break;
    }
    // <a href="#frag"> where the fragment id doesn't exist — the jump goes
    // nowhere (target may load dynamically, so this stays advisory).
    const idSet2 = new Set([...src.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
    for (const m of src.matchAll(/<a\b[^>]*\bhref\s*=\s*["']#([\w-]+)["']/gi)) {
      if (!idSet2.has(m[1])) {
        issues.push({
          rule: "wcag-2.4.4",
          message: `link targets "#${m[1]}" but no element has that id — verify the target exists`,
        });
        break;
      }
    }
  }

  // WCAG 2.3.1 — flashing content. <blink> and text-decoration:blink are
  // unambiguous violations; CSS keyframe names only flag blink/flash verbs.
  if (/<blink\b/i.test(src) || /text-decoration\s*:\s*[^;}]*blink/i.test(css) || /<[a-z][^>]*\bstyle\s*=\s*["'][^"']*text-decoration\s*:\s*[^;"']*blink/i.test(src)) {
    issues.push({ rule: "wcag-2.3.1", message: "blinking text (<blink>/text-decoration:blink) — flashing content can trigger seizures" });
    // WCAG 2.3.2 (AAA) — Three Flashes: at Level AAA nothing may flash at
    // all, even below the A/AA 3-per-second threshold — same detection
    // emits the stricter-tier finding.
    issues.push({ rule: "wcag-2.3.2", message: "flashing content is banned outright at Level AAA — no flashing element is permitted (2.3.2)" });
  }

  // WCAG 1.3.3 — instructions that rely on color/shape/position alone.
  // Advisory: only a human can confirm whether a second cue exists.
  {
    const text = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ");
    const sensory =
      /\b(?:click|press|select|choose|use|see|tap)\s+the\s+(?:green|red|blue|yellow|orange|purple|left|right|top|bottom|upper|lower|above|below|round|square|circular|big|small|large)\b/i.test(text) ||
      /\bon the\s+(?:left|right|top|bottom)\b/i.test(text);
    if (sensory) {
      issues.push({
        rule: "wcag-1.3.3",
        message: "instructions appear to rely on color/shape/position alone — verify a second cue exists (advisory)",
      });
    }
  }

  // WCAG 3.3.2 — a <label> with text but no for= and no wrapped control
  // labels nothing — the intended association silently doesn't happen.
  for (const m of src.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    if (/\bfor\s*=/i.test(m[1])) continue;
    if (/<(?:input|select|textarea|meter|progress|button)\b/i.test(m[2])) continue;
    if (!m[2].replace(/<[^>]+>/g, "").trim()) continue; // already flagged as empty
    issues.push({
      rule: "wcag-3.3.2",
      message: `<label> has no for= and wraps no control — it labels nothing: ${m[0].slice(0, 70)}`,
    });
    break;
  }

  // WCAG 2.4.10 (AAA) — long text with no section headings is hard to
  // navigate for everyone. Advisory: fires only on genuinely long documents.
  {
    const words = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").trim().split(/\s+/).length;
    const hasSectionHeadings = /<h[2-6]\b/i.test(src);
    if (words > 800 && !hasSectionHeadings) {
      issues.push({
        rule: "wcag-2.4.10",
        message: "long content has no section headings — headings aid navigation and comprehension (AAA advisory)",
      });
    }
  }

  // WCAG 3.1.4 (AAA) — Abbreviations: an <abbr> with no expansion mechanism
  // (title, aria-label, or aria-labelledby) leaves screen-reader users with
  // only the acronym's letters. <abbr title> IS the canonical mechanism.
  for (const m of src.matchAll(/<abbr\b([^>]*)>/gi)) {
    if (!/\b(?:title|aria-label|aria-labelledby)\s*=/i.test(m[1])) {
      issues.push({
        rule: "wcag-3.1.4",
        message: `<abbr> without title or aria-label — no expanded form available: ${m[0].slice(0, 70)}`,
      });
    }
  }

  // WCAG 2.3.3 (AAA) — Animation from Interactions: motion tied to user
  // interaction (transition/animation on :hover/:focus/:active) should be
  // disableable. Heuristic: inline <style> blocks animate interactions but
  // the document never references prefers-reduced-motion. Warn-class.
  {
    const styleBlocks = [...src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
    const animatesInteraction = styleBlocks.some((css) =>
      /:(?:hover|focus|active)\b[^{]*\{[^}]*(?:transition|animation)\s*:/i.test(css));
    if (animatesInteraction && !/prefers-reduced-motion/i.test(src)) {
      issues.push({
        rule: "wcag-2.3.3",
        message: "interactive animation (transition/animation on :hover/:focus) with no prefers-reduced-motion support — motion can't be disabled (AAA advisory)",
      });
    }
  }

  // WCAG 3.3.1 (A) — Error Identification: a control already marked invalid
  // (aria-invalid or error styling) must have the error identified and
  // described in reachable text. With no aria-errormessage/aria-describedby
  // reference the announcement is just "invalid" — nothing explains what
  // went wrong. Warn-class: an adjacent live region could carry the
  // description this string scan can't correlate.
  for (const m of src.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attrs = m[2];
    const markedInvalid =
      /\baria-invalid\s*=\s*["']?(?:true|grammar|spelling)/i.test(attrs) ||
      /\bclass\s*=\s*["'][^"']*\b(?:is-invalid|invalid|field-?error|has-?error)\b/i.test(attrs);
    if (!markedInvalid) continue;
    const ref = attrs.match(/\baria-(?:errormessage|describedby)\s*=\s*["']([^"'\s]+)["']/i)?.[1];
    if (!ref) {
      issues.push({
        rule: "wcag-3.3.1",
        message: `control is marked invalid but references no error text — the error must be identified and described (aria-errormessage/aria-describedby): ${m[0].slice(0, 70)}`,
      });
      break;
    }
    // WCAG 3.3.3 (AA) — Error Suggestion: when the correction is knowable
    // the error text must say how to fix it, not just name the failure. The
    // referenced element's text resolves statically — a bare "error" or
    // "invalid" carries no suggestion.
    const esc = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tgt = new RegExp(`<\\w+\\b[^>]*\\bid\\s*=\\s*["']${esc}["'][^>]*>([\\s\\S]*?)<\\/\\w+>`, "i").exec(src);
    const errText = tgt?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    if (!errText || /^(error|invalid|wrong|incorrect|failed|required)\b[\s.!]*$/i.test(errText)) {
      issues.push({
        rule: "wcag-3.3.3",
        message: `error text "${(errText || "(empty)").slice(0, 40)}" names the failure but suggests no correction — state the expected format or a valid example`,
      });
      break;
    }
  }

  // WCAG 3.3.4 (AA) / 3.3.6 (AAA) — Error Prevention: submissions with
  // legal/financial/data consequences (3.3.4) — and at AAA every submission
  // (3.3.6) — must be reversible, checked, or confirmed before finalizing.
  // Counted affordances: a confirm() in the submit/click handler, a named
  // agree/consent/confirm control, or a review step. Warn-class: server-side
  // multi-step review can't be seen, but the absence of any client-side
  // signal is the flag worth reporting.
  {
    const FILLABLE = /<(?:input|select|textarea)\b[^>]*>/gi;
    const SKIPPED = /type\s*=\s*["'](?:hidden|submit|button|checkbox|radio|file|image|reset)["']/i;
    for (const m of src.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      const formAttrs = m[1], inner = m[2];
      const submits = inner.match(/<button\b[\s\S]*?<\/button>|<input\b[^>]*type\s*=\s*["']submit["'][^>]*>/gi) ?? [];
      if (!submits.length) continue; // no submit affordance — not a submission
      const affordance = submits.join(" ") + " " + formAttrs;
      const transactional = /\b(pay(?:ment)?|checkout|purchas|buy|\border\b|transfer|donat|book(?:ing)?|reserv|invoice|delet|terminat|contract|subscri)\b/i.test(affordance);
      const hasReview =
        /\bon(?:submit|click)\s*=\s*["'][^"']*\bconfirm\s*\(/i.test(m[0]) ||
        /\b(?:name|id|value)\s*=\s*["'][^"']*(?:confirm|agree|consent|accept|terms|acknowledge|review)/i.test(inner) ||
        /<button\b[^>]*>[\s\S]{0,120}?\b(?:review|confirm)\b/i.test(inner);
      if (hasReview) continue;
      if (transactional) {
        issues.push({
          rule: "wcag-3.3.4",
          message: "form appears transactional (payment/order/deletion/legal) with no review-or-confirm step — legal, financial, and data submissions must be checked, reversible, or confirmed",
        });
        break;
      }
      const fillable = [...inner.matchAll(FILLABLE)].filter((t) => !SKIPPED.test(t[0])).length;
      if (fillable >= 2) {
        issues.push({
          rule: "wcag-3.3.6",
          message: "form has no check/reverse/confirm mechanism — at Level AAA every submission must let users review or undo their input (advisory)",
        });
        break;
      }
    }
  }

  // WCAG 3.3.5 (AAA) — Help: context-sensitive help must be available where
  // forms ask for input. Counted mechanisms: aria-describedby/title hints on
  // fields, help/hint-class text, or a help/support/FAQ link inside the
  // form. Fires once on the first substantial form with none — advisory.
  for (const m of src.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)) {
    const inner = m[1];
    const fields = [...inner.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)]
      .filter((t) => !/type\s*=\s*["'](?:hidden|submit|button|checkbox|radio|file|image|reset)["']/i.test(t[0]));
    if (fields.length < 3) continue;
    const hasHelp =
      /\baria-describedby\s*=|\btitle\s*=\s*["'][^"']+["']/i.test(inner) ||
      /class\s*=\s*["'][^"']*\b(?:help|hint|tip|form-text|field-hint|instruction)/i.test(inner) ||
      /<a\b[^>]*href\s*=\s*["'][^"']*(?:help|faq|support)/i.test(inner);
    if (!hasHelp) {
      issues.push({
        rule: "wcag-3.3.5",
        message: `form with ${fields.length} fields offers no context-sensitive help (hints, describedby text, or a help link) — AAA advisory`,
      });
      break;
    }
  }

  // WCAG 3.3.9 (AAA) — Accessible Authentication (Enhanced): where 3.3.8
  // (AA) tolerates object-recognition and personal-content tests, AAA allows
  // no cognitive function test at all — only non-cognitive paths (passkey,
  // OAuth, magic link, copy-paste). CAPTCHA/challenge markup is the signal.
  // Vendor tokens are distinctive enough to match anywhere (incl. script
  // bodies — JS-injected widgets count). The generic words "captcha" and
  // "turnstile" appear in ordinary prose and hrefs, so they need attribute
  // context: class/id/src/action values or data-* names.
  if (/g-recaptcha|h-captcha|hcaptcha|grecaptcha|cf-turnstile|arkose|funcaptcha|geetest|challenges\.cloudflare\.com|turnstile\.render/i.test(srcRaw) ||
      /<[a-zA-Z][^>]*\b(?:class|id|src|action|data-[a-z-]+)\s*=\s*["'][^"']*\b(?:captcha|turnstile)\b|<[a-zA-Z][^>]*\bdata-[a-z-]*(?:captcha|turnstile)\b/i.test(srcRaw)) {
    issues.push({
      rule: "wcag-3.3.9",
      message: "CAPTCHA/cognitive-challenge markup found — at Level AAA authentication needs a fully non-cognitive path (passkey, magic link, OAuth)",
    });
  }

  // WCAG 1.4.7 (AAA) — Low or No Background Audio: speech must have no
  // background audio, a ≥20dB-quieter background, or a user switch to turn
  // it off. Any unmuted <audio> is advisory-flagged — a string scan can't
  // measure the mix.
  for (const m of src.matchAll(/<audio\b([^>]*)>/gi)) {
    if (/\bmuted\b/i.test(m[1])) continue;
    issues.push({
      rule: "wcag-1.4.7",
      message: `unmuted <audio> — verify no background audio plays under speech, or that it's 20dB lower / user-switchable (AAA advisory): ${m[0].slice(0, 60)}`,
    });
    break;
  }

  // WCAG 2.2.4 (AAA) — Interruptions (markup leg): alert()/confirm()/
  // prompt() are modal interruptions the user can neither postpone nor
  // suppress — banned at AAA outside emergencies. (Meta-refresh emits above.)
  for (const m of src.matchAll(/\bon\w+\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    const fn = m[2].match(/\b(alert|confirm|prompt)\s*\(/)?.[1];
    if (fn) {
      issues.push({
        rule: "wcag-2.2.4",
        message: `${fn}() is a modal interruption the user can't postpone or suppress — banned at Level AAA`,
      });
      break;
    }
  }

  // WCAG 3.1.5 (AAA) — Reading Level: text more advanced than lower-
  // secondary education needs a simplified alternative or supplemental
  // aids. Flesch–Kincaid grade > ~9 estimates "beyond lower secondary" on
  // substantial prose — advisory.
  {
    const text = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
    const words = text.split(" ").filter((w) => /[a-zA-Z]{2,}/.test(w));
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().split(/\s+/).length >= 3);
    if (words.length >= 150 && sentences.length >= 3) {
      const countSyl = (w) => {
        w = w.toLowerCase().replace(/[^a-z]/g, "");
        if (w.length <= 3) return 1;
        w = w.replace(/(?:[^laeiouy]e|ed|es)$/, "").replace(/^y/, "");
        return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
      };
      const syl = words.reduce((t, w) => t + countSyl(w), 0);
      const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
      if (grade > 9) {
        issues.push({
          rule: "wcag-3.1.5",
          message: `estimated reading level ≈ grade ${grade.toFixed(1)} — beyond lower-secondary; provide a simplified version or supplemental aids (AAA advisory, Flesch–Kincaid estimate)`,
        });
      }
    }
  }

  return issues;
}

// WCAG 1.4.6 Contrast (Enhanced) — 7:1 normal text, 4.5:1 large text.
// Companion to checkContrast's AA thresholds (1.4.3); reports stricter
// shortfalls as enhanced-tier findings on the same styles input.
export function checkContrastAAA(styles) {
  const issues = [];
  for (const el of styles ?? []) {
    const fg = parseColor(el.color);
    const bg = parseColor(el.bg);
    if (!fg || !bg || fg.a === 0 || bg.a === 0) continue;
    const l1 = luminance(fg), l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = el.size >= 24 || (el.size >= 18.66 && parseInt(el.weight, 10) >= 700);
    const aaaMin = large ? 4.5 : 7;
    const aaMin = large ? 3 : 4.5;
    if (ratio < aaaMin && ratio >= aaMin) {
      issues.push({
        rule: "wcag-1.4.6",
        message: `contrast ${ratio.toFixed(2)}:1 passes AA but below enhanced ${aaaMin}:1 on <${el.tag}> "${String(el.text).slice(0, 40)}"`,
      });
    }
  }
  return issues;
}

// WCAG 1.4.1 (A) — Use of Color: links inside body text must be
// distinguishable by more than color alone. A link is fine if it is
// underlined (default UA styling counts) or otherwise visually marked;
// a non-underlined link needs ≥3:1 contrast against the surrounding
// text color (WCAG technique G183 / failure F73). Requires the render
// pass's per-element styles incl. textDecorationLine (`td`).
export function checkUseOfColor(styles) {
  const issues = [];
  const list = Array.isArray(styles) ? styles : [];
  // Dominant non-link text color = the "surrounding text" the link must
  // contrast with.
  const counts = new Map();
  for (const el of list) {
    if (el.tag === "a") continue;
    const c = parseColor(el.color);
    if (!c || c.a === 0) continue;
    const key = `${c.r},${c.g},${c.b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const bodyKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!bodyKey) return issues;
  const [br, bg2, bb] = bodyKey.split(",").map(Number);
  const bodyLum = luminance({ r: br, g: bg2, b: bb });
  for (const el of list) {
    if (el.tag !== "a") continue;
    // Only prose-context links are in scope — nav/menu links are
    // identifiable by structure, not color (F73's actual failure mode).
    // Styles data without the flag (older renders) is skipped outright:
    // under-reporting beats flagging every nav menu on the internet.
    if (el.inProse !== true) continue;
    const td = String(el.td ?? "");
    if (td.includes("underline") || td.includes("line-through")) continue;
    const c = parseColor(el.color);
    if (!c || c.a === 0) continue;
    const ratio = (Math.max(luminance(c), bodyLum) + 0.05) / (Math.min(luminance(c), bodyLum) + 0.05);
    if (ratio < 3) {
      issues.push({
        rule: "wcag-1.4.1",
        message: `link "${String(el.text).slice(0, 40)}" is not underlined and its color is only ${ratio.toFixed(2)}:1 vs surrounding text — color alone must not carry meaning`,
      });
    }
  }
  return issues;
}

// --- keyboard trap statics (WCAG 2.1.2) + focus order (2.4.3) -------------
// checkFocus catches traps dynamically on rendered scans via the focus trace;
// these catch the same mechanisms statically so pasted HTML and crawled pages
// get coverage too. Deliberately narrow: only patterns that cannot false-
// positive on ordinary markup.
export function scanKeyboardStatics(html) {
  const issues = [];
  if (typeof html !== "string" || !html) return issues;
  // Same <script>-body stripping as scanAdditionalHtml — element and
  // attribute patterns shouldn't match markup-shaped JS strings.
  html = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, "<script$1></script>");

  // Inline key handlers that preventDefault() a Tab key event — the literal
  // mechanism of a keyboard trap.
  for (const h of html.matchAll(/\bonkey(?:down|press|up)\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    const body = h[2];
    const swallowsTab =
      /preventDefault\s*\(/.test(body) &&
      /keyCode\s*[=!]=+\s*9\b|\.which\s*[=!]=+\s*9\b|key\s*===?\s*['"]Tab['"]|code\s*===?\s*['"]Tab['"]/i.test(body);
    if (swallowsTab) {
      issues.push({
        rule: "wcag-2.1.2",
        message: "key handler calls preventDefault() on Tab — keyboard focus can become trapped",
      });
      break;
    }
  }

  // A modal <dialog open> with no keyboard-reachable way to leave it. Scoped
  // to <dialog> only: its </dialog> close tag is unambiguous (role="dialog"
  // regions can't be reliably bounded without a full parser).
  for (const m of html.matchAll(/<dialog\b([^>]*)>([\s\S]*?)<\/dialog>/gi)) {
    if (!/\bopen\b/i.test(m[1])) continue;
    const region = m[2];
    const focusable = /<(?:button|a\b[^>]*\bhref|input|select|textarea)\b|\btabindex\s*=/i.test(region);
    const escapeHatch =
      /\boncancel\s*=/i.test(m[1]) ||
      /\bonkey\w+\s*=\s*(["'])[\s\S]*?\1/i.test(m[0]) && /Escape|keyCode\s*[=!]=+\s*27|key\s*===?\s*['"]Escape/i.test(region + m[0]);
    if (!focusable && !escapeHatch) {
      issues.push({
        rule: "wcag-2.1.2",
        message: "open <dialog> has no keyboard-reachable dismiss control — focus can enter but not leave",
      });
      break;
    }
  }

  // Positive tabindex is WCAG failure technique F44 — it overrides the
  // natural focus order and desyncs it from the visual order.
  const posTab = html.match(/\btabindex\s*=\s*["']?([1-9]\d*)/i);
  if (posTab) {
    issues.push({
      rule: "wcag-2.4.3",
      message: `tabindex="${posTab[1]}" overrides natural focus order — use document order instead`,
    });
  }

  return issues;
}
