---
name: platty-mcp-sdd-spec-from-figma
description: 기존 제품 문서 유무와 관계없이 Figma URL과 함께 제품 기획, 기획서, 기능 개요, 요구사항, PRD, 사용자 스토리 또는 기능 기획의 정리, 초안 작성, 생성, 보강을 요청할 때 사용한다.
---

# Platty MCP Figma 기반 SDD 기획

**선행 조건:** 먼저 `using-platty-mcp`를 읽는다. 사용자가 제공한 Figma URL을 받아
`platty-mcp-figma-design-sync`를 통해 검증된 `FigmaEvidencePacket`을 내부적으로 생성,
재사용 또는 갱신한다. 이 스킬은 근거를 조율하지만 canonical 제품 파일을 직접 소유하지 않는다.

기존 PRD 또는 제품 pair가 있으면 AUGMENT다. 기존 PRD, `prd.md`, 제품 pair가 제공되면
AUGMENT를 자동 선택한다. 제품 문서가 없으면 CREATE를 자동 선택한다. 사용자에게 CREATE,
AUGMENT 또는 mode를 고르게 하지 않는다. 별도 product brief나 raw idea는 선택 사항이다.
Figma만으로 draft 제품 pair를 만들 수 있지만 Figma가 직접 증명하지 않는 제품 정책을 승인할
수는 없다. 두 mode 모두 `ProductIntentFromFigmaPacket`을 만들고 canonical 쓰기는
`platty-mcp-sdd-spec`에 위임한다.

`Figma 기반으로 기획서를 정리해줘`, `기획서를 작성해줘`, `기획서를 생성해줘`,
`기획서를 보강해줘` 같은 자연어 요청은 PRD, user story, SDD 또는 파일명을 말하지 않아도
canonical 제품 작성 요청으로 취급한다. 이 route는 일반 Figma 요약보다 우선한다. 채팅에만
기획 초안을 출력하면 완료가 아니다. 현재 서비스 조사는 `platty-mcp-retrieval`을 사용해야 하며
Figma 근거가 이를 대체하지 않는다.

사용자가 읽는 모든 요약은 한국어로 작성한다. code identifier, Figma node ID, 경로, 상태값,
인용된 원문 문구는 그대로 보존한다.

## 소유권 경계

- `platty-mcp-figma-design-sync`: revision이 관리되는 Figma evidence bundle 소유
- `platty-mcp-retrieval`: source-confirmable `FACT` 조사 소유
- `platty-mcp-impact-analysis`: PRD §9와 evidence convergence 소유
- `platty-mcp-sdd-spec`: canonical `prd.md`, canonical `user_stories.md`, revision algorithm,
  template, Self Review, 로컬 저장, 제품 승인 gate 소유
- 이 스킬: Figma-to-product mapping, delegation packet, canonical pair 옆의 선택적
  `figma_handoff.json` sidecar 소유

이 스킬이 canonical `prd.md` 또는 `user_stories.md`를 직접 쓰면 안 되며 owning skill의
template, 승인 규칙, revision helper를 복제하지 않는다.

로컬 Platty CLI 실행, Figma 편집, generated SOT 변경, memory 쓰기, 시스템 설계 또는 tasks
작성은 금지한다. 이 orchestrator가 추가로 소유하는 유일한 로컬 쓰기는 선택한 SPEC 디렉터리의
검증된 `figma_handoff.json`이다.

## 2단계 경계

이 스킬은 2단계 SDD 흐름의 제품 단계 1이다. `prd.md`, `user_stories.md`, 선택적 Figma
lineage sidecar와 review 및 제품 승인 경계까지 완료한다. 사용자가 시스템 설계 또는 기술 설계를
별도로 요청해야 단계 2가 시작된다.

PRD 요청에서 `platty-mcp-sdd-design-with-figma`를 호출, routing 또는 시작하지 않는다.
`system_design.md`와 `tasks.md`를 생성하거나 쓰지 않는다. 제품 pair가 준비되면 상태를 보고하고
사용자가 별도의 기술 설계 요청을 할 수 있다고 설명하되 자동으로 계속하지 않는다.

## Figma 근거 해석

제품 mapping 전에 다음을 수행한다.

0. runtime tool listing/search를 통한 **Deferred Figma Capability Discovery**를
   반드시 수행한다. `get_metadata`, `get_screenshot`, `get_design_context`,
   `use_figma` 같은 configured read surface를 명시적으로 검색한다. 처음 보이는
   active tool 목록에 없다는 사실은 absence/unavailable의 근거가 아니다. 이
   search/discovery와 발견된 read invocation을 최소 한 번 수행하기 전에는
   `BLOCKED` 또는 capability gap을 보고하지 않는다. 넓은 design-context read가
   실패하면 node별 metadata, screenshot, read-only execution으로 제한해 복구한다.
1. 제공된 Figma URL에서 정확한 `fileKey`와 `nodeId`를 파싱한다.
2. 정확한 identity의 report를 내부 조회한다. 현재 검증된 report가 있으면 다시 만들지 않고
   현재 packet을 재사용한다.
3. 근거가 missing, stale, corrupt, identity mismatch 또는 incomplete이면
   `platty-mcp-figma-design-sync`를 호출하고 갱신된 bundle을 검증한다.
4. owning sync validator를 `--bundle`로 실행해 `ok: true`를 요구한다.
5. `reportId`, `sourceRevision`, 정확한 `fileKey`, `nodeId`를 bind한다.
6. `status: complete`, `coverage.status: complete`, 안정적인 drift, 정확한 semantic-candidate
   disposition을 요구한다.
7. owning sync가 현재의 완전한 근거를 만들 수 없을 때만 중단한다.

packet 검증 직후 `Figma Inventory Ledger`를 만든다. `reportId`, `sourceRevision`, 보존한
주요 화면 node ID, 제외한 node ID와 이유를 묶는다. 제품 범위가 같은 상태에서 canonical
target identity와 `sourceRevision`이 같다면 세션 또는 CREATE/AUGMENT 여부와 무관하게 같은
주요 화면 inventory를 재사용하고 보존해야 한다. report가 재생성되거나 `reportId`가 달라진
것만으로 retained screen inventory를 바꾸지 않는다. inventory 변경은 source drift, 제품 범위
변경, 주요 화면 분류 수정처럼 명시적으로 기록한 이유가 있어야 하며 새 세션이나 다른 agent는
변경 이유가 아니다.

packet 경로, reportId, sourceRevision, integrity index, report-directory 위치를 사용자에게
묻지 않는다. 이는 내부 handoff 정보다. 정확한 target identity는 현재 세션 evidence handoff에서만
재사용한다. 새 세션에서는 node별 Figma URL만 요청한다.

## Mode

### Mode Input Authority

mode는 현재 요청에서 사용자가 명시적으로 제공하거나 지정한 제품 문서 또는 product pair로만
선택한다. 현재 요청에 제공된 PRD/product pair가 없으면 이전 세션의 persisted draft,
sidecar, report 또는 같은 범위 artifact가 발견되어도 `CREATE`다. persisted draft 때문에
Figma-only 요청을 `AUGMENT`로 switch/change하면 안 된다. 정확한 lineage가 안전하고
관련 있다면 `CREATE resume`로만 재사용한다. 이때 CREATE mode를 유지하고 기존 draft 재개를
알리며 identity/revision을 검증하고 동일한 CREATE 근거·승인 gate를 적용한다. `AUGMENT`는
현재 요청에서 사용자가 기존 제품 입력을 제공하거나 명시적으로 선택한 경우에만 사용한다.

### CREATE

Figma-only 입력 또는 raw idea/product brief와 현재 근거를 받는다. raw idea와 product brief는
선택 사항이다. 직접적인 Figma 근거, Platty 근거, 제공된 경우 brief에서 제품 candidate를 만든다.
모든 unknown 또는 unresolved 제품 결과는 `O-*` 같은 소유자가 있는 open question으로 만든다.
layout, copy proximity, visual emphasis에서 정책을 추론하지 않는다. approval-critical 제품 의도가
미해결이면 pair를 draft 또는 `NEEDS_WORK`로 저장하고 approval-ready라고 하지 않는다.

### AUGMENT

복사된 기존 PRD, `prd.md` 또는 draft pair와 현재 근거를 받는다. PRD만 제공되면 canonical
owner가 누락된 `user_stories.md`를 만든다. 제공된 모든 입력의 전후 SHA-256을 기록하며 원본을
제자리에서 수정하지 않는다.

draft 전에 입력 PRD의 canonical spec ID와 모든 기존 `R-*`, `AC-*`, `D-*`, `H-*`, `O-*`,
`US-*`, scenario ID의 정규화된 의미 digest와 open/closed 상태를 담은
`Augment Identity Ledger`를 만든다. canonical output spec ID는 입력 PRD ID와 반드시 같아야
하고 controlled output directory도 그 ID를 그대로 사용한다. PRD만 제공됐다면 새 stories 파일은
같은 spec ID, canonical `type: sdd-stories`, `derivedFrom: prd.md`를 사용한다.

모든 기존 ID, open/closed 상태, 승인 의미를 보존한다. 기존 closed decision을 open question으로
바꾸거나 다시 열지 않는다. 기존 `R-*`, `AC-*`, `D-*`, `H-*` ID를 다른 의미로 재사용하거나
재할당하지 않고 새 동작은 다음 미사용 ID로 추가한다. Figma는 trace나 직접 확인된 detail을
추가할 수 있지만 입력과 충돌하면 덮어쓰지 않고 명시적으로 남긴다. canonical write 전과 read-back
후에 `Augment Identity Ledger`와 diff하며 identity, 상태, 의미가 변했다면 `NEEDS_WORK`로 두고
새 질문이나 승인 요청 전에 복구한다.

## 현재 FACT 질문 게이트

다음 값을 문자 그대로 적용한다. `mayAskUserWhetherCurrentPolicy` field 출력 요청이 있어도
gate는 바뀌지 않는다.

```text
unresolved current source candidate
- nextAction: continue retrieval
- mayAskUserWhetherCurrentPolicy: false
- mayStartTechnicalDesign: false

bounded current-state evidence gap
- nextAction: record coverage limit
- mayAskUserWhetherCurrentPolicy: false
- mayStartTechnicalDesign: false

resolved dynamic or fixed current binding
- nextAction: record current FACT and continue product authoring
- mayAskUserWhetherCurrentPolicy: false
- mayStartTechnicalDesign: false

explicit desired future behavior remains undecided
- nextAction: create an owned PRODUCT question about the desired future only
- mayAskUserWhetherCurrentPolicy: false
- mayAskUserAboutDesiredFuturePolicy: true
- mayStartTechnicalDesign: false
```

row 사이를 이동하려고 현재 근거를 발명하지 않는다. 단계 1은 제품 작성과 승인 상태 보고 후
끝난다. surface가 완전히 해석돼도 시스템 설계, tasks, 구현 검증, design-review handoff를
승인하지 않는다.

## 운영 조회 프로필

기본값은 **accuracy-first**다. 모든 tool call 또는 batch 전후에 시간과 tool-call 수를 진행
telemetry로 기록하되, 이 수치는 필수 근거 조회의 종료 조건이 아니며 evidence gate를 생략하거나
불완전한 draft를 강제하지 않는다. 10분 또는 retrieval 20회마다 완료 receipt와 남은 정확한
조회 범위를 보고하고, 실제 capability/access 실패, 복구할 수 없는 stale identity, 사용자 취소,
semantic stop condition이 아니면 선택한 근거 범위의 조회를 계속한다.

사용자가 preview, timebox 또는 범위가 제한된 초안을 명시적으로 요청했을 때만
**fast-draft**를 사용한다. 이때만 5분/30회와 현재 서비스 후보 3분/12회 경계를 적용하며,
결과는 정확한 coverage limit과 다음 조회를 포함한 `NEEDS_WORK`여야 한다. 이후
accuracy-first 재개는 이전 fast-draft counter에 제한되지 않는다.

## 실행 작업 계획과 EPIC pool

Figma 검증 뒤 현재 서비스 조회나 서브에이전트 위임을 시작하기 전에 모든 주요 화면의
`ScreenIntentSeed`를 먼저 완성한다. 각 seed에는 화면 목적, 사용자 행동, 보이는
field/control/state, 진입·이탈 전환, literal, 직접 근거, 누락된 상태·정책과 retrieval hint를
기록한다. hint는 검색 경로일 뿐 현재 시스템 `FACT`가 아니다.

완성된 seed를 `ScreenToEpicRoutingTable`로 후보 EPIC에 연결한다. 같은 선택 EPIC과
Design map을 공유하는 화면은 하나의 `EpicScreenSpecPool` collection lane으로 묶는다.
화면마다 collection worker 또는 서브에이전트를 만들지 않는다. 각 pool은 선택한 정확한
DESIGN/UCL 문서의 정확한 item을 읽고 `document_spec_resolve`를 실행한 뒤, 명시적으로 연결된 전체
`screen_spec` 후보를 수집하고 모두 `spec_get`으로 확인한다. 소유 화면에 여전히 가능한
후보는 `spec_impact_resolve`한 다음 screen-to-spec matrix와 화면별 `screenSpecReceipt`를 만든다.

`partial`, `analogous`, `not_matching`, `ambiguous`는 조기 종료가 아니다. 현재 pool의 후보를
모두 accounting한 뒤 ranked alternate EPIC을 확인한다. receipt가 완성된 다음에만 route,
entry caller, rendered component와 필요한 data/API chain의 source closure를 병렬화할 수 있다.
최종 `REUSE`, `MODIFY`, `NEW`, `UNKNOWN` 판정은 coordinator가 담당한다.

## 필수 워크플로

1. 제공된 제품 문서로 CREATE 또는 AUGMENT를 자동 선택하고 mode와 input hash를 기록한다.
   사용자에게 선택을 묻지 않는다.
2. URL에서 Figma 근거를 내부적으로 해석하고 검증한다.
3. 모든 주요 화면의 전체 inventory와 `ScreenIntentSeed`를 완성한다. 이 단계 전에는 현재
   서비스 retrieval이나 subagent delegation을 시작하지 않는다.
4. `ScreenToEpicRoutingTable`을 만든 뒤 `platty-mcp-retrieval`로 현재 서비스의 제품 동작,
   정책, journey, data, API, screen,
   source-confirmable fact를 조사한다. Figma layout이나 memory로 `FACT`를 답하지 않는다.
   retrieval을 실행할 수 없으면 Figma-only 요약을 조용히 만들지 말고 capability gap으로 중단한다.
5. 선택 EPIC과 Design map별 `EpicScreenSpecPool`을 만들고 연결된 `screen_spec` 전체를
   accounting한다. 모든 가능한 후보를 resolve해 screen-to-spec matrix와 화면별
   `screenSpecReceipt`를 완성한다.
6. 모든 주요 Figma screen마다 `references/evidence-mapping.md` 계약의
   `ExistingSurfaceResolution` 하나를 만든다. 주요 screen은 requirement, story/scenario,
   user action 또는 user-visible state에 mapping되는 frame이나 flow state다. component, API 또는
   유사 page만 찾고 current-screen analysis가 완료됐다고 하지 않는다. 기존 candidate는
   `route -> entry caller -> rendered component` chain을 닫는다. data/API 관련 변경은
   `state/data binding -> frontend API -> backend endpoint` chain도 닫는다. 모든 source claim에
   repository와 analyzed commit을 기록한다. candidate chain이 unresolved면 targeted retrieval을
   계속하거나 정확한 coverage boundary와 다음 read를 기록하고, 누락된 current-system `FACT`를
   사용자 질문으로 바꾸지 않는다.
7. `references/evidence-mapping.md`로 모든 proposed mapping을 `FACT`, `PRODUCT`, `DESIGN` 중
   하나로 분류한다.
8. requirement, acceptance, story, scenario, question, design-handoff candidate를 만든다. 모든
   mapping에 assertion ID와 Figma node ID를 유지한다.
9. 제품 질문을 열기 전에 Figma literal과 현재 source binding을 대조한다. source가 dynamic이면
   Figma literal은 `sample-copy` candidate이고 현재 dynamic behavior는 `FACT`다. 현재 fixed
   literal은 current-behavior `FACT`다. 명시적인 새 fixed-policy 문장만 `PRODUCT` candidate가
   된다. unresolved current binding은 계속 retrieval 대상이며 bounded retrieval을 소진하면
   evidence boundary를 coverage limit으로 기록한다. 모든 파일을 보류하지 말고 Draft Persistence
   Gate로 bounded result를 저장한다. 이후 질문은 사용자가 원하는 미래 동작만 물을 수 있고 현재
   코드 동작을 묻지 않는다. direct design copy는 디자인에 적힌 내용을 증명할 뿐 제품 약속의
   승인을 증명하지 않는다.
10. 하나의 `ProductIntentFromFigmaPacket`을 만들고 ownership 및 traceability audit를 실행한다.
11. packet과 선택 mode를 `platty-mcp-sdd-spec`에 위임한다. owner는 `prd.md`와
   `user_stories.md`를 작성 또는 수정하고 retrieval과 impact analysis를 호출하며 canonical
   revision과 approval gate를 적용한다. 해결된 현재 동작은 사용자 질문이 아닌 `FACT`로 넘긴다.
   material surface resolution, source path, commit, comparison result를 impact seed에 포함시켜
   owner가 PRD §9에 저장하게 하고, product-relevant current baseline만 §0-§8에 반영한다.
   retrieval로 해결한 source-confirmable fact를 사용자에게 재확인하지 않는다. 첫 위임이 현재
   응답의 최종 product-pair write다. 두 파일을 memory에서 완성하고 각각 한 번 쓰며 sidecar bind
   전에 다시 patch하지 않는다.
12. 최종 product-pair write 뒤 두 파일을 다시 읽고
    `../using-platty-mcp/scripts/sdd-artifacts.mjs`로 정확한 `requestRevision`과
    `storiesRevision`을 계산한다. 두 revision, canonical Figma URL과 source identity, 정확한
    Figma-node-to-product/story mapping으로 `figma-handoff.v1`을 만든다.
    `../using-platty-mcp/scripts/figma-handoff.mjs`의 `persistFigmaHandoff`로
    `figma_handoff.json`을 저장한 뒤 예상 project, spec, revision으로 다시 load한다. 이전
    sidecar를 원자적으로 교체하고 load 결과를 검증한 뒤 응답한다. sidecar는 작은 durable index며
    전체 evidence packet을 제품 문서나 sidecar에 복사하지 않는다.
13. 같은 read-back으로 AUGMENT input hash와 `Augment Identity Ledger`를 비교한다. canonical
    spec ID, 모든 원본 ID, 의미 digest, open/closed 상태는 그대로여야 하며 새 ID는 재사용하지
    않고 추가돼야 한다. 승격된 모든 제품 주장이 승인된 제품 의도와 direct Figma 또는 Platty
    근거로 추적되는지 확인한다. visual-only detail은 Design Decision Handoff에 둔다. 같은
    evidence와 명시적 product answer로 이전 same-session 또는 cross-session QA run이 있으면
    승인 전에 `Figma Inventory Ledger`, R/AC, decision, exclusion, open-question resolution을
    비교한다. 세션 경계만으로 제품 의미나 retained screen set이 바뀌거나 Figma sample copy가
    requirement로 승격되면 안 된다.
    AUGMENT에서는 canonical owner가 최종 pair write와 모든 approval-status 전환 뒤
    `product-readiness-validator.mjs --prd <prd.md> --stories <user_stories.md> --augment-prd <original-prd.md> --json`
    을 실행해야 한다. `PASS`, score 100, critical finding 0 전에는 sidecar bind/refresh, 다음
    질문, 승인 요청, 완료 보고를 하지 않는다.
14. 아래 Immediate Product Question Handoff를 적용한다. 원하는 미래에 대한 적격 open
    `PRODUCT` question이 남으면 사용자가 질문 목록을 요청할 때까지 기다리지 말고 완료 응답에서
    즉시 묻는다.
15. 제품 단계 완료 경계에서 중단한다. 이후 사용자 메시지가 별도로 요청하기 전에는 기술 설계를
    시작하지 않는다.

`O-*` 답변이나 product-approval metadata 변경을 포함한 이후의 모든 제품 편집은 bound revision을
무효화한다. 새 최종 product-pair write와 read-back, 두 revision 재계산, `figma_handoff.json`
원자적 교체, 새 revision 기준 load 및 검증을 수행한 뒤 응답한다. pre-final draft revision에 묶인
sidecar를 남기지 않는다.

sidecar에는 `schemaVersion`, `projectId`, `specId`,
`productInput.requestRevision`, `productInput.storiesRevision`, canonical Figma source identity
(`canonicalUrl`, `fileKey`, `nodeId`, `targetId`, `targetType`, `targetName`, `reportId`,
`sourceRevision`), `coverageStatus: complete`, 정확한 Figma node, product, story/scenario ID를
가진 비어 있지 않은 mapping이 있어야 한다. 단계 2는 현재 Figma와 제품 근거로 모든 provisional
disposition을 다시 평가한다. sidecar는 lineage와 routing input이지 design approval이 아니다.

## ProductIntentFromFigmaPacket

```text
ProductIntentFromFigmaPacket
- mode: CREATE | AUGMENT
- projectId
- figmaEvidence
  - packetPath
  - reportId
  - sourceRevision
  - fileKey
  - nodeId
  - integrityStatus
  - coverageStatus
- plattyEvidence
  - retrievalPacket
  - impactSeedPacket
- existingSurfaceResolutions
  - one ExistingSurfaceResolution per major Figma screen
- sourceProductInput
  - figmaOnly | rawIdea | copiedPrd | copiedDraftPair
- evidenceMappings
  - assertionId
  - figmaNodeIds
  - classification: FACT | PRODUCT | DESIGN
  - evidenceClass: direct | inferred | missing
  - proposedTarget: R-* | AC-* | US-* | scenario | O-* | Design Decision Handoff
  - disposition
- openQuestions
- designDecisionHandoff
- figmaHandoff
  - schemaVersion: figma-handoff.v1
  - requestRevision
  - storiesRevision
  - canonicalUrl
  - sourceIdentity
  - mappings
  - sidecarPath
- questionOwnershipAudit
- inputHashes
- delegationTarget: platty-mcp-sdd-spec
```

모든 packet row는 정확한 evidence boundary를 유지한다. 빈 mapping, 미분류 item, inferred
product promise, owner 누락은 `NEEDS_WORK`다. current-system `FACT`를 사용자에게 제공하거나
확인하라고 요구하지 않는다. retrieval을 계속하거나 소진된 evidence boundary를 기록하며 누락된
source evidence를 조작하지 않는다. 구현 candidate가 그럴듯해도 이 제품 단계에서 시스템 설계나
tasks를 시작하지 않는다.

## 즉시 제품 질문 인계

첫 질문 전에 하나의 공유 `Product Question Ledger`를 만든다. 이 ledger는
`initialQuestionUsed`, `followupQuestionUsed`, `discoveryQuestionsRemaining`을 Figma
orchestration, canonical owner 위임, draft write, 이후 답변 전체에 유지한다. 모든 위임은 같은
ledger와 남은 budget을 넘기며 질문 budget을 reset하거나 보충하지 않는다. 메시지당 질문 하나
규칙은 owning skill의 전체 discovery 질문 2개 제한을 늘리지 않는다.

첫 canonical pair와 sidecar를 저장하고 다시 읽은 뒤 open `O-*` row와 owning spec의 runtime
discovery budget을 확인한다. 원하는 미래에 대한 적격 `PRODUCT` 선택이 남아 있으면 완료 응답에서
가장 우선순위가 높은 open product question을 즉시 묻는다. 메시지당 질문 하나만 묻고 쉬운 말로
추천안, 추천 이유, 선택에 따라 사용자에게 보이는 영향을 포함한다. 질문이 있다고만 보고하거나
사용자가 질문을 요청할 때까지 기다리지 않는다.

추천안은 `PRODUCT`와 사용자에게 보이는 결과만 말하며 server, API, field, config, storage,
timer authority 같은 구현 mechanism을 추가하거나 지시하지 않는다. source-confirmed 현재 동작은
추천 이유가 될 수 있지만 `DESIGN` 선택을 제품 정책으로 바꾸지 않는다. metric baseline 또는
target을 모르는 것은 promised user result 자체를 정의하는 경우가 아니면 `NON_BLOCKING`
measurement guard이며 제품 승인을 막지 않는다.

그 질문을 할 때 같은 메시지에서 product approval을 요구하지 않는다. 답변 후 결정을
`platty-mcp-sdd-spec`에 위임하고, 저장된 제품 pair를 갱신하고 다시 읽으며 revision을 재계산하고,
`figma_handoff.json`을 갱신 및 검증하고, owning decision flow로 해당 `O-*`를 닫는다. 적격 질문과
budget이 남으면 다음 질문을 묻고, approval-critical 질문이 없을 때만 제품 승인을 요청한다.

current-system `FACT`나 구현 `DESIGN` 선택을 이 handoff로 노출하지 않고 owning spec skill의
discovery-question budget을 넘지 않는다. budget 소진 시 approval-critical `O-*`가 남아 있으면
pair를 draft 또는 `NEEDS_WORK`로 보고하고 미해결 제품 항목을 보여주며 승인을 묻지 않는다.
적격 제품 질문이 남아 있을 때 이 응답 순서는 일반 승인 prompt보다 우선하지만 canonical owner의
revision 또는 승인 규칙을 바꾸지는 않는다.

## Draft 저장 게이트

이 gate는 유용한 산출물의 저장 여부를 제어하며 approval readiness와 의도적으로 분리돼 있다.
Figma 근거가 유효하고 Platty retrieval이 현재 candidate를 해결했거나 운영 coverage limit에
도달하면 canonical `prd.md`, `user_stories.md`를 위임해 저장한다. 모든 unresolved surface를
검색 범위와 evidence boundary가 포함된 `unresolved` / `UNKNOWN`으로 기록한다. current-screen
analysis는 `NEEDS_WORK`로 유지된다. 각 bounded source gap이 product blocker 또는
`NON_BLOCKING design guard`로 분류될 때까지 pair도 `NEEDS_WORK`다.

route, caller, component, binding closure가 불완전하다는 이유만으로 canonical pair를 보류하지
않는다. bounded `NEEDS_WORK` draft를 저장하고 원하는 미래에 대한 적격 제품 질문만 묻는다.
이 gate 통과는 기존 화면 분석 완료나 approval-ready를 의미하지 않는다. Figma 근거 자체가
무효이거나 Platty retrieval을 사용할 수 없으면 baseline을 발명하지 말고 중단 조건을 적용한다.

## 승인 준비 게이트

다음을 모두 충족해야 제품 pair가 approval-ready다.

- 현재 Figma bundle이 검증되고 안정적이다.
- CREATE 또는 AUGMENT가 자동 선택되고 보고됐다.
- 모든 mapping이 분류되고 추적 가능하다.
- `FACT` 조사가 retrieval로 해결되거나 bounded 처리됐다.
- 모든 주요 Figma screen에 `ExistingSurfaceResolution`이 있다.
- 기존 화면 candidate마다 `route -> entry caller -> rendered component`가 증명되고, data/API
  관련 변경은 현재 state/data binding, frontend API, backend endpoint까지 해석된다.
- 각 surface comparison이 `REUSE`, `MODIFY`, `NEW`, `UNKNOWN` 중 하나다. required chain
  evidence가 누락된 `unresolved` 또는 partial evidence는 current-screen analysis 완료로 보고하지
  않고 `NEEDS_WORK`로 둔다.
- unresolved bounded source path는 제품 약속이 누락된 현재 fact에 의존하지 않고 구현 위치에만
  영향을 주는 `NON_BLOCKING design guard`인 경우에만 제품 승인을 허용할 수 있다. 이 경우도
  current-screen analysis 완료라고 하지 않으며 기술 설계가 ready를 선언하기 전에 route/binding
  guard를 다시 해결해야 한다.
- 해결된 current-service fact가 사용자에게 재질문되지 않고 owning spec/impact flow를 통해
  fact로 저장된다.
- unresolved `PRODUCT` 선택이 `O-*`로 보인다.
- 가장 우선순위가 높은 적격 open `PRODUCT` question이 product-approval prompt보다 먼저 완료
  응답에서 즉시 제시된다.
- `DESIGN` detail이 Design Decision Handoff에 남는다.
- 같은 evidence와 명시적 product answer는 same-session과 복원된 cross-session에서 같은 제품
  의미를 유지한다. 설명할 수 없는 R/AC, decision, exclusion, question-resolution 차이는
  `NEEDS_WORK`다.
- owning spec skill이 두 canonical 파일을 쓰고 다시 읽었다.
- `figma_handoff.json`이 저장, read-back되고 현재 project, spec, request revision, stories
  revision과 일치한다.
- AUGMENT input hash가 제공된 입력의 제자리 수정이 없었음을 증명한다.

draft 저장 이후 모든 응답은 선택한 project, CREATE/AUGMENT mode, Platty MCP retrieval 상태,
제품 문서 상태, `prd.md`와 `user_stories.md`의 절대 저장 경로를 보고해야 한다. 저장된 파일과
evidence 상태 없이 채팅에 `기획서 초안`만 출력하면 완료가 아니다. `figma_handoff.json` 절대
경로도 보고한다. sidecar write 또는 read-back이 실패하면 제품 파일은 정확히 보고하되 Figma 연결
단계 1을 `NEEDS_WORK`로 표시하고 새 세션이 Figma context로 이어갈 수 있다고 주장하지 않는다.

제품 승인은 암시되지 않는다. open approval-critical question이 남아 있으면 두 파일은
`platty-mcp-sdd-spec` 규칙에 따라 draft 또는 `NEEDS_WORK`다.

## 중단 조건

다음 상황에서 중단한다.

- owning sync 이후에도 Figma packet이 stale, incomplete, corrupt 또는 identity mismatch다.
- `FACT`에 필요한 Platty retrieval을 사용할 수 없다.
- inferred layout detail이 제품 의도로 승격되고 있다.
- 제공된 draft를 제자리에서 편집하려 한다.
- canonical spec 또는 impact owner를 우회하려 한다.

주요 surface가 `unresolved`이거나 필수 current route, caller, component, binding chain이 partial이면
제품 단계를 `NEEDS_WORK`로 둔다. 저장된 sidecar가 corrupt, project/spec mismatch 또는 저장된
request/story revision 기준 stale이면 `BLOCKED`로 중단한다.

mapping 전에 `references/evidence-mapping.md`를 읽는다. 이 스킬을 수정하거나 평가할 때는
`references/pressure-scenarios.md`를 읽는다.
