# Business Document UCS Link Repair Design

## Goal

검색 CLI에서 `EPIC → UCL → UCS` 탐색이 가능하도록 UCL 항목과 UCS 문서 사이의 링크를 자동으로 생성한다.

## 관련 문서

`docs/superpowers/specs/2026-06-10-business-doc-graph-traversal-design.md`

## 문제

UCL 항목에서 UCS 문서로 가는 방향이 없다.

```
EPIC ──(scopeId)──→ UCL 문서   ✅ 이미 동작
UCL 항목  ──→  UCS 문서        ❌ 링크 없음
```

`docs related <UCL문서>` 를 호출하면 `itemDocumentLinks`에 UCS가 나와야 하는데 비어 있다.

### 재현 프로젝트

- Project id: `4ke9ejpeK1FximMuiiFLB`
- EPIC: `Campaign Exclusion Management` (`1bp3xui3ji7-BWv1cEcFh`)
- UCL 문서 id: `doc:yT1gSCz0WYyivBwLd7EuW`

```bash
node packages/cli/dist/main.js docs related \
  --project 4ke9ejpeK1FximMuiiFLB \
  --document doc:yT1gSCz0WYyivBwLd7EuW \
  --json
# itemDocumentLinks: []  ← UCS가 있어야 함
```

## 원인

`materializeBusinessDocumentGraph`는 UCL 항목 → UCS 문서 링크를 만드는 함수다.
그런데 `submit.ts`에서 UCS 문서가 저장될 때 이 함수가 **호출되지 않는다.**

```typescript
// submit.ts 현재 코드 (packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts)
if (input.document.documentType === 'data_dictionary') {
  materializeDocumentItemModelLinks(...)  // DD만 실행
}
// documentType === 'ucs' 일 때 → 아무것도 안 함  ← 구멍
```

`business-docs graph rebuild` CLI를 수동으로 실행하면 링크가 만들어지지만,
UCS 저장 시 자동으로 실행되지 않아서 링크가 빠져 있다.

## 생성되는 링크

`materializeBusinessDocumentGraph`가 만드는 것:

```
document_item_document_links 테이블
  fromItemId   = UCL 항목 id
  toDocumentId = UCS 문서 id
  linkType     = 'expands_use_case'
  createdBy    = 'business_graph_materializer_v1'
```

이 행이 있어야 `docs related <UCL>` 응답의 `itemDocumentLinks`에 UCS가 나온다.

## 수정 내용

### 1. `submit.ts` — UCS 저장 시 자동 호출

```typescript
// packages/core/src/pipeline_modules/build_business_docs_cli/submit.ts
if (input.document.documentType === 'data_dictionary') {
  materializeDocumentItemModelLinks(db, {
    projectId: input.context.task.projectId,
    documentId: savedDocumentId,
  })
}
if (input.document.documentType === 'ucs') {
  materializeBusinessDocumentGraph(db, {
    projectId: input.context.task.projectId,
    epicId: parseEpicIdFromScopeId(input.document.scopeId) ?? undefined,
  })
}
```

`epicId`는 UCS scopeId(`epic:<epicId>:use_case:...`)에서 파싱한다.
파싱 실패 시 `epicId` 없이 project 전체 범위로 실행한다.

### 2. `findMatchingUseCaseSpec` — 매칭 규칙 수정

현재 구현은 `item.title` 같은 자유 텍스트에도 포함 매칭(`includes`)을 적용해서
관련 없는 UCS에 잘못 연결될 수 있다.

포함 매칭은 `stableKey`에만 허용한다:

```typescript
// 현재 (잘못됨): itemKey가 title이어도 docKey.includes(itemKey)를 적용
// 수정: stableKey에서 온 itemKey에만 containment 허용
```

매칭 우선순위:
1. `stableKey` ↔ scopeId suffix 정확히 일치 (normalized)
2. `stableKey` ↔ title 정확히 일치 (normalized)
3. scopeId suffix가 `stableKey`를 포함하는 경우만 containment 허용

title, use_case_id 같은 자유 텍스트는 포함 매칭에 사용하지 않는다.

## 기존 경로 유지

`business-docs graph rebuild` CLI는 그대로 유지한다.
기존 프로젝트 backfill 용도로 사용할 수 있다.

## 스키마 변경 없음

`document_item_document_links` 테이블과 `expands_use_case` linkType은 이미 존재한다.
테이블 추가나 컬럼 추가 없이 구현 가능하다.

## 테스트

### Core 테스트 (`materialize_business_graph.test.ts`)

- UCL 항목 `stableKey`가 UCS `scopeId` suffix와 일치하면 `expands_use_case` 링크 생성
- `validity: 'stale'` UCS 문서는 링크 대상에서 제외
- 기존 `derives_from` 링크(API spec 등)는 보존됨
- 멱등성: 두 번 실행해도 같은 결과
- title처럼 자유 텍스트 포함 매칭으로 잘못된 UCS에 연결되지 않음

### CLI 테스트

- `docs related <UCL문서>` 응답의 `itemDocumentLinks`에 `linkType = expands_use_case` 포함
- UCS 문서 저장 후 별도 `graph rebuild` 없이도 링크가 생성됨

## 검증

```bash
# UCS 저장 후 자동 링크 확인
node packages/cli/dist/main.js docs related \
  --project 4ke9ejpeK1FximMuiiFLB \
  --document doc:yT1gSCz0WYyivBwLd7EuW \
  --json
```

기대 결과:
- `itemDocumentLinks` 4개 이상
- 각 항목 `linkType = expands_use_case`, `target.type = ucs`

## Non-Goals

- EPIC → UCS 직접 링크 (`epicDocumentLinks`) 추가 안 함
- semantic search 미구현
- glossary, BR, DD, design 문서 스키마 변경 없음
- UCS 문서 재생성 없음
