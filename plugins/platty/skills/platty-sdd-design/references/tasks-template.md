---
id: "SPEC-<slug>-<YYYY-MM>"
type: "sdd-tasks"
status: "draft"
projectId: "<platty-project-id>"
sourceCommit: "<sot-source-commit-or-unknown>"
sotExportedAt: "<ISO timestamp>"
evidenceBoundary: "<business-docs|static-only|mixed|stale>"
outputLanguage: "<requested-output-language>"
derivedFrom: ["prd.md", "user_stories.md", "impact.md", "system_design.md"]
approvedAt:
approvedBy:
---

# 구현 작업 — <스펙 제목>

> 설계 참조: [system_design.md](system_design.md) · 상세 근거: [impact.md](impact.md)

## 0. 작업 연결표

| 작업 | 설계 결정 | 규칙/시나리오 | 근거 또는 확인 필요 |
| --- | --- | --- | --- |

## 1. 구현 작업

의존성 순서대로 작성합니다: 데이터 → 도메인/백엔드 → API/진입점 → 화면/호출자 → 이벤트·잡 → 관측성.

- [ ] 1.1 `<파일 경로 또는 확인 작업>` — <구체적 변경>
  - 설계 결정: <system_design.md §n>
  - 규칙/시나리오: <R-01 / US-01>
  - 근거: <impact.md 참조 또는 파일 확인 필요>

파일 경로가 확인되지 않았으면 추측하지 말고, 먼저 근거 확인 작업을 만듭니다.

## 2. 자동화 검증

- [ ] 2.1 `<테스트 파일 또는 확인 작업>` — <정상·오류·상태/동시성 시나리오>
  - 연결: <설계 결정 / 규칙 / 사용자 시나리오>

## 3. E2E 시나리오

| # | 조건 | 행동 | 결과 | 연결 |
| --- | --- | --- | --- | --- |
| 1 | | | | R-01 / US-01 |

## 4. 수동 검증

자동화하기 어렵거나 외부 환경이 필요한 항목만 포함합니다.

- [ ] 4.1 <수동 확인>

## 5. 배포와 롤백

| 단계 | 작업 | 롤백 조건 | 롤백 방법 |
| --- | --- | --- | --- |
