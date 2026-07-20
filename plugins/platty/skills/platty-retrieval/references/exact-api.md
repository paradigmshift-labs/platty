# Exact API Retrieval Guide

Use for exact endpoint, response shape, request params, side effects, permissions, or "what does this API return/do?" questions.

## First Hops

1. Grep `catalog/apis.md` for the exact method/path or nearest path fragment.
2. Keep the row's `epicIds`; read `catalog/epics.md` and the matching epic `overview.md` or directly connected BR/design item only for semantic/product context.
3. Read only the matching `specs/api/<file>.md`.
4. Use the spec's source file/handler evidence or `serviceMapNodes` / catalog `traceId` to inspect source when behavior, params, response shape, writes, emits, permissions, or absence matters.
5. Run graph trace only if the question asks callers, DB, external calls, screens, or side effects.

## Required Coverage

- Exact method and path.
- Controller/handler/usecase source anchor.
- Request params/body/query if asked or visible.
- Response payload shape or explicit "not confirmed".
- Side effects: DB read/write, event, external service, notification, cache, queue.
- Permissions/guards if asked or relevant.
- Epic/product context from the matched API row's `epicIds`.
- Boundary: spec/source mismatch, missing response envelope, graph omissions.

## Stop Rule

Do not spend broad search time in epics for an exact API, but do keep the matched row's EPIC context. Do not answer from API catalog title alone. If the spec and source disagree, source wins and the mismatch must be stated.
