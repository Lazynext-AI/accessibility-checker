"""Offline tests for lazynext_a11y — in-process stub server, no live API.

    python3 -m unittest sdk/python/test_lazynext_a11y.py
    (also run via test/sdk-python.test.mjs inside `node --test`)

The critical assertion is the User-Agent: Cloudflare 403s urllib's default
"Python-urllib/x.y", so every request must carry the named lazynext-a11y UA.
"""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lazynext_a11y import AccessibilityChecker, CheckerError

SEEN = []  # (method, path, user-agent) — wire-level record


class Stub(BaseHTTPRequestHandler):
    def _reply(self, status, ctype, body):
        data = body.encode()
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, status, obj):
        self._reply(status, "application/json", json.dumps(obj))

    def do_GET(self):
        SEEN.append(("GET", self.path, self.headers.get("user-agent")))
        if self.path == "/rules":
            return self._json(200, {"count": 1, "rules": [{"id": "wcag-1.1.1"}]})
        if self.path.startswith("/report/r1.json"):
            return self._json(200, {
                "url": "https://example.com", "ts": 1759000000000, "score": 80,
                "score_model": "weighted-v1", "rendered": True, "plan": "free",
                "issues": [{"rule": "wcag-1.1.1", "message": "img missing alt"}],
                "section508": {"basis": "WCAG 2.0 AA (incorporated by 36 CFR 1194 E205.4)",
                               "conforms": False, "criteria_failed": ["wcag-1.1.1"],
                               "clauses_implicated": ["302.1"], "clause_count": 1},
            })
        if self.path == "/report/r1.csv":
            return self._reply(200, "text/csv", "rule,criterion,level\nwcag-1.1.1,alt text,A\n")
        self._json(404, {"error": "report not found or expired"})

    def do_POST(self):
        SEEN.append(("POST", self.path, self.headers.get("user-agent")))
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        if self.path == "/scan":
            return self._json(200, {"score": 80, "issues": [], "rendered": True,
                                    "plan": "free", "_echo": body})
        self._json(404, {"error": "not found"})

    def log_message(self, *args):
        pass


class SdkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.c = AccessibilityChecker(
            base_url=f"http://127.0.0.1:{cls.server.server_address[1]}"
        )

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def _last_ua(self):
        return SEEN[-1][2]

    def test_report_decodes_stored_object_with_named_ua(self):
        rep = self.c.report("r1")
        self.assertEqual(rep["score"], 80)
        self.assertEqual(rep["section508"]["clause_count"], 1)
        method, path, ua = SEEN[-1]
        self.assertEqual((method, path), ("GET", "/report/r1.json"))
        # The Cloudflare 403 fix: the named UA must reach the wire, never
        # urllib's default "Python-urllib/x.y".
        self.assertTrue(ua.startswith("lazynext-a11y/"), f"UA was {ua!r}")
        self.assertNotIn("Python-urllib", ua)

    def test_report_view_filters_forward(self):
        self.c.report("r1", level="A", rule="wcag-1.1.1")
        _, path, _ = SEEN[-1]
        self.assertIn("level=A", path)
        self.assertIn("rule=wcag-1.1.1", path)
        self.assertTrue(path.startswith("/report/r1.json?"))

    def test_report_404_raises_checker_error(self):
        with self.assertRaises(CheckerError) as ctx:
            self.c.report("missing")
        self.assertEqual(ctx.exception.status, 404)
        self.assertIn("report not found", str(ctx.exception))

    def test_report_csv_returns_text(self):
        csv = self.c.report_csv("r1")
        self.assertTrue(csv.startswith("rule,criterion,level\n"))
        self.assertTrue(self._last_ua().startswith("lazynext-a11y/"))

    def test_rules_sends_named_ua(self):
        rules = self.c.rules()
        self.assertEqual(rules["count"], 1)
        self.assertTrue(self._last_ua().startswith("lazynext-a11y/"))

    def test_scan_posts_body_with_named_ua(self):
        out = self.c.scan(url="https://example.com")
        self.assertEqual(out["_echo"]["url"], "https://example.com")
        self.assertTrue(self._last_ua().startswith("lazynext-a11y/"))


if __name__ == "__main__":
    unittest.main()
