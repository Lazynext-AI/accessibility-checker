# Agent protocols — MCP + A2A wire formats

The product exposes the same scan pipeline over three surfaces: the REST API
(`/scan`), MCP (`/mcp`), and A2A (`/a2a`). All scan-capable calls share one
quota, one scanner, and one report store — switching protocols does not bypass
the free limit (3 URL scans/day/IP; HTML scans are unquota'd), and every scan
persists a report retrievable from any surface.

**REST contract:** `GET /openapi.json` is the OpenAPI 3.1 document for the
whole HTTP surface — generate clients from it, or hand it to any tool that
imports a spec.

## MCP — Model Context Protocol

**Endpoint:** `POST /mcp` · JSON-RPC 2.0 · spec `2025-03-26` (streamable-HTTP
subset: single POST → JSON response; no SSE stream, so `GET` → `405`).

### Methods

| Method | Params | Result |
|---|---|---|
| `initialize` | `{ protocolVersion, capabilities, clientInfo }` | `{ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name, version, title } }` |
| `ping` | — | `{}` |
| `tools/list` | — | `{ tools: Tool[] }` |
| `tools/call` | `{ name, arguments }` | `{ content: [{ type: "text", text }], structuredContent }` |
| notifications (any method, no `id`) | — | `202 Accepted`, empty body |

`structuredContent` mirrors the JSON-stringified `text` — consume whichever
your client prefers.

### Tools

| Tool | Required args | Optional args | Notes |
|---|---|---|---|
| `scan_url` | `url` | `site` (bool), `license` (email) | Rendered audit; counts against URL quota. `site: true` crawls same-origin pages (3 free / 10 Pro). |
| `scan_html` | `html` | — | Static-rules audit of pasted markup, max 512 KB; no quota. |
| `get_report` | `id` | — | Replays the persisted report; `id` is the slug in the report URL. |
| `list_rules` | — | — | Full `{ rule, criterion, level, path }` manifest. |

### Error envelope

JSON-RPC errors: `-32600` invalid request (HTTP 400) · `-32601` unknown method ·
`-32602` bad params / unknown tool. Scan-level failures come back as a
*successful* tool result whose `structuredContent` carries
`{ error, status, ... }` (e.g. `status: 402` on quota exhaustion) — check for
`error` in the payload, not just the RPC layer.

### Example

```jsonc
// → POST /mcp
{ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
  "params": { "name": "scan_html", "arguments": { "html": "<html>…</html>" } } }

// ← 200
{ "jsonrpc": "2.0", "id": 7, "result": {
    "content": [{ "type": "text", "text": "{ \"score\": 77, … }" }],
    "structuredContent": { "score": 77, "issues": [ … ], "report": "…/report/<id>" } } }
```

## A2A — Agent-to-Agent

**Agent card:** `GET /.well-known/agent.json` (protocolVersion `0.3.0`,
preferredTransport `JSONRPC`, no streaming/push).

**Endpoint:** `POST /a2a` · JSON-RPC 2.0 envelope.

### Methods

| Method | Params | Result |
|---|---|---|
| `message/send` | `{ message: { parts: [{ type: "text", text }] } }` | `{ task }` |
| `tasks/send` | same as `message/send` (alias) | `{ task }` |
| `tasks/get` | `{ id }` | `{ task }` |
| *(REST shortcut)* `GET /a2a/tasks/:id` | — | `{ task }` |

### Task shape

```jsonc
{
  "id": "<report-id>",                       // the persisted report id
  "status": { "state": "completed", "timestamp": "<iso8601>" },
  "artifacts": [{
    "name": "accessibility-report",
    "parts": [{ "type": "data", "data": { /* full scan result */ } }]
  }]
}
```

### Send semantics

`message/send` extracts scan input from the message text: the first
`https?://` token becomes a URL scan; an `<html>…</html>` (or any markup)
fragment becomes an HTML scan. No URL or markup → `-32602`. Scans complete
synchronously inside the request, so the returned task is always
`completed` on success — `tasks/get` exists to *replay* the task later (the
task id **is** the report id; reports expire ~30 days, after which
`tasks/get` → `-32000 task not found`).

### Error envelope

`-32600` invalid JSON-RPC (400) · `-32602` no scannable input ·
`-32000` scan failure or missing task.

## Widget

```html
<script src="https://checker.lazynext.com/widget.js"
        data-target="#slot" data-license="pro@example.com"></script>
```

Mounts a Shadow-DOM scan box into `data-target` (or a fresh `<div>` after the
script). The API origin is derived from the script `src`, so it works from
any host; `data-license` is forwarded for Pro quota. Results link to the
shareable report.
