// Accessibility Checker API client — WCAG 2.1/2.2 scans from JS/TS.
// Works in Node 18+ and browsers (global fetch). No dependencies.

const DEFAULT_BASE = "https://checker.lazynext.com";

export class AccessibilityChecker {
  constructor({ baseUrl = DEFAULT_BASE, license = "" } = {}) {
    this.license = license;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async _req(method, path, body) {
    const r = await fetch(this.baseUrl + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(`a11y-checker ${r.status}: ${data.error ?? r.statusText}`);
      err.status = r.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Scan a URL (rendered, quota: 3/day/IP free) or pasted HTML (no quota).
  // opts: { url } | { html }, plus { site: true, emailReport: true }.
  scan(opts) {
    return this._req("POST", "/scan", {
      ...(opts.url ? { url: opts.url } : {}),
      ...(opts.html ? { html: opts.html } : {}),
      ...(opts.site ? { site: true } : {}),
      ...(opts.emailReport ? { email_report: true } : {}),
      ...(this.license ? { license: this.license } : {}),
    });
  }

  // Whole-site crawl — same-origin pages, 3 free / 10 Pro.
  site(url) { return this.scan({ url, site: true }); }

  // Stored report as CSV (machine-readable). The HTML report lives at
  // `${baseUrl}/report/${id}` — the `report` field in every scan result.
  async reportCsv(id) {
    const r = await fetch(`${this.baseUrl}/report/${id}.csv`);
    if (!r.ok) throw new Error(`a11y-checker ${r.status}: report not found or expired`);
    return r.text();
  }

  // Stored report as the parsed JSON object — score, issues, pages, section508.
  // view: { level: 'A', rule: 'wcag-1.4.3' } applies the web view's filters.
  async report(id, view = {}) {
    const p = new URLSearchParams();
    if (view.level) p.set("level", view.level);
    if (view.rule) p.set("rule", view.rule);
    const q = p.toString();
    const r = await fetch(`${this.baseUrl}/report/${id}.json${q ? `?${q}` : ""}`);
    if (!r.ok) throw new Error(`a11y-checker ${r.status}: report not found or expired`);
    return r.json();
  }

  reportUrl(id) { return `${this.baseUrl}/report/${id}`; }
  badgeUrl(id) { return `${this.baseUrl}/badge/${id}.svg`; }

  // Full WCAG coverage manifest — every rule the scanner can emit.
  rules() { return this._req("GET", "/rules"); }

  // Pro monitors — both mutations email a confirmation link (mailbox proof),
  // so they resolve with { ok, confirm: 'email' } not an immediate change.
  monitorAdd(url) { return this._req("POST", "/monitor", { url, license: this.license }); }
  monitorRemove(url) { return this._req("DELETE", "/monitor", { url, license: this.license }); }
  monitorList() { return this._req("GET", `/monitor?license=${encodeURIComponent(this.license)}`); }

  // Lead capture (product updates + nurture sequence).
  lead(email) { return this._req("POST", "/lead", { email }); }

  // MCP + A2A — agent-protocol access to the same scan pipeline.
  mcpTools() {
    return this._req("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }).then((d) => d.result?.tools);
  }
  mcpCall(name, args = {}) {
    return this._req("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  }
  agentCard() { return this._req("GET", "/.well-known/agent.json"); }
}

export default AccessibilityChecker;
