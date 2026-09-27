# WCAG Coverage Reference

74 WCAG success criteria + 1 best-practice check implemented across three
detection layers. This document
is the authoritative map: each rule, its WCAG level/version, the detection
layer that evaluates it, and what it flags. Live source: `GET /rules`.

Layers: **static** = string-scan of fetched HTML (every scan), **rendered** =
Browser Rendering trace (contrast census, focus cycle, target measurements),
**crosspage** = multi-page consistency (site scans only).

## Static layer (54 criteria)

| Criterion | Level | WCAG | What it flags |
|---|---|---|---|
| wcag-1.1.1 — Non-text Content | A | 2.0 | img/area/image-input/embed/svg/canvas/object missing alt, title, or fallback text |
| wcag-1.2.1 — Audio-only and Video-only (Prerecorded) | A | 2.0 | <audio>/<video muted> without captions or a text alternative |
| wcag-1.2.2 — Captions (Prerecorded) | A | 2.0 | <video> (unmuted) without <track kind=captions> |
| wcag-1.2.5 — Audio Description (Prerecorded) | AA | 2.0 | <video> without <track kind=descriptions> and not muted (warn-class — burned-in description satisfies it) |
| wcag-1.3.1 — Info and Relationships | A | 2.0 | heading skips/no <h1>/no headings, missing <main> landmark, stray <li>/<dt>/<dd>, <fieldset> w/o <legend>, <optgroup> w/o label, tables w/o <th>, duplicate landmarks |
| wcag-1.3.2 — Meaningful Sequence | A | 2.0 | order-breaking CSS (flex/grid `order`, reversed flex-direction, bidi-override) and aria-flowto overrides — warn-class |
| wcag-1.3.3 — Sensory Characteristics | A | 2.0 | instructions relying on position/shape/sound alone (e.g. 'menu at left', 'the green button') |
| wcag-1.3.4 — Orientation | AA | 2.1 | CSS locking orientation (orientation: media query w/o fallback) |
| wcag-1.3.5 — Identify Input Purpose | AA | 2.1 | personal-data fields (email/name/tel/etc.) missing autocomplete |
| wcag-1.4.2 — Audio Control | A | 2.0 | autoplaying <audio>/<video> (unmuted) without pause/stop controls |
| wcag-1.4.4 — Resize Text | AA | 2.0 | viewport user-scalable=no or maximum-scale < 2 |
| wcag-1.4.5 — Images of Text | AA | 2.0 | images whose alt text suggests they carry significant text (heuristic) |
| wcag-1.4.7 — Low or No Background Audio | AAA | 2.0 | unmuted <audio> — verify background audio is absent, 20dB quieter, or user-switchable (warn-class) |
| wcag-1.4.8 — Visual Presentation | AAA | 2.0 | text-align: justify without hyphenation support |
| wcag-1.4.9 — Images of Text (No Exception) | AAA | 2.0 | non-logo images carrying text — AAA permits no images of text outside decoration/logotype |
| wcag-1.4.10 — Reflow | AA | 2.1 | fixed pixel widths on content containers that prevent reflow at 320px |
| wcag-1.4.13 — Content on Hover or Focus | AAA | 2.1 | title-attr/popup content with no dismiss mechanism (warn-class heuristic) |
| wcag-2.1.3 — Keyboard (No Exception) | AAA | 2.0 | scrollable region not keyboard-reachable — the same failure is an outright AAA violation |
| wcag-2.1.4 — Character Key Shortcuts | A | 2.1 | accesskey attributes / single-character key handlers with no remapping or off switch |
| wcag-2.2.1 — Timing Adjustable | A | 2.0 | <meta http-equiv=refresh> timed reload/redirect |
| wcag-2.2.4 — Interruptions | AAA | 2.0 | any <meta http-equiv=refresh> or modal alert/confirm/prompt — AAA bans postponable interruptions outright |
| wcag-2.2.2 — Pause, Stop, Hide | A | 2.0 | <marquee> and auto-moving content with no pause control |
| wcag-2.3.1 — Three Flashes | A | 2.0 | <blink> / text-decoration:blink flashing content |
| wcag-2.3.2 — Three Flashes (AAA) | AAA | 2.0 | flashing markup — at AAA nothing may flash at all, even under the A/AA threshold |
| wcag-2.3.3 — Animation from Interactions | AAA | 2.1 | transition/animation on :hover/:focus/:active with no prefers-reduced-motion support (warn-class, inline <style> only) |
| wcag-2.4.2 — Page Titled | A | 2.0 | missing or empty <title> |
| wcag-2.4.4 — Link Purpose (In Context) | A | 2.0 | vague link text ('click here'), javascript:/dead '#'-only links, dangling fragment targets |
| wcag-2.4.9 — Link Purpose (Link Only) | AAA | 2.0 | same link text pointing at different hrefs — purpose ambiguous out of context (warn-class) |
| wcag-2.4.5 — Multiple Ways | AA | 2.0 | sites offering only one way to find pages (no search/sitemap/consistent nav) |
| wcag-2.4.6 — Headings and Labels | AA | 2.0 | empty headings, empty <label> wrapping no control |
| wcag-2.4.7 — Focus Visible | AA | 2.0 | inline or stylesheet outline:none/0 without a :focus-visible replacement |
| wcag-2.4.10 — Section Headings | AAA | 2.0 | long text content organized without headings |
| wcag-2.5.1 — Pointer Gestures | A | 2.1 | multipoint/path-based gesture handlers (pointerdown+pointermove, ongesture*) with no single-pointer equivalent |
| wcag-2.5.2 — Pointer Cancellation | A | 2.1 | actions firing on the down-event (mousedown/touchstart navigate/submit) with no way to abort |
| wcag-2.5.3 — Label in Name | A | 2.1 | aria-label that doesn't contain the control's visible text |
| wcag-2.5.4 — Motion Actuation | A | 2.1 | deviceorientation/devicemotion handlers driving functionality with no equivalent control |
| wcag-2.5.7 — Dragging Movements | AA | 2.2 | draggable elements / drag-event handlers with no single-pointer alternative |
| wcag-3.1.1 — Language of Page | A | 2.0 | <html> missing lang |
| wcag-3.1.2 — Language of Parts | AA | 2.0 | content in a different language than the page without a lang attribute |
| wcag-3.1.4 — Abbreviations | AAA | 2.0 | <abbr> without title/aria-label — no expanded-form mechanism |
| wcag-3.1.5 — Reading Level | AAA | 2.0 | prose estimated beyond lower-secondary grade (Flesch–Kincaid >9 on ≥150 words) — needs a simplified alternative (warn-class) |
| wcag-3.2.1 — On Focus | A | 2.0 | autofocus and onfocus handlers that navigate/submit/click |
| wcag-3.2.2 — On Input | A | 2.0 | onchange/oninput auto-submission and select jump-menus |
| wcag-3.3.1 — Error Identification | A | 2.0 | controls marked invalid with no associated error text (aria-errormessage/describedby) — warn-class |
| wcag-3.3.2 — Labels or Instructions | A | 2.0 | inputs without label/aria-label/aria-labelledby (placeholders don't count) |
| wcag-3.3.3 — Error Suggestion | AA | 2.0 | invalid control whose error text names the failure but suggests no correction — warn-class |
| wcag-3.3.4 — Error Prevention (Legal, Financial, Data) | AA | 2.0 | transactional forms with no check/reverse/confirm mechanism — warn-class |
| wcag-3.3.5 — Help | AAA | 2.0 | substantial forms (3+ fields) with no context-sensitive help mechanism — warn-class |
| wcag-3.3.6 — Error Prevention (All) | AAA | 2.0 | any form lacking a check/reverse/confirm step — warn-class |
| wcag-3.3.7 — Redundant Entry | A | 2.2 | same information requested twice in one form (duplicate fields) |
| wcag-3.3.8 — Accessible Authentication (Minimum) | AA | 2.2 | password fields blocking paste or missing autocomplete, forcing cognitive recall |
| wcag-3.3.9 — Accessible Authentication (Enhanced) | AAA | 2.2 | CAPTCHA/cognitive-challenge markup — AAA exempts no cognitive test |
| wcag-4.1.2 — Name, Role, Value | A | 2.0 | icon-only controls with no accessible name, iframes w/o title, invalid aria-* names, aria-hidden on <body> or focusable content, nested interactive elements |
| wcag-4.1.3 — Status Messages | AA | 2.1 | status/alert regions without role=status/alert or aria-live |

## Rendered layer (16 criteria)

| Criterion | Level | WCAG | What it flags |
|---|---|---|---|
| wcag-1.4.1 — Use of Color | A | 2.0 | links inside prose distinguished by color alone (<3:1 vs body text, no underline) |
| wcag-1.4.3 — Contrast (Minimum) | AA | 2.0 | text below 4.5:1 contrast ratio (3:1 large text) |
| wcag-1.4.6 — Contrast (Enhanced) | AAA | 2.0 | text below 7:1 contrast ratio — reported separately from AA failures |
| wcag-1.4.11 — Non-text Contrast | AA | 2.1 | control boundaries/states below 3:1 against adjacent colors |
| wcag-1.4.12 — Text Spacing | AA | 2.1 | content clipped when WCAG text-spacing metrics are applied |
| wcag-2.1.1 — Keyboard | A | 2.0 | no focusable elements, unreachable focusables, tabindex=-1 on natively focusable elements, scrollable regions not keyboard-reachable |
| wcag-2.1.2 — No Keyboard Trap | A | 2.0 | Tab-swallowing keydown handlers, undismissable dialogs, focus stall/cycle in a real adaptive-depth Tab trace (up to 64 presses), Escape ignored inside dialogs, Shift+Tab backward stalls/cycles, click-opened dialogs with no keyboard exit |
| wcag-2.4.1 — Bypass Blocks | A | 2.0 | no skip-navigation link to main content |
| wcag-2.4.3 — Focus Order | A | 2.0 | positive tabindex, focusables Tab never reaches, focus entering regions it can't exit, dialogs that open without receiving focus |
| wcag-2.4.11 — Focus Not Obscured (Minimum) | AA | 2.2 | focused element covered by sticky/fixed overlays at its scroll position |
| wcag-2.4.12 — Focus Not Obscured (Enhanced) | AAA | 2.2 | focused element partially covered — corner occlusion while centre stays visible |
| wcag-2.4.13 — Focus Appearance | AAA | 2.2 | focus indicator absent or below size/contrast thresholds in the live trace |
| wcag-2.5.5 — Target Size (Enhanced) | AAA | 2.1 | interactive targets in the 24–43px band — pass AA but miss the AAA 44×44 minimum |
| wcag-2.5.8 — Target Size (Minimum) | AA | 2.2 | interactive targets under 24×24 CSS px (exempting inline-text links and UA-default controls) |
| wcag-3.2.5 — Change on Request | AAA | 2.0 | target=_blank links without rel=noopener (context changes users can't control) |
| wcag-4.1.1 — Parsing | A | 2.0 | duplicate id attributes |

## Cross-page layer (4 criteria)

| Criterion | Level | WCAG | What it flags |
|---|---|---|---|
| wcag-2.4.8 — Location | AAA | 2.0 | pages with site nav but no breadcrumb/aria-current/sitemap wayfinding signal — warn-class |
| wcag-3.2.3 — Consistent Navigation | AA | 2.0 | shared nav links appearing in different relative order across pages |
| wcag-3.2.4 — Consistent Identification | AA | 2.0 | same link target carrying different accessible names on different pages |
| wcag-3.2.6 — Consistent Help | A | 2.2 | help mechanisms missing on some pages or appearing in inconsistent order |

## Best-practice checks (not numbered criteria)

Checks for real problems no published criterion covers. `level: BP`, no
conformance claim — filterable via `?level=BP` on reports.

| Check | What it flags |
|---|---|
| bp-visible-controls — Visible Controls | controls hidden by default revealed on :hover with no focus/focus-within counterpart — warn-class heuristic. Drafted as WCAG 2.2 SC 3.2.7 but removed before the final spec (w3c/wcag#3587), so reported as best practice, not a criterion |

---

> Status note for agents/docs: `GET /rules` (backed by `src/rules/manifest.js`,
> with `test/rules-manifest.test.mjs` enforcing that every emitted rule ID is
> declared and vice versa) is the authoritative shipped list. Do not generate
> tasks or docs claiming coverage beyond this manifest; do not propose
> implementation work for criteria already listed here.