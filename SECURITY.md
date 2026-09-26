# Security policy

## Reporting a vulnerability

Email **security@lazynext.com** (or support@lazynext.com) with a description,
reproduction steps, and the affected endpoint. We acknowledge within 48 hours.

Please do not open public issues for vulnerabilities.

## Scope

- `accessibility-checker*.workers.dev` — the scan/report/monitor/checkout API
- `lazynext-ai.github.io/accessibility-checker` — the public UI
- The platform endpoints it calls (`ai-company-os.dry-hall-6a50.workers.dev`)

## Security posture

- **Payments**: all card data is handled by Dodo Payments (merchant of record)
  on hosted checkout pages — card numbers never touch our workers. Webhooks are
  signature-verified and replay-deduped (`whseen:` keys).
- **License actions**: `license:<email>` is mailbox-confirmed — cancel/monitor
  mutations require a one-time email confirmation link (`pending:<token>`,
  15-minute TTL) before executing.
- **Reports**: shareable report URLs render with all user-derived content
  HTML-escaped and `Content-Security-Policy: default-src 'none'` — scanned-page
  text cannot inject markup into report viewers.
- **Input bounds**: pasted HTML is capped at 512 KB; scan rate limits are
  enforced per IP/email via KV counters.
- **Rate limiting**: auth and mutation endpoints carry per-IP KV counters.

## Known limitations

- `GET /monitor` listing is keyed by the license email (read-only, low
  severity) — mailbox-confirmed like mutations if it ever exposes more data.
- Dodo webhooks can lag; billing state reconciles synchronously on cancel and
  via a daily reconcile sweep — delayed webhooks are idempotent.
