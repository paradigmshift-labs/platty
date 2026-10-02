# MCP Markdown projection

Use this reference for original-file, Markdown or artifact requests.
`sot_render(projectId,documentId,itemLimit?,itemCursor?)` renders the authorized
canonical PostgreSQL view as Markdown with `contentOrigin:"database_rendered"`
and item pagination. Resolve an unknown document through typed maps; reuse a
known documentId. Follow itemCursor when complete rendering requires more items.

It does not accept filesystem paths or return a stored original file/download
URL. Tell an original-file requester that this is a DB-rendered projection and
that original-file/download surfaces are unavailable. Never invent a URL or
read host-local files. No export, sync, generation or cache refresh from MCP.
Rendered text shares structured-read lineage but exact policy, Spec and source
claims still require their selected evidence tier. Type mismatch, stale content,
regeneration-required, truncation or missing tool remain explicit limits.
