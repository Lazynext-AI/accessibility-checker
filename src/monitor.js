/**
 * Pro-tier scheduled monitoring — state management for periodic site scans.
 * Pure functions, environment-agnostic; no DOM, no KV access (callers pass
 * values in). The worker/cron layer owns reads and writes; this module owns
 * the record shape and change detection.
 */

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

/** Deterministic monitor key: 'mon:<email>:<url-hash>'. */
export function monitorKey(email, url) {
  const norm = String(url ?? "").trim().toLowerCase().replace(/\/+$/, "");
  let h = 5381;
  const bytes = encoder ? encoder.encode(norm) : norm.split("").map((c) => c.charCodeAt(0));
  for (const b of bytes) h = ((h << 5) + h + b) >>> 0;
  return `mon:${String(email ?? "").trim().toLowerCase()}:${h.toString(36)}`;
}

/** Fresh monitor record for an owner+URL pair. */
export function buildMonitorRecord({ email, url, viewport }) {
  return {
    url: String(url ?? "").trim(),
    email: String(email ?? "").trim().toLowerCase(),
    // Pinned render profile — rescans compare like-for-like against it.
    viewport: viewport === "desktop" ? "desktop" : "mobile",
    created_at: Date.now(),
    last_score: null,
    last_scan_at: null,
    scans: 0,
    alerts: 0,
  };
}

/**
 * Fold a completed scan into the record.
 * scoreDropped is true when the score fell >= DROP_THRESHOLD points vs the
 * previous last_score (first scan never "drops").
 */
export const DROP_THRESHOLD = 10;

export function updateMonitorRecord(record, score, ts = Date.now()) {
  const prev = record.last_score;
  const scoreDropped = prev !== null && typeof prev === "number" && prev - score >= DROP_THRESHOLD;
  return {
    ...record,
    last_score: score,
    last_scan_at: ts,
    scans: (record.scans ?? 0) + 1,
    alerts: (record.alerts ?? 0) + (scoreDropped ? 1 : 0),
    scoreDropped,
  };
}

/** All monitor records owned by an email, given a {key: record} map. */
export function listMonitorsForEmail(kvMap, email) {
  const owner = String(email ?? "").trim().toLowerCase();
  return Object.entries(kvMap ?? {})
    .filter(([key, rec]) => key.startsWith(`mon:${owner}:`) || rec?.email === owner)
    .map(([key, rec]) => ({ key, ...rec }));
}
