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
export interface ScanResult {
  score: number;
  issues: Issue[];
  rendered: boolean;
  plan: "free" | "pro";
  section508: unknown;
  report?: string;
  render_error?: string;
  site?: boolean;
  pages?: { url: string; score: number; count: number }[];
}
export interface Rule {
  id: string;
  name: string;
  level: string;
  wcag: string;
  detection: string;
}
export interface StoredReport {
  url: string;
  ts: number;
  score: number;
  rendered: boolean;
  site?: boolean;
  issues: Issue[];
  pages?: { url: string; score: number; count: number }[];
  section508?: unknown;
  benchmark?: unknown;
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
