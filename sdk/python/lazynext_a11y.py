"""Accessibility Checker API client — WCAG 2.1/2.2 scans, site crawls,
reports, monitors. Stdlib only (urllib), Python 3.9+.

    from lazynext_a11y import AccessibilityChecker
    c = AccessibilityChecker()
    result = c.scan(url="https://example.com")
    print(result["score"], c.report_url(result["id"]))
"""

import json
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_BASE = "https://checker.lazynext.com"
UA = "lazynext-a11y/0.1 (+https://checker.lazynext.com)"


class CheckerError(Exception):
    """API error — carries the HTTP status and decoded error body."""

    def __init__(self, status, message, data=None):
        super().__init__(f"a11y-checker {status}: {message}")
        self.status = status
        self.data = data or {}


class AccessibilityChecker:
    def __init__(self, base_url=DEFAULT_BASE, license=""):
        self.base_url = base_url.rstrip("/")
        self.license = license

    def _req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        # urllib's default "Python-urllib/x.y" UA is 403'd by Cloudflare's bot
        # rules — a named client UA is required for every request.
        req = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers={"user-agent": UA, **({"content-type": "application/json"} if data else {})},
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read())
            except (json.JSONDecodeError, ValueError):
                payload = {}
            raise CheckerError(e.code, payload.get("error") or e.reason, payload) from e

    def scan(self, url=None, html=None, site=False, email_report=False):
        """Scan a URL (rendered, quota: 3/day/IP free) or pasted HTML (no quota)."""
        body = {}
        if url:
            body["url"] = url
        if html:
            body["html"] = html
        if site:
            body["site"] = True
        if email_report:
            body["email_report"] = True
        if self.license:
            body["license"] = self.license
        return self._req("POST", "/scan", body)

    def site(self, url):
        """Whole-site crawl — same-origin pages, 3 free / 10 Pro."""
        return self.scan(url=url, site=True)

    def _get(self, path):
        req = urllib.request.Request(self.base_url + path, headers={"user-agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise CheckerError(e.code, "report not found or expired") from e

    def report_csv(self, report_id):
        """Stored report as CSV text. The HTML report lives at report_url()."""
        return self._get(f"/report/{report_id}.csv").decode()

    def report(self, report_id, level=None, rule=None):
        """Stored report as the parsed JSON object — score, issues, pages,
        section508. level/rule apply the same view filters as the web report."""
        q = urllib.parse.urlencode({k: v for k, v in (("level", level), ("rule", rule)) if v})
        return json.loads(self._get(f"/report/{report_id}.json{'?' + q if q else ''}"))

    def report_url(self, report_id):
        return f"{self.base_url}/report/{report_id}"

    def badge_url(self, report_id):
        return f"{self.base_url}/badge/{report_id}.svg"

    def rules(self):
        """Full WCAG coverage manifest — every rule the scanner can emit."""
        return self._req("GET", "/rules")

    def monitor_add(self, url):
        """Add a Pro monitor — resolves to {ok, confirm: 'email'}; the
        confirmation link lands in the licensee's mailbox first."""
        return self._req("POST", "/monitor", {"url": url, "license": self.license})

    def monitor_remove(self, url):
        return self._req("DELETE", "/monitor", {"url": url, "license": self.license})

    def monitor_list(self):
        return self._req("GET", "/monitor?license=" + urllib.parse.quote(self.license))

    def lead(self, email):
        """Lead capture (product updates + nurture sequence)."""
        return self._req("POST", "/lead", {"email": email})

    def mcp_tools(self):
        d = self._req("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        return d.get("result", {}).get("tools")

    def mcp_call(self, name, arguments=None):
        return self._req("POST", "/mcp", {
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        })

    def agent_card(self):
        return self._req("GET", "/.well-known/agent.json")
