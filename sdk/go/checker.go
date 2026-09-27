// Package checker is a client for the Accessibility Checker API —
// WCAG 2.1/2.2 scans, site crawls, reports, and Pro monitors.
// Standard library only.
package checker

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultBase is the production API host.
const DefaultBase = "https://checker.lazynext.com"

// Client talks to the Accessibility Checker API. License is the buyer email
// for Pro scans; leave empty for the free tier.
type Client struct {
	License string
	BaseURL string
	HTTP    *http.Client
}

func New(license string) *Client {
	return &Client{License: license, BaseURL: DefaultBase, HTTP: &http.Client{Timeout: 60 * time.Second}}
}

// ScanOptions selects a URL scan (rendered, free tier 3/day/IP) or a pasted
// HTML scan (no quota), optionally a same-origin site crawl.
type ScanOptions struct {
	URL         string `json:"url,omitempty"`
	HTML        string `json:"html,omitempty"`
	Site        bool   `json:"site,omitempty"`
	License     string `json:"license,omitempty"`
	EmailReport bool   `json:"email_report,omitempty"`
}

// Issue is one WCAG finding.
type Issue struct {
	Rule    string `json:"rule"`
	Message string `json:"message"`
	Fix     string `json:"fix,omitempty"`
	URL     string `json:"url,omitempty"`
}

// Section508Report is the 36 CFR 1194 clause mapping derived from the WCAG
// findings — 508 defines no web rules of its own; E205.4 incorporates
// WCAG 2.0 AA by reference.
type Section508Report struct {
	Basis             string   `json:"basis"`
	Conforms          bool     `json:"conforms"`
	CriteriaFailed    []string `json:"criteria_failed"`
	ClausesImplicated []string `json:"clauses_implicated"`
	ClauseCount       int      `json:"clause_count"`
}

// Benchmark positions a score against the public scan corpus — present once
// ≥10 distinct sites are on record.
type Benchmark struct {
	Pct   int `json:"pct"`
	Sites int `json:"sites"`
}

// ScanResult is the /scan response.
type ScanResult struct {
	Score       int              `json:"score"`
	ScoreModel  string           `json:"score_model"`
	Issues      []Issue          `json:"issues"`
	Rendered    bool             `json:"rendered"`
	Plan        string           `json:"plan"`
	Section508  Section508Report `json:"section508"`
	Report      string           `json:"report,omitempty"`
	RenderError string           `json:"render_error,omitempty"`
	Site        bool             `json:"site,omitempty"`
	Pages       []struct {
		URL   string `json:"url"`
		Score int    `json:"score"`
		Count int    `json:"count"`
	} `json:"pages,omitempty"`
	Benchmark *Benchmark `json:"benchmark,omitempty"`
}

// Rule describes one check the scanner can emit.
type Rule struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Level     string `json:"level"`
	WCAG      string `json:"wcag"`
	Detection string `json:"detection"`
}

// APIError carries the non-2xx response.
type APIError struct {
	Status int
	Body   map[string]any
}

func (e *APIError) Error() string {
	if m, ok := e.Body["error"].(string); ok {
		return fmt.Sprintf("a11y-checker %d: %s", e.Status, m)
	}
	return fmt.Sprintf("a11y-checker %d", e.Status)
}

func (c *Client) do(method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	r, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		return err
	}
	if r.StatusCode >= 400 {
		e := &APIError{Status: r.StatusCode, Body: map[string]any{}}
		_ = json.Unmarshal(raw, &e.Body)
		return e
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// Scan audits opts.URL (rendered) or opts.HTML (static) for WCAG issues.
func (c *Client) Scan(opts ScanOptions) (*ScanResult, error) {
	if opts.License == "" {
		opts.License = c.License
	}
	var res ScanResult
	if err := c.do("POST", "/scan", opts, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// Site crawls same-origin pages (3 free / 10 Pro) and aggregates findings.
func (c *Client) Site(u string) (*ScanResult, error) {
	return c.Scan(ScanOptions{URL: u, Site: true})
}

// Rules returns the full WCAG coverage manifest.
func (c *Client) Rules() ([]Rule, error) {
	var res struct {
		Rules []Rule `json:"rules"`
	}
	if err := c.do("GET", "/rules", nil, &res); err != nil {
		return nil, err
	}
	return res.Rules, nil
}

// ReportURL / BadgeURL build the public links for a stored report id.
func (c *Client) ReportURL(id string) string { return c.BaseURL + "/report/" + id }
func (c *Client) BadgeURL(id string) string  { return c.BaseURL + "/badge/" + id + ".svg" }

// StoredReport is the persisted scan report served at /report/{id}.json
// (30-day TTL) — the raw findings export. URL is empty for pasted-HTML scans
// (the stored field is null there).
type StoredReport struct {
	URL         string  `json:"url"`
	Ts          int64   `json:"ts"`
	Score       int     `json:"score"`
	ScoreModel  string  `json:"score_model"`
	Rendered    bool    `json:"rendered"`
	Plan        string  `json:"plan"`
	RenderError string  `json:"render_error,omitempty"`
	Site        bool    `json:"site,omitempty"`
	Issues      []Issue `json:"issues"`
	Pages       []struct {
		URL   string `json:"url"`
		Score int    `json:"score"`
		Count int    `json:"count"`
	} `json:"pages,omitempty"`
	Section508 Section508Report `json:"section508"`
	Benchmark  *Benchmark       `json:"benchmark,omitempty"`
}

// Report fetches a stored report's raw findings via the .json export.
// view applies the web view's filters, e.g. Report(id, "level=A").
func (c *Client) Report(id string, view ...string) (*StoredReport, error) {
	p := "/report/" + url.PathEscape(id) + ".json"
	if len(view) > 0 {
		p += "?" + strings.Join(view, "&")
	}
	var rep StoredReport
	if err := c.do("GET", p, nil, &rep); err != nil {
		return nil, err
	}
	return &rep, nil
}

// ReportCSV fetches a stored report as CSV.
func (c *Client) ReportCSV(id string) (string, error) {
	r, err := c.HTTP.Get(c.BaseURL + "/report/" + url.PathEscape(id) + ".csv")
	if err != nil {
		return "", err
	}
	defer r.Body.Close()
	if r.StatusCode >= 400 {
		return "", fmt.Errorf("a11y-checker %d: report not found or expired", r.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	return string(b), err
}

// MonitorAdd / MonitorRemove start or stop daily rescans. Both email a
// confirmation link (mailbox proof) — the monitor isn't live until clicked.
func (c *Client) MonitorAdd(u string) error {
	return c.do("POST", "/monitor", map[string]string{"url": u, "license": c.License}, nil)
}
func (c *Client) MonitorRemove(u string) error {
	return c.do("DELETE", "/monitor", map[string]string{"url": u, "license": c.License}, nil)
}

// MonitorList returns the license's active monitors.
func (c *Client) MonitorList() ([]map[string]any, error) {
	var res struct {
		Monitors []map[string]any `json:"monitors"`
	}
	err := c.do("GET", "/monitor?license="+url.QueryEscape(c.License), nil, &res)
	return res.Monitors, err
}

// Lead submits an email to the product's nurture sequence.
func (c *Client) Lead(email string) error {
	return c.do("POST", "/lead", map[string]string{"email": email}, nil)
}
