# lazynext-accessibility-checker

Python client for the [Accessibility Checker](https://checker.lazynext.com) API.
Stdlib only — no dependencies, Python 3.9+.

```python
from lazynext_a11y import AccessibilityChecker

c = AccessibilityChecker()                       # free tier: 3 scans/day/IP
c = AccessibilityChecker(license="pro-key")      # Pro monitors, higher quotas

result = c.scan(url="https://example.com")       # rendered scan
result = c.scan(html="<html>…")                  # pasted HTML — no quota
result = c.site("https://example.com")           # same-origin crawl

print(c.report_url(result["id"]))                # HTML report
print(c.report_csv(result["id"]))                # CSV export
print(c.report(result["id"])["score"])           # parsed JSON object
print(c.report(result["id"], level="A"))         # level-filtered findings
print(c.rules())                                 # full coverage manifest

c.monitor_add("https://example.com")             # Pro: daily rescan + alert
c.monitor_list()
c.monitor_remove("https://example.com")

c.mcp_tools();  c.mcp_call("scan_url", {"url": "https://example.com"})
c.agent_card()                                   # A2A agent card
```

Self-hosted / testing: `AccessibilityChecker(base_url="http://localhost:8787")`.

Errors raise `CheckerError` with `.status` and `.data` (decoded body).
