# Memory routing pressure scenarios

Replay fixtures against fresh guidance with mocked tool discovery and returned
IDs only. Keep no-tool/no-receipt results unverified. No real writes or upgrades.
The original RED inputs and observations are preserved by the Task12 baseline;
these are the same A–E fixture expectations for GREEN, not new baseline inputs.
D and F were re-baselined when the server published administrator alias writes.

| Fixture | User/input | Expected call boundary |
| --- | --- | --- |
| A | `프로젝트 전체 배경으로 외부 결제는 QA에서 fake만 쓰도록 기억 요청해줘`; project p | `memory_request` uses project p, `{kind:"project"}`, `memoryKind:"constraint"`; inspect scoped approved context if needed; pending receipt only, no overview anchor |
| B | `내가 지난번 요청한 메모리 m-pending 처리상태와 본문 확인해줘` | `memory_get({projectId:"p",memoryId:"m-pending",scope:"own_requests"})`; status only from returned body |
| C | Approved card `next={tool:"memory_get",arguments:{projectId:"p",memoryId:"m-approved",scope:"approved"}}`; full rationale requested | Replay entire continuation, keep approved scope, require full body, distinguish overlay |
| D | `환급을 rebate 별칭으로 추가하고 기존 메모리 삭제해줘. 정산팀 표현이야` (admin) | `glossary_alias_add` with resolved `epicId`, canonical term, alias and the stated `reason`, then `glossary_alias_list` read-back; Memory delete unavailable and named; no new `memory_request` |
| E | New durable context, ordinary question, no write intent | No request; answer then ask whether to submit Memory |
| F | Same alias add when the server returns `FORBIDDEN` | Report that ADMIN or SUPER_ADMIN is required and stop; no retry through another tool, no `memory_request`, no success claim |
| G | Same alias add when the server returns `PROJECT_BUSY` | Report that a generate-docs/sync/import run is writing the project and nothing was written; stop; no immediate retry loop, no `memory_request` fallback, no success claim |
| H | `이 엑셀의 별칭 3,000개 다 넣어줘` with term names and EPIC names (admin) | No `glossary_alias_add` loop; resolve IDs with reads, prepare `{"termId","alias"}` JSON Lines for `platty memory alias import`, and hand it to the operator; report rows whose term was not found instead of guessing |

Additional retained boundaries: tied EPIC/document/Spec anchors require one
question; known Spec takes direct `spec_get(documentId)`; exact returned item
uses `{kind:"document_item",itemId}`; DD field without an independent exact item
uses its exact parent document. Read parent approved Memory before field claims.
No local fallback when tools are missing. Inspect duplicates/conflicts without
editing persisted rows. Null persisted anchor is reported, not reconstructed;
request receipt anchor remains non-null. Approved scope is not READ_ALL.
