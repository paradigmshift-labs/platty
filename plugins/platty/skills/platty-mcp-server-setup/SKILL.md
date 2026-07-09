---
name: platty-mcp-server-setup
description: Use when configuring, starting, validating, or troubleshooting the Platty context backend that exposes a read-only MCP endpoint.
---

# Platty MCP Server Setup

Use this skill for operator-side setup of the Platty context backend that exposes
read-only MCP JSON-RPC over direct HTTP at `/api/mcp`.

## Boundary

This belongs to the full `platty` operator plugin because it touches context DB
location, process execution, host/port selection, LAN/remote exposure, and
server-side validation.

Do not introduce a stdio proxy, local bridge, helper process, bearer token,
OAuth, SSO, RBAC, project mutation, analysis, sync, generation, memory writes, or
local CLI fallback. SOT artifact access is read-only and may point at an existing
export; it must not run export/sync/generation. `GET /api/mcp` may return 405
while SSE streaming is not enabled; validate with POST JSON-RPC.

## Profiles

| Profile | Bind | Client URL | Intended use |
| --- | --- | --- | --- |
| Local | `HOST=127.0.0.1` | `http://127.0.0.1:3027/api/mcp` | Same machine development and private use |
| LAN | `HOST=0.0.0.0` | `http://<host-ip>:3027/api/mcp` | Same trusted network |
| Remote | `HOST=0.0.0.0` behind HTTPS proxy | `https://<context-backend-domain>/api/mcp` | Controlled remote deployment |

`HOST=127.0.0.1` is the safe default. `HOST=0.0.0.0` is only a bind address;
never share literal `0.0.0.0` as the client URL.

## Required Environment

```bash
HOST=127.0.0.1
PORT=3027
PLATTY_CONTEXT_DB_PATH=<path-to-platty-db>
PLATTY_CONTEXT_SOT_ROOT=<optional-platty-home-sot-root-or-project-sot-root>
CONTEXT_BACKEND_CORS_ORIGIN=<optional-browser-origin-allowlist>
PLATTY_CONTEXT_REQUEST_TIMEOUT_MS=0
PLATTY_CONTEXT_HEADERS_TIMEOUT_MS=0
PLATTY_CONTEXT_KEEP_ALIVE_TIMEOUT_MS=0
```

`CONTEXT_BACKEND_CORS_ORIGIN` is for browser origins. It is not server-to-server
MCP authentication.

`PLATTY_CONTEXT_DB_PATH` enables structured retrieval. `PLATTY_CONTEXT_SOT_ROOT`
enables read-only artifact access to stored SOT files. If omitted, the server may
try the Platty home default `<platty-home>/sot/<projectId>`. Use
`PLATTY_CONTEXT_FIXTURE_SOT_ROOT` only for fixture/demo tests.

## Start

1. Locate or build the context backend.
2. Choose local, LAN, or remote profile.
3. Set the required environment variables.
4. Start context-backend.
5. Use the startup log to confirm the MCP URL shape.

Inside the private Platty source checkout, a maintainer can run:

```bash
cd apps/context-backend
npm run build
HOST=127.0.0.1 PORT=3027 PLATTY_CONTEXT_DB_PATH=<path-to-platty-db> PLATTY_CONTEXT_SOT_ROOT=<path-to-sot-root> npm start
```

For LAN or remote deployments, use `HOST=0.0.0.0` only after the network
boundary is intentional.

## Validate

Set the exact URL clients will use:

```bash
export PLATTY_MCP_URL=http://127.0.0.1:3027/api/mcp
```

Initialize:

```bash
curl -sS -X POST "$PLATTY_MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

List tools:

```bash
curl -sS -X POST "$PLATTY_MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Call project list:

```bash
curl -sS -X POST "$PLATTY_MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"project_list","arguments":{}}}'
```

After choosing a project, call context status:

```bash
curl -sS -X POST "$PLATTY_MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"context_status","arguments":{"projectId":"<project-id>"}}}'
```

If stored SOT artifacts should be available, verify the artifact tier:

```bash
curl -sS -X POST "$PLATTY_MCP_URL" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"sot_file_get","arguments":{"projectId":"<project-id>","path":"overview.md"}}}'
```

## Remote Security

Remote access is supported only behind deployment-layer controls such as HTTPS
reverse proxy, firewall allowlist, VPN, private network, managed tunnel, or
infrastructure-level authentication. Do not recommend a public unauthenticated
internet endpoint.

## Completion

Complete when the server returns `initialize`, `tools/list`, and at least one
project-aware read-only tool call from the same `/api/mcp` URL that clients will
register.
