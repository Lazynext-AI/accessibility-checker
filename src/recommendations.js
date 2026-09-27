// Per-finding remediation guidance — the "how to fix" layer.
//
// Every scan issue carries {rule, message}; this module adds a `fix` string
// per rule so API consumers and report readers get actionable guidance, not
// bare violations. Unknown rules fall through with no fix field — an absent
// fix is honest, a generic "follow WCAG" is not.

const FIXES = {
  "wcag-1.1.1": "Add descriptive alt text to informative images; alt=\"\" for decorative ones.",
  "wcag-1.2.1": "Give prerecorded audio/video a text alternative: captions for video, a transcript for audio.",
  "wcag-1.2.2": "Add synchronized captions for prerecorded video with audio — a <track kind=captions> element or burned-in subtitles.",
  "wcag-1.2.5": "Add a <track kind=\"descriptions\"> for prerecorded video, or verify the audio track already describes the visuals.",
  "wcag-1.3.1": "Use semantic landmarks (main/nav/header/footer), headings in order, and real form labels — don't fake structure with divs.",
  "wcag-1.3.2": "Keep DOM order matching visual order — don't reorder content with CSS `order`/reversed flex or aria-flowto unless the DOM is already correct.",
  "wcag-1.3.3": "Don't rely on color, shape, or position alone in instructions — name the control or describe it in text.",
  "wcag-1.3.4": "Don't lock orientation — support both portrait and landscape unless one is essential.",
  "wcag-1.3.5": "Add the right autocomplete token on personal-data fields (email, name, tel) so browsers can autofill.",
  "wcag-1.4.1": "Don't convey meaning by color alone — underline links in body text or add a non-color cue.",
  "wcag-1.4.2": "Give audio that plays automatically for 3s+ a way to pause, stop, or control volume.",
  "wcag-1.4.3": "Raise text contrast to at least 4.5:1 (3:1 for large text) — darken the text or lighten the background.",
  "wcag-1.4.4": "Allow text to resize to 200%: avoid maximum-scale=1 / user-scalable=no in the viewport meta.",
  "wcag-1.4.5": "Use real text instead of images of text so users can restyle and magnify it.",
  "wcag-1.4.6": "Enhanced contrast needs 7:1 — darken foreground or lighten background further.",
  "wcag-1.4.7": "Remove background audio under speech, keep it 20dB quieter, or give users a switch to turn it off.",
  "wcag-1.4.8": "Avoid justified text without hyphenation — it creates rivers of whitespace that hurt readability.",
  "wcag-1.4.9": "At AAA no images of text are allowed outside pure decoration and logos — replace with styled text.",
  "wcag-1.4.10": "Support 320px reflow: avoid fixed widths and horizontal-only layouts; test zoomed to 400%.",
  "wcag-1.4.11": "Give interactive controls and focus indicators 3:1 contrast against adjacent colors — strengthen borders or fills.",
  "wcag-1.4.12": "Content must survive increased text spacing — remove fixed heights that clip when users override spacing.",
  "wcag-1.4.13": "Content revealed on hover/focus must be dismissable (Escape) without moving the pointer or focus.",
  "wcag-2.1.1": "Every interactive element needs keyboard access — use native controls or add tabindex + key handlers.",
  "wcag-2.1.3": "Keyboard-only users must reach every scrollable region — add tabindex=\"0\" so it joins the tab order.",
  "wcag-2.1.2": "Remove keydown/keypress handlers that preventDefault Tab; ensure modals and dialogs can be exited with keyboard (Escape or a focusable close control).",
  "wcag-2.1.4": "Avoid single-character shortcuts and accesskey attributes — they fire when users type.",
  "wcag-2.2.1": "Remove timed redirects/refreshes — if timing is essential, let users extend or turn it off.",
  "wcag-2.2.4": "Timed refreshes are banned at Level AAA — replace <meta refresh> with a user-initiated action or no interruption at all.",
  "wcag-2.2.2": "Moving, blinking, or auto-updating content needs a pause/stop control.",
  "wcag-2.3.1": "Remove blinking content (<blink>, text-decoration:blink) — nothing should flash more than 3 times/second.",
  "wcag-2.3.2": "At AAA nothing may flash at all — remove flashing markup entirely.",
  "wcag-2.4.1": "Add a skip link ('Skip to main content' → #main) as the first focusable element.",
  "wcag-2.4.2": "Give the page a descriptive <title> that names its topic or purpose.",
  "wcag-2.4.3": "Remove positive tabindex values — use tabindex=0 or let DOM order carry focus.",
  "wcag-2.4.4": "Make link purpose clear from the link text or context — 'click here' and dead/javascript: hrefs fail everyone.",
  "wcag-2.4.9": "Links sharing text but pointing to different targets need distinct labels — add an aria-label or make the text unique.",
  "wcag-2.4.5": "Offer a second way to find pages — search, a sitemap link, or a table of contents alongside nav.",
  "wcag-2.4.6": "Give every heading real text content — an empty or icon-only heading announces nothing.",
  "wcag-2.4.7": "Restore a visible focus indicator: outline, ring, or underline on :focus-visible.",
  "wcag-2.4.8": "Give users a wayfinding signal — breadcrumbs, aria-current on the nav item, or a sitemap link.",
  "wcag-2.4.10": "Break long content into sections with headings — screen-reader users navigate by them.",
  "wcag-2.4.11": "Focused elements must stay visible — don't let sticky bars or overlays cover them.",
  "wcag-2.4.12": "Even partial occlusion fails at AAA — check corners and edges of focused elements against overlapping chrome.",
  "wcag-2.4.13": "Give focus a strong visible indicator — the enhanced AAA check needs a larger or higher-contrast outline.",
  "wcag-2.5.2": "Don't trigger actions on down-events — activate on click/up so users can slide off to cancel.",
  "wcag-2.5.3": "Make the accessible name contain the visible text — aria-label must include (not replace) what the control shows.",
  "wcag-2.5.4": "Don't require motion (tilt/shake) without an equivalent control — offer a button or toggle.",
  "wcag-2.5.7": "Dragging needs a single-pointer alternative — a button, menu item, or keyboard path that does the same thing.",
  "wcag-2.5.8": "Make pointer targets at least 24×24px — enlarge small icon buttons or add spacing.",
  "wcag-3.1.1": "Set lang on <html> so assistive tech picks the right speech engine and hyphenation.",
  "wcag-3.1.2": "Mark content in another language with lang on the containing element.",
  "wcag-3.1.5": "Provide a simplified text version or supplemental aids (illustrations, summaries) for content beyond lower-secondary reading level.",
  "wcag-3.2.1": "Don't change context on focus — moving focus must not navigate, submit, or open dialogs.",
  "wcag-3.2.2": "Don't change context on input — selects and inputs must not auto-submit or navigate without a button.",
  "wcag-3.2.3": "Keep navigation links in the same order on every page of the site.",
  "wcag-3.2.4": "Use one label per destination site-wide — the same link target should read the same everywhere.",
  "wcag-3.2.5": "Only launch new windows/tabs on request — warn users before opening them automatically.",
  "wcag-3.2.6": "Keep help mechanisms (contact, support, FAQ links) in the same order on every page that offers them.",
  "wcag-3.2.7": "Controls hidden until needed must appear on keyboard focus too — pair every :hover reveal with a :focus or :focus-within rule.",
  "wcag-3.3.1": "Describe each input error in text and link it — aria-errormessage or aria-describedby pointing at the message element.",
  "wcag-3.3.2": "Give every input a label, aria-label, or aria-labelledby — placeholders are not labels.",
  "wcag-3.3.3": "Error messages should suggest a fix — state the expected format or give a valid example, not just \"invalid\".",
  "wcag-3.3.4": "Transactional submissions need a review step, a confirmation, or reversibility — add a confirm dialog or review page.",
  "wcag-3.3.5": "Offer context-sensitive help — field hints via aria-describedby, a help link, or inline instructions.",
  "wcag-3.3.6": "At AAA every form needs a way to review, confirm, or reverse the submission.",
  "wcag-3.3.7": "Don't ask users to re-enter information already provided — reuse it or offer a selection.",
  "wcag-3.3.8": "Don't gate login on puzzles or memory tests — offer autocomplete, paste support, or an alternative auth path.",
  "wcag-3.3.9": "At AAA no cognitive test is allowed in authentication — offer passkeys, magic links, or OAuth instead of CAPTCHA.",
  "wcag-4.1.1": "Keep id values unique and markup well-formed — duplicates break label and ARIA references.",
  "wcag-4.1.2": "Custom controls need name, role, and value exposed — prefer native elements or complete the ARIA contract.",
  "wcag-4.1.3": "Status updates need role=status, role=alert, or aria-live so screen readers announce them.",
};

export function fixFor(rule) {
  return FIXES[rule] ?? null;
}

export function withRecommendations(issues) {
  return (issues ?? []).map((i) => {
    const fix = fixFor(i.rule);
    return fix ? { ...i, fix } : i;
  });
}
