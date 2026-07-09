# Platty MCP Agent Plugin

`platty-mcp` is the read-only Platty MCP plugin for Codex and Claude Code. It
teaches agents how to use an already configured Platty MCP context server, how
to register an existing MCP URL from the client side, and how to answer
project questions through MCP evidence.

## Boundary

This plugin does not perform Platty lifecycle or operator setup. It does not
configure, start, run, sync, mutate, cache, delete, export, or otherwise manage
a Platty MCP server. It intentionally does not ship `.mcp.json`, and its plugin
manifests do not include `mcpServers`.

Use this plugin when your runtime already exposes Platty MCP tools for project
context, glossary terms, epics, business documents, source-near specs, graph or
code evidence, stored SOT artifacts, and context status, or when you need to
register an existing `/api/mcp` URL in the client.

It owns client-side MCP URL registration through
`platty-mcp:platty-mcp-client-setup`. Use that skill to register a remote MCP
endpoint; do not use it for Platty operator setup or any server-side lifecycle
work.

Do not use this plugin for analysis, sync, document generation, local SOT file
reads from the client, local Platty CLI commands, project mutation, cache
refresh, deletion, export execution, memory writes, or any other non-retrieval
workflow. Stored artifact downloads must go through configured MCP tools. Use
the full `platty` plugin for operator workflows.

## Included Skills

- `platty-mcp:using-platty-mcp`
- `platty-mcp:platty-mcp-client-setup`
- `platty-mcp:platty-mcp-retrieval`
