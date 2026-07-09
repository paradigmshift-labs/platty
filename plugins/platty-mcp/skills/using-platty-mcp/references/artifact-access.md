# MCP Artifact Access

Use this reference when the user asks for original stored SOT file content or a
stored artifact path. Artifact access is read-only transport, not retrieval
proof by itself. Download and bundle metadata tools are not exposed.

## Storage Roots

| Source | Use |
| --- | --- |
| `PLATTY_CONTEXT_DB_PATH` | Structured DB evidence: projects, epics, documents, items, specs, graph, and code index |
| `PLATTY_CONTEXT_SOT_ROOT` | Production SOT artifact root, either `<platty-home>/sot` or one project SOT directory |
| Default Platty home | If no SOT root is configured, try `<platty-home>/sot/<projectId>` |
| `PLATTY_CONTEXT_FIXTURE_SOT_ROOT` | Test/demo fixtures only |

The SOT export default is `<platty-home>/sot/<projectId>`, commonly
`~/.platty/sot/<projectId>`.

## Artifact Tier

Artifact tools are separate from the retrieval ladder:

- `sot_file_get`

Use `sot_file_get` only when the user asks to read an original stored SOT file
by project-relative path, such as `catalog/epics.md` or `specs/api/cart.md`.

Use it only for stored file content access. Do not treat a file path or file
content as proof of policy, API shape, or implementation behavior. Read exact
DB/spec/code evidence before asserting facts.

If the user asks to download a bundle, download a spec, or get a download URL,
report that download surfaces are not exposed by this MCP profile. Do not
invent a URL and do not fall back to local files or local CLI.

## Missing Artifacts

If the DB is ready but the SOT artifact root is missing, report:

```text
Structured MCP evidence is available, but stored SOT file content access is not
configured or the requested file is unavailable. I will not run export, sync, or
generation from MCP.
```

Never run local CLI, export, sync, generation, or cache refresh from the MCP
retrieval path.

## Path Rules

File paths passed to `sot_file_get` must be project-relative SOT paths.
Examples:

- `overview.md`
- `catalog/epics.md`
- `epics/<epic-id>/overview.md`
- `specs/api/<name>.md`

Never pass absolute paths or `..` segments. If a path is rejected or missing,
report the artifact access gap and do not fall back to local file reads.
