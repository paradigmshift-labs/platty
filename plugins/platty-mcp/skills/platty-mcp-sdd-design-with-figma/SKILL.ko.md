---
name: platty-mcp-sdd-design-with-figma
description: 승인된 제품 문서와 Figma URL, 현재 세션의 Figma 근거 또는 제품 문서 옆에서 발견한 검증된 figma_handoff.json을 바탕으로 사용자가 별도로 기술 설계나 시스템 설계를 요청할 때 사용한다.
---

# Platty MCP Figma 기반 SDD 설계

**선행 조건:** 먼저 `using-platty-mcp`를 읽는다. 이 단계는 사용자가 시스템 설계 또는
기술 설계를 별도로 요청한 뒤에만 시작한다. 이전 PRD 요청은 이 단계를 승인하지 않는다.
선택된 승인 SDD pair를 읽고, 제공된 Figma URL, 현재 세션 evidence handoff 또는 검증된
`figma_handoff.json`에서 Figma 대상을 해석한다. 정렬 전에
`platty-mcp-figma-design-sync`를 통해 검증된 bundle을 내부적으로 생성, 재사용 또는 갱신한다.

이 스킬은 얇은 semantic alignment gate다. 승인된 `prd.md`, 승인된 `user_stories.md`, 현재
Figma 근거, 현재 Impact Dossier를 비교해 하나의 `FigmaDesignAlignmentPacket`을 만들고,
gate가 허용할 때만 기술 설계를 `platty-mcp-sdd-design`에 위임한다.

사용자가 읽는 모든 요약은 한국어로 작성한다. source identifier, Figma node ID, 경로,
상태, revision, 인용 문구는 원문 그대로 보존한다.

## 소유권 경계

- `platty-mcp-figma-design-sync`: revision이 관리되는 Figma evidence bundle 소유
- `platty-mcp-impact-analysis`: impact evidence와 PRD §9 소유
- `platty-mcp-sdd-spec`: canonical product revision과 승인 소유
- `platty-mcp-sdd-design`: canonical `system_design.md`, 정확한 설계 승인 이후의 canonical
  `tasks.md` 소유
- 이 스킬: alignment disposition과 handoff packet만 소유

`prd.md`와 `user_stories.md`를 작성, 변경, 편집 또는 재작성하지 않는다. 모든 live run의
전후에 입력 hash를 기록한다. Figma 편집, 로컬 Platty CLI 실행, generated SOT 변경,
memory 쓰기도 금지한다.

packet 경로, reportId, sourceRevision, integrity index, report 디렉터리 위치를 사용자에게
묻지 않는다. Figma URL은 받을 수 있다. 같은 세션에서는 현재 evidence handoff의 정확한
`fileKey`, `nodeId`, `reportId`, `sourceRevision`을 재사용한다. 새 세션에서는 선택한 SPEC
디렉터리의 검증된 `figma_handoff.json`을 먼저 사용해 canonical URL과 source identity로
대상을 자동 복원한다. handoff와 현재 세션 근거가 모두 없을 때만 node별 Figma URL을 묻는다.

## 허용되는 pair 형태

- `CONNECTED`: 같은 Figma evidence lineage로 생성된 pair
- `INDEPENDENT`: 제품 pair와 Figma가 서로 독립적으로 작성된 경우

`INDEPENDENT`도 일급 입력이다. PRD가 같은 Figma에서 생성됐거나 lineage가 공유돼야 한다고
요구하지 않는다. 대신 승인된 사용자 결과, 직접적인 디자인 근거, 현재 시스템 근거의 의미
정렬을 요구한다.

## 입력 게이트

1. `../using-platty-mcp/scripts/sdd-artifacts.mjs`로 저장된 pair를 파싱한다.
2. id/project가 일치하는 승인된 `prd.md`와 승인된 `user_stories.md`를 요구한다. 기존 helper로
   `requestRevision`, `storiesRevision`, `productInputFingerprint`를 계산한다.
3. 자동 sidecar 발견으로 진입했다면
   `../using-platty-mcp/scripts/figma-handoff.mjs`의 `loadOptionalFigmaHandoff`를 정확한 project,
   spec, request revision, stories revision과 함께 호출한다. `canonicalUrl`과 source identity를
   routing input으로 사용한다. 손상되거나 유효하지 않거나, project/spec이 다르거나, stale인
   sidecar는 `BLOCKED`다. 대체 URL을 요청하거나 일반 non-Figma 설계로 조용히 바꾸지 말고
   중단한다. sidecar가 없으면 명시적 URL 또는 현재 세션 handoff를 사용한다. 둘 다 없으면
   node별 Figma URL만 요청하고 중단한다.
4. Figma 근거를 내부적으로 해석한다.
   - packet이 현재 상태면 identity, sourceRevision, integrity, coverage, drift가 정확히
     통과할 때 재사용한다.
   - 근거가 없거나 stale이면 `platty-mcp-figma-design-sync`를 호출하고 갱신된 bundle을
     검증한 뒤 계속한다.
   - 갱신으로 gap을 닫지 못하면 `STALE` 또는 `BLOCKED`로 중단한다.
   fileKey/nodeId 일치와 현재 sourceRevision을 요구한다.
5. PRD §9를 읽고 모든 approval-critical 경로에 현재 Impact Dossier를 요구한다. stale 또는
   필수 영역이 partial이면 기존 impact owner로 돌리며 여기서 §9를 고치지 않는다.
6. 두 제품 입력을 hash하고 packet에 보존한다.

승인되지 않은 입력은 `BLOCKED`다. 사용자가 명시적으로 negative-test용 draft alignment
report를 요청할 수는 있지만 그 결과로 canonical design을 작성하지 않는다.

## 필수 워크플로

1. 현재 사용자 메시지가 시스템 설계 또는 기술 설계를 별도로 명시해 요청했는지 확인한다.
   그렇지 않으면 제품 단계 이후에서 중단한다.
2. `CONNECTED` 또는 `INDEPENDENT`를 선택한다. lineage는 근거를 대체하지 않는다.
3. 모든 Figma state, annotation, interaction, missing state, 제품 요구사항에
   `references/alignment-gate.md`를 정확히 한 번 적용한다.
4. reference의 우선순위에 따라 `MATCHED`, `DESIGN_DETAIL`, `FIGMA_GAP`,
   `PRODUCT_CONFLICT`, `STALE`, `BLOCKED`를 사용한다.
5. `Figma node -> R/AC -> US/scenario -> design decision -> task` trace row를 만든다.
   위임 전에는 design-decision과 task cell이 pending일 수 있다.
6. `PRODUCT_CONFLICT` row가 하나라도 있으면 `SpecRevisionFromFigmaConflictPacket`을 만들고
   `platty-mcp-sdd-spec`으로 보낸 뒤 중단한다. `system_design.md`나 `tasks.md`를 생성, 작성,
   덮어쓰지 않는다.
7. `FIGMA_GAP`이면 승인된 제품 문서가 이미 visible state를 정의하는지 판단한다. 정의했다면
   design evidence-resolution item으로 보존하고, 아니라면 누락된 제품 결과를 spec revision으로
   보낸다.
8. layout, token, component, spacing, color, visual hierarchy 등 제품 의미를 보존하는 차이는
   `DESIGN_DETAIL`로 둔다. 제품 충돌이 아니다.
9. blocking row가 모두 해결되면 packet, 정확한 product identity, Figma evidence reference,
   Impact Dossier를 `platty-mcp-sdd-design`에 전달한다. product-conflict scan이 끝난 뒤에는
   non-conflict source detail을 더 수집하느라 위임을 늦추지 않는다. canonical owner의
   Design Draft Persistence Gate가 3분 또는 12-call 경계 안에 실행돼야 하며 미해결 alignment와
   source detail은 `ER-*` row로 표시한다.
10. owning design skill이 `system_design.md`를 쓰고 다시 읽는다. 정확한 `designRevision`이
    명시적으로 승인되기 전에는 `tasks.md`를 만들지 않는다.
11. canonical `system_design.md`에 정확한 Figma evidence identity(`canonicalUrl`, `fileKey`,
    `nodeId`, `reportId`, `sourceRevision`)와 각 Figma-sensitive design decision을 뒷받침하는
    alignment row를 보존한다. stable `FIGMA-SURFACE-*` ID 기반의 완전한 registry 하나를
    소유해야 한다. 각 row에는 canonical URL, surface에 쓰인 모든 정확한 Figma node,
    예상 sourceRevision, 필수 live screenshot 및 제한된 design-context 조회, drift/failure
    action이 포함된다. 이것이 구현 시점 Figma MCP preflight 계약이다.
12. 정확한 설계 승인 뒤 `tasks.md`의 모든 Figma-sensitive UI task가 `FIGMA-SURFACE-*` ID,
    R/AC, US/scenario, design-decision link를 참조해야 한다. module 실행 계획 전에 `tasks.md`
    상단 근처에 완전한 registry를 한 번 투영해 새 세션 구현자가 개별 task를 훑지 않고도
    canonicalUrl, 정확한 node, 예상 sourceRevision을 복원하게 한다. 이 상단 registry가 유일한
    실행 preflight 및 receipt 위치다. 코드 편집 전에 참조된 모든 node의 현재 screenshot과
    제한된 design context를 다시 읽고 갱신 sourceRevision을 예상값과 비교한다. surface identity를
    screenshot 설명이나 packet 경로로 대체할 수 없다.
13. 위임 후 제품 입력을 다시 읽어 hash를 비교한다. 변경이 있으면 run은 무효다.

## Canonical 투영 계약

`system_design.md`는 `canonicalUrl`, `fileKey`, 모든 정확한 `nodeId`, `reportId`,
`sourceRevision`, live-read 요구사항, drift action을 포함한 완전한 `FIGMA-SURFACE-*`
registry와 기술 결정이 소비하는 검토 가능한 alignment row를 투영해야 한다. `tasks.md`는 module
실행 계획 전에 상단 근처에 registry를 한 번 투영한다. 모든 UI 또는 interaction task는 적용되는
surface ID를 참조하고 R/AC, scenario, design-decision link를 보존한다. 같은 변경이 직접 제약하는
경우가 아니라면 non-visual backend task에는 product/design link만 유지한다.

preflight는 알림이 아니라 실행 gate다. 인증 또는 Figma 조회 실패, missing node, identity 불일치,
screenshot이나 design context 사용 불가, source drift가 있으면 코드 편집을 중단하고 차단한다.
`platty-mcp-figma-design-sync`로 근거를 갱신하고 alignment를 다시 실행해 새 design revision을
만든 뒤 설계 승인을 다시 받아야 한다. 변경된 Figma를 수용하려고 `tasks.md`만 고치거나 stale
capture로 구현하지 않는다.

필수 chain은 다음과 같다.

```text
Figma node -> R/AC -> US/scenario -> design decision -> task
```

`system_design.md`의 Figma identity 또는 완전한 surface registry 누락, `tasks.md` 상단
registry/preflight 누락, 유효한 surface reference가 없는 Figma-sensitive task는
`NEEDS_WORK`이며 implementation-ready로 선언할 수 없다.

## FigmaDesignAlignmentPacket

```text
FigmaDesignAlignmentPacket
- pairMode: CONNECTED | INDEPENDENT
- projectId
- productInput
  - prdPath
  - storiesPath
  - requestRevision
  - storiesRevision
  - productInputFingerprint
  - approvalStatus
- figmaEvidence
  - handoffOrigin: explicit-url | current-session | figma_handoff.json
  - packetPath
  - canonicalUrl
  - reportId
  - sourceRevision
  - fileKey
  - nodeId
  - integrityStatus
  - coverageStatus
- impactDossier
  - impactRevision
  - impactStatus
  - sourceParity
  - blockingCoverageLimits
- alignmentRows
  - alignmentId
  - figmaNodeIds
  - productIds
  - storyScenarioIds
  - disposition
  - evidenceClass
  - rationale
  - nextOwner
- traceRows: Figma node -> R/AC -> US/scenario -> design decision -> task
- specRevisionPacket
- designEvidenceResolutionItems
- inputHashes
- delegationTarget: platty-mcp-sdd-design
```

모든 direct semantic candidate와 승인된 제품 요구사항에는 disposition이 하나씩 있어야 한다.
identity 누락, 중복 disposition, inferred product promise, owner 없는 conflict는 `BLOCKED`다.

## 중단 조건

다음 상황에서는 중단한다.

- 선택한 제품 pair가 승인되지 않았다.
- 기존 `figma_handoff.json`이 손상/무효, project/spec 불일치 또는 stale이다.
- sidecar, 현재 세션 근거, node별 Figma URL이 모두 없다.
- Figma 근거를 current complete coverage로 갱신할 수 없다.
- 제품 충돌로 spec revision이 필요하다.
- canonical design owner가 alignment packet을 거부한다.

실패한 Figma route를 일반 기술 설계로 강등하지 않는다.

## SpecRevisionFromFigmaConflictPacket

product ID, story/scenario ID, direct Figma node와 문구, 현재 승인 의미, 충돌 의미, evidence
boundary, 사용자에게 보이는 trade-off, 권장 product review를 기록한다. 이 packet은 편집을
승인하지 않는다. spec owner가 두 제품 파일을 수정하고 승인을 초기화하며 impact를 갱신한 뒤
새 정확한 revision을 반환해야 설계를 재개할 수 있다.

## 완료 게이트

입력과 근거가 현재 상태이고, 모든 row에 하나의 disposition과 owner가 있으며, 제품 충돌이
없고, 제품 hash가 바뀌지 않았으며, canonical design과 tasks가 필수 Figma trace를 보존하고,
기존 design owner가 정확한 packet을 수락할 때 alignment가 완료된다. 기술 설계 완료와 task
readiness의 소유권은 계속 `platty-mcp-sdd-design`에 있다.

비교 전에 `references/alignment-gate.md`를 읽는다. 이 스킬을 수정하거나 평가할 때는
`references/pressure-scenarios.md`를 읽는다.
