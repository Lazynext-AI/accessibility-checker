export interface CheckerOptions { baseUrl?: string; license?: string; }
export interface ScanOptions {
  url?: string;
  html?: string;
  site?: boolean;
  emailReport?: boolean;
}
export interface Issue {
  rule: string;
  message: string;
  fix?: string;
  url?: string;
}
/** 36 CFR 1194 clause mapping derived from the WCAG findings — 508 defines
 * no web rules of its own; E205.4 incorporates WCAG 2.0 AA by reference. */
export interface Section508Report {
  basis: string;
  conforms: boolean;
  criteria_failed: string[];
  clauses_implicated: string[];
  clause_count: number;
}
/** Score position vs the public scan corpus — present once ≥10 sites on record. */
export interface Benchmark { pct: number; sites: number; }
export interface ScanResult {
  score: number;
  score_model: "weighted-v1";
  issues: Issue[];
  rendered: boolean;
  plan: "free" | "pro";
  section508: Section508Report;
  report?: string;
  render_error?: string;
  site?: boolean;
  pages?: { url: string; score: number; count: number }[];
  benchmark?: Benchmark;
}
export interface Rule {
  id: string;
  name: string;
  level: string;
  wcag: string;
  detection: string;
}
export interface StoredReport {
  /** Scanned URL, or null for pasted-HTML scans. */
  url: string | null;
  ts: number;
  score: number;
  score_model: "weighted-v1";
  rendered: boolean;
  plan: "free" | "pro";
  render_error?: string;
  site?: boolean;
  issues: Issue[];
  pages?: { url: string; score: number; count: number }[];
  section508: Section508Report;
  benchmark?: Benchmark;
}
export interface ReportView { level?: string; rule?: string; }

export class AccessibilityChecker {
  constructor(opts?: CheckerOptions);
  baseUrl: string;
  license: string;
  scan(opts: ScanOptions): Promise<ScanResult>;
  site(url: string): Promise<ScanResult>;
  report(id: string, view?: ReportView): Promise<StoredReport>;
  reportCsv(id: string): Promise<string>;
  reportUrl(id: string): string;
  badgeUrl(id: string): string;
  rules(): Promise<{ count: number; rules: Rule[] }>;
  monitorAdd(url: string): Promise<{ ok: boolean; confirm: string }>;
  monitorRemove(url: string): Promise<{ ok: boolean; confirm: string }>;
  monitorList(): Promise<unknown>;
  lead(email: string): Promise<{ ok: boolean }>;
  mcpTools(): Promise<unknown[] | undefined>;
  mcpCall(name: string, args?: Record<string, unknown>): Promise<unknown>;
  agentCard(): Promise<unknown>;
}
export default AccessibilityChecker;
