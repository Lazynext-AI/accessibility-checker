// checker_test.go — offline tests against an httptest stub; no live API.
// Run: go test .  (inside sdk/go) — or via test/sdk-go.test.mjs.
package checker

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func stub(t *testing.T) (*Client, *[]string) {
	t.Helper()
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.RequestURI())
		switch {
		case r.URL.Path == "/rules":
			w.Header().Set("content-type", "application/json")
			fmt.Fprint(w, `{"count":1,"rules":[{"id":"wcag-1.1.1","name":"alt text","level":"A","wcag":"2.1","detection":"static"}]}`)
		case r.URL.Path == "/report/r1.json":
			w.Header().Set("content-type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"url": "https://example.com", "ts": 1759000000000, "score": 80,
				"score_model": "weighted-v1", "rendered": true, "plan": "free",
				"issues": []map[string]any{{"rule": "wcag-1.1.1", "message": "img missing alt"}},
				"section508": map[string]any{
					"basis":              "WCAG 2.0 AA (incorporated by 36 CFR 1194 E205.4)",
					"conforms":           false,
					"criteria_failed":    []string{"wcag-1.1.1"},
					"clauses_implicated": []string{"302.1"},
					"clause_count":       1,
				},
				"benchmark": map[string]any{"pct": 42, "sites": 137},
			})
		case r.URL.Path == "/report/r1.csv":
			w.Header().Set("content-type", "text/csv")
			fmt.Fprint(w, "rule,criterion,level\nwcag-1.1.1,alt text,A\n")
		case r.URL.Path == "/report/null.json":
			w.Header().Set("content-type", "application/json")
			fmt.Fprint(w, `{"url":null,"ts":1759000000000,"score":100,"rendered":false,"issues":[],"section508":{"basis":"x","conforms":true,"criteria_failed":[],"clauses_implicated":[],"clause_count":0}}`)
		default:
			w.WriteHeader(404)
			fmt.Fprint(w, `{"error":"report not found or expired"}`)
		}
	}))
	t.Cleanup(srv.Close)
	c := New("")
	c.BaseURL = srv.URL
	return c, &paths
}

func TestReportDecodesStoredObject(t *testing.T) {
	c, paths := stub(t)
	rep, err := c.Report("r1")
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	if rep.Score != 80 || rep.ScoreModel != "weighted-v1" || rep.Plan != "free" {
		t.Fatalf("scalar fields: %+v", rep)
	}
	if rep.URL != "https://example.com" || rep.Ts != 1759000000000 {
		t.Fatalf("url/ts: %+v", rep)
	}
	if len(rep.Issues) != 1 || rep.Issues[0].Rule != "wcag-1.1.1" {
		t.Fatalf("issues: %+v", rep.Issues)
	}
	if rep.Section508.Conforms || rep.Section508.ClauseCount != 1 || rep.Section508.ClausesImplicated[0] != "302.1" {
		t.Fatalf("section508: %+v", rep.Section508)
	}
	if rep.Benchmark == nil || rep.Benchmark.Pct != 42 || rep.Benchmark.Sites != 137 {
		t.Fatalf("benchmark: %+v", rep.Benchmark)
	}
	if got := (*paths)[len(*paths)-1]; got != "GET /report/r1.json" {
		t.Fatalf("request path: %s", got)
	}
}

func TestReportNullURLDecodesEmpty(t *testing.T) {
	c, _ := stub(t)
	rep, err := c.Report("null")
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	if rep.URL != "" {
		t.Fatalf("null url should decode to empty string, got %q", rep.URL)
	}
	if rep.Benchmark != nil {
		t.Fatalf("absent benchmark should stay nil, got %+v", rep.Benchmark)
	}
}

func TestReportViewFiltersForward(t *testing.T) {
	c, paths := stub(t)
	if _, err := c.Report("r1", "level=A", "rule=wcag-1.1.1"); err != nil {
		t.Fatalf("Report: %v", err)
	}
	got := (*paths)[len(*paths)-1]
	if got != "GET /report/r1.json?level=A&rule=wcag-1.1.1" {
		t.Fatalf("view params: %s", got)
	}
}

func TestReportNotFound(t *testing.T) {
	c, _ := stub(t)
	_, err := c.Report("missing")
	var ae *APIError
	if !errors.As(err, &ae) || ae.Status != 404 {
		t.Fatalf("want *APIError 404, got %v", err)
	}
	if ae.Body["error"] != "report not found or expired" {
		t.Fatalf("error body: %v", ae.Body)
	}
}

func TestReportCSV(t *testing.T) {
	c, _ := stub(t)
	csv, err := c.ReportCSV("r1")
	if err != nil {
		t.Fatalf("ReportCSV: %v", err)
	}
	if csv != "rule,criterion,level\nwcag-1.1.1,alt text,A\n" {
		t.Fatalf("csv body: %q", csv)
	}
}

func TestRules(t *testing.T) {
	c, _ := stub(t)
	rules, err := c.Rules()
	if err != nil {
		t.Fatalf("Rules: %v", err)
	}
	if len(rules) != 1 || rules[0].ID != "wcag-1.1.1" {
		t.Fatalf("rules: %+v", rules)
	}
}
