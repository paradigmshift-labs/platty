---
name: platty-mcp-figma-design-sync
description: Figma URL, 페이지, 섹션 또는 프레임을 Platty MCP 제품 기획이나 기술 설계 전에 재사용 가능하고 revision이 관리되는 디자인 근거로 만들 때 사용한다.
---

# Platty MCP Figma 디자인 동기화

**선행 조건:** 이번 턴에서 아직 읽지 않았다면 작업 전에 `using-platty-mcp`를 읽는다.
모든 `use_figma` 호출 직전에는 `figma:figma-use`를 읽는다.

하나의 정확한 Figma 대상을 검증된 `FigmaEvidencePacket`으로 변환한다. 이 스킬은
디자인 근거를 수집하지만 제품 요구사항, 시스템 설계, tasks, generated SOT, memory,
소스 코드는 작성하지 않는다.

사용자가 읽는 모든 요약은 한국어로 작성한다. Figma 문구, node ID, file key, 상태값,
경로, 코드 식별자는 원문 그대로 보존한다.

## 사용 시점

사용자가 Figma URL 또는 정확한 `fileKey`와 `nodeId`를 제공하고, 이후 PRD나 시스템
설계에서 사용할 디자인 근거의 동기화, 목록화, 요약, 비교 또는 준비를 요청할 때 사용한다.

Figma 기반 제품 문서 요청에서는 이 스킬이 먼저 실행된 뒤 현재 packet을
`platty-mcp-sdd-spec-from-figma`에 전달한다. 기술 설계 요청에서는 packet을
`platty-mcp-sdd-design-with-figma`에 전달한다.

Figma를 수정하거나 시각적 배치에서 제품 의도를 추론하기 위해 사용하지 않는다. 버튼 위치,
그룹, 색상, 근접성, 시각적 위계는 `inferred` 디자인 근거일 뿐 직접적인 제품 규칙이 아니다.

## 소유권 경계

원본 조회에는 설정된 Figma MCP 기능을 사용하고 Platty 프로젝트 해석에는
`using-platty-mcp`를 사용한다. 로컬 Platty CLI 명령은 실행하지 않는다.

이 스킬에 허용되는 유일한 로컬 쓰기 예외는 다음의 자체 완결형 report다.

```text
~/.platty/design-sync/<projectId>/<targetId>/reports/<reportId>/
```

`~/.platty/specs`, generated-SOT 산출물, 저장소, 프로젝트, cache, memory 또는 Figma를
변경하면 안 된다. 호출자가 명시적인 실험 경로를 제공한 경우에만 정제된 실험 receipt를
작성할 수 있다.

## 근거 규칙

모든 중요한 주장은 정확히 다음 중 하나로 분류한다.

- `direct`: 명시적인 Figma 문구, annotation, prototype reaction, property,
  component identity, variable value, asset identity 또는 관찰된 geometry
- `inferred`: layout, naming, repetition, proximity 또는 불완전한 구조 근거에서 나온 해석
- `missing`: 후속 단계에 필요하지만 존재하지 않거나 접근할 수 없는 정보

`inferred`나 `missing` 근거를 제품 약속으로 승격하지 않는다. 모든 주장에 원본 node ID와
정확한 관찰 내용을 보존한다.

## 필수 워크플로

`references/workflow.md`를 순서대로 따른다.

1. 정확한 대상을 파싱하고 canonicalize한다. report 저장이 필요하면 Platty MCP로
   `projectId`를 해석한다.
2. Figma MCP capability coverage를 목록화한다. 누락 기능을 명시적으로 남기며 screenshot이나
   로컬 파일로 몰래 대체하지 않는다.
3. 범위가 제한된 overview와 최초 metadata snapshot을 수집한다.
4. page 대상이면 Meaningful Section map을 만들고, deep capture 전에 정규화한 최초
   metadata에서 완전하고 범위가 제한된 `semanticCandidates` 집합을 도출한다. validator는
   모델이 제공한 개수만 신뢰하면 안 된다.
5. 모든 candidate를 정확히 한 번 captured State Frame 또는 사유가 비어 있지 않은 제외
   항목으로 분류한다. 다음 식을 충족해야 한다.

   ```text
   stateFrames + excluded === semanticCandidates
   ```

6. 채택한 각 State Frame에 대해 node별 metadata, screenshot, 범위가 제한된 design context를
   수집한다. capability와 근거가 존재하면 명시적인 annotation, interaction, component,
   token, asset도 수집한다.
7. assertion 단위의 `direct` / `inferred` / `missing` 근거를 만들고 warning과 구현 gap을
   기록한다.
8. 같은 범위의 metadata 조회를 동일하게 반복한다. 최초와 최종 metadata의
   `sourceRevision`이 같아야 한다. 다르면 `source_drift`로 표시하고 packet을 stale로
   설정하며 현재 근거로 발행하지 않는다.
9. `scripts/validate-figma-evidence.mjs`로 packet을 검증한다.
10. 결정적인 `reportId`를 계산한다. byte가 동일한 기존 report는 재사용하며 관찰 시간만
    달라졌다는 이유로 새 revision을 만들지 않는다.
11. 검증 성공 후에만 하나의 자체 완결형 report를 발행하고, byte 단위 read-back 검증을 위해
    validator를 `--bundle <reportDir>`로 다시 실행한다.

## 완료 게이트

page report가 현재 상태이며 완전하려면 다음을 모두 만족해야 한다.

- 대상 identity와 최초/최종 revision이 존재하고 안정적이다.
- 모든 semantic candidate가 정확히 한 번 capture 또는 제외됐다.
- 모든 State Frame에 screenshot과 범위가 제한된 구조 근거가 있거나, capability 사유와 함께
  명시적으로 blocked 처리됐다.
- assertion 분류가 유효하다.
- capability gap, coverage limit, warning, implementation gap이 보존됐다.
- 쓰기와 read-back 후 결정적인 report bundle 검증이 통과한다.

부분 근거는 `partial`, `blocked`, `stale` 상태로 저장할 수 있지만 전체 page의 완전성이나
후속 단계 준비 완료를 주장하면 안 된다.

## 중단 조건

다음 상황에서는 중단하고 capability 또는 evidence gap을 반환한다.

- Figma 대상에 정확한 node ID가 없거나 대상을 해석할 수 없다.
- 인증 또는 필수 Figma MCP capability를 사용할 수 없다.
- page 대상의 overview 또는 범위가 제한된 metadata inventory를 만들 수 없다.
- semantic candidate가 누락, 중복, 선택과 제외에 동시에 포함되거나 둘 다 아니다.
- capture 중 source drift가 발생한다.
- evidence identity 또는 report closure를 검증할 수 없다.
- 요청이 report 예외 경로 밖에 쓰거나 제품, 설계, tasks, generated-SOT, memory, 코드,
  프로젝트 또는 Figma 상태를 바꾸려 한다.

## 출력

다음을 반환한다.

- canonical source identity와 revision
- report 경로와 `reportId`, 생성 또는 재사용 여부
- Meaningful Section, State Frame, exclusion, assertion, component, token, asset 개수
- coverage 식과 capability matrix
- drift/freshness 상태
- direct, inferred, missing 요약
- warning, implementation gap, downstream readiness
- 정확한 현재 packet 경로를 가리키는 handoff

packet을 작성하거나 소비하기 전에
`../using-platty-mcp/references/figma-evidence-contract.md`를 읽는다. 이 스킬을 수정하거나
평가할 때는 `references/pressure-scenarios.md`를 읽는다.
