# Accessibility Checker — Backup & Disaster Recovery

Concrete recovery plan for the product at `checker.lazynext.com`. Every
mechanism below has been executed at least once — see "Verified drills".

## What the product's data actually is

The worker has **no storage bindings of its own**. Its only binding is the
`PLATFORM` service binding (`deploy.mjs` metadata), and every read/write —
`kvGet`, `kvPut`, D1 writes, email — is a `platform('/kv/get' | '/kv/put' | …)`
call to `ai-company-os` (`worker.js` lines 37–55). Therefore:

| State | Where it lives | Covered by |
|---|---|---|
| `report:*` scan reports (30d TTL) | Platform KV `EPHEMERAL` | KV — ephemeral by design, not exported |
| `mon:*` monitor registrations (ttl 0) | Platform KV `EPHEMERAL` | KV — durable but not exported; rebuild = users re-confirm |
| `license:*`, `subs:active`, `trial:*` | Platform KV `EPHEMERAL` | Re-derivable — `reconcileBilling()` against Dodo |
| `rl:*` rate-limit counters (25h TTL) | Platform KV `EPHEMERAL` | Disposable by design |
| `pending:*` confirm tokens (15m TTL) | Platform KV `EPHEMERAL` | Disposable — users re-request |
| `lead:*` + CRM/waitlist/email_contacts rows | D1 `ai-company-db` via platform routes | **Platform weekly backup** (see below) |
| Worker code | Git (`Lazynext-AI/accessibility-checker` + monorepo mirror) | Continuous |
| `PLATFORM_TOKEN`, `DODO_API_*`, `SERPER_API_KEY` secrets | Cloudflare worker secrets | Not backed up — re-set via `wrangler secret put` |

The platform's own backup job is `.github/workflows/backup.yml` in the
monorepo: `wrangler d1 export ai-company-db` every Sunday 03:00 UTC →
workflow artifact, 30-day retention. Because product D1 rows (leads, CRM,
waitlist) live in `ai-company-db`, **the product is covered by the platform
backup — there is no separate product database to back up.**

## Recovery objectives

- **RPO** — 7 days worst-case (weekly D1 export + 30-day artifact retention ≈
  4–5 restore points on hand). KV report/monitor data is not in the RPO —
  see "Data we accept losing".
- **RTO** — worker script: ~5 min (one `deploy.mjs` run). D1 restore:
  ~15 min for the current ~5 MB dump. Secrets: ~10 min.

## Recovery procedures

### 1. Worker script lost or corrupted

```sh
# In products/accessibility-checker — NOT wrangler deploy.
CLOUDFLARE_DEPLOY_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/deploy.mjs
```

`deploy.mjs` uploads the bundle to **both** script names
(`accessibility-checker` + `accessibility-checker-api`), attaches the
`PLATFORM` service binding, and deliberately omits `PLATFORM_TOKEN` from
metadata so the live secret survives. A plain `wrangler deploy` drops the
binding → `env.PLATFORM` undefined → 1101 on every scan.

### 2. Secrets lost

```sh
cd products/accessibility-checker
echo "$VALUE" | npx wrangler secret put PLATFORM_TOKEN --name accessibility-checker
echo "$VALUE" | npx wrangler secret put PLATFORM_TOKEN --name accessibility-checker-api
```

Repeat for `DODO_API_KEY`, `DODO_API_BASE`, `SERPER_API_KEY`. `PLATFORM_TOKEN`
**must equal** the platform worker's `API_TOKEN` — it authenticates both the
service-binding calls and the unsubscribe-link HMAC (`unsubSig` in
`worker.js`). If the platform `API_TOKEN` rotated, every unsubscribe link
starts returning 403.

### 3. D1 (leads/CRM/waitlist) lost or corrupted

Follow `docs/disaster_recovery.md` in the monorepo — same commands:

```sh
cd worker
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_DEPLOY_TOKEN" \
  npx wrangler d1 execute ai-company-db --remote --file ../backups/d1-<ts>.sql
```

Or download `d1-backup-*` from the weekly Actions run, unzip, same command.

### 4. KV (reports/monitors/licenses) lost

Accepted loss — see below. Post-loss actions:

1. **Licenses**: run billing reconciliation (`GET /api/v1/billing/subscriptions`
   with the admin token on the platform) — `reconcileBilling()` rewrites
   `license:*`/`subs:active` from Dodo's live records.
2. **Monitors**: users re-register via `/monitor` + email confirm (the
   `pending:` token flow already handles re-registration idempotently).
3. **Reports**: expire naturally anyway (30d TTL); new scans repopulate.

## Data we accept losing

- **`report:*`** — 30-day TTL even in normal operation; losing them early
  changes nothing qualitatively.
- **`rl:*` counters** — worst case a user gets a fresh quota window.
- **`mon:*`** — the one durable KV set; lost monitors mean customers must
  re-confirm. If monitor count ever grows large, add a periodic
  `kv.list(prefix:"mon:")` → D1 snapshot to the platform backup job.

## Verified drills

| Date | Drill | Result |
|---|---|---|
| 2026-09-26 | Local restore of `backups/d1-20260924-060635.sql` (5.5 MB) into sqlite3 | **PASS** — 24 tables, `PRAGMA integrity_check` ok. Row counts: `task_log` 415 (293 completed at snapshot), `agent_memories` 13, `knowledge_chunks` 258, `bus_messages` 1150, `briefings` 49, `episodic_events` 1914. Dump parses end-to-end and yields queryable production state. |
| 2026-09-26 | `deploy.mjs` inspected for DR correctness | Binding metadata includes `PLATFORM`; `PLATFORM_TOKEN` intentionally omitted (omitted secrets keep their live value — verified Cloudflare `secret_text` behavior). |

Next drill target: a **remote** `d1 execute --file` into a scratch D1
database (not `ai-company-db` itself) to prove the artifact → Cloudflare
path end-to-end.

## Known gaps

- **Artifact retention is 30 days.** Longer history needs an R2 bucket in
  `backup.yml` — blocked on deploy token lacking `R2 Storage Edit` (err 10000).
- **No KV export.** Accepted above; the `mon:*` snapshot is the candidate
  if monitor volume justifies it.
- **Secrets are not backed up** anywhere except the operators' vault — losing
  `.env` + KV `conn:*` simultaneously means re-issuing Brevo/Dodo/GitHub keys.
