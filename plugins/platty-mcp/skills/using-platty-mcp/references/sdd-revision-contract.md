# MCP SDD revision 계약

`prd.md`, `user_stories.md`, `system_design.md`, `tasks.md`를 생성·승인·실행하는 모든
MCP SDD 스킬이 공유하는 기계 검증 계약이다. 독자용 본문에는 이 계산 설명을 넣지 않는다.

새 문서의 파일명은 위 네 이름만 사용한다. 비정규 legacy 파일명은 기존 문서를 읽기
위한 alias일 뿐이며 신규 출력 이름으로 사용하지 않는다.

## 정규화

- 모든 입력은 UTF-8, LF 줄바꿈, 파일 끝 단일 newline으로 정규화한다.
- canonical JSON은 object key를 UTF-8 bytewise lexical order로 재귀 정렬하고 공백 없이
  직렬화한다. set 성격의 배열만 명시적으로 정렬하며 문서 순서 배열은 유지한다.
- 모든 digest는 `sha256:<lowercase hex>` 형식이다.
- 필수 경계 heading이 없거나 중복되면 계산하지 않고 해당 문서를 `NEEDS_WORK` 또는
  `stale`로 둔다.

## Revision과 fingerprint

- `requestRevision`: 정확히
  `{"body":<제목부터 §9 delimiter 직전까지>,"frontmatter":{"id":...,"outputLanguage":...,"projectId":...,"type":...}}`
  envelope의 SHA-256이다. mutable status/approval 값과 §9는 제외하며 PRD §9의
  `productSegmentRevision`과 같은 값이다.
- `storiesRevision`: 정확히
  `{"body":<제목 이하 전체>,"frontmatter":{"derivedFrom":...,"id":...,"outputLanguage":...,"projectId":...,"type":...}}`
  envelope의 SHA-256이다. mutable status/approval 값은 제외한다.
- `productInputFingerprint`: `{requestRevision, requestStatus, storiesRevision,
  storiesStatus}` canonical JSON의 SHA-256이다.
- `evidenceFingerprint`: PRD §9에서 읽은 정확한 envelope
  `{"contextStatus":...,"crossEpicTraversalStatus":{"currentDepth":...,"maxDepth":...,"status":...,"truncationReasons":[...]},"evidenceIds":[...],"impactCoverageLimits":[...],"impactRevision":...,"impactStatus":...,"productSegmentRevision":...,"sourceCommits":[{"repoId":...,"sourceCommit":...}],"sourceParity":...,"storiesRevision":...}`의
  SHA-256이다. 모든 배열과 `sourceCommits`는 정렬하고 누락 scalar는 `""`, 배열은 `[]`,
  object는 `{}`로 쓴다.
- `designRevision`: 정확히
  `{"body":<설계 제목 이하 전체>,"frontmatter":{"derivedFrom":...,"evidenceFingerprint":...,"id":...,"outputLanguage":...,"productInputFingerprint":...,"projectId":...,"requestRevision":...,"requestStatus":...,"review":...,"storiesRevision":...,"storiesStatus":...,"type":...}}`
  envelope의 SHA-256이다. `status`, `designRevision`, `approvedRevision`, `approvedAt`,
  `approvedBy`는 제외하므로 승인 자체는 설계 revision을 바꾸지 않는다.

## 고정 벡터

canonical JSON
`{"requestRevision":"sha256:r","requestStatus":"approved","storiesRevision":"sha256:s","storiesStatus":"approved"}`의
SHA-256은 `sha256:efd58ae536c6de4f820df987d2ada2a0ae1a145be322dc4026e1cd407fc51f22`다.

- request envelope
  `{"body":"# T\n","frontmatter":{"id":"SPEC-x","outputLanguage":"ko","projectId":"P","type":"sdd-request"}}`
  → `sha256:5c7a3dbc0905e86c0ec62b47908c9767379327726458774f4c4424ec9b7e16c8`
- stories envelope
  `{"body":"# 사용자 스토리 — T\n","frontmatter":{"derivedFrom":"prd.md","id":"SPEC-x","outputLanguage":"ko","projectId":"P","type":"sdd-stories"}}`
  → `sha256:4815b8133747b23d2d7ae4d944a37558a9698e5efe0e6ba22a27e14ae1d32334`
