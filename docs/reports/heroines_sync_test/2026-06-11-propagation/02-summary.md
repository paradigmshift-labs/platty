# Heroines Sync 전파 검증 — 요약 (2026-06-11)

## 무엇을 했나
`heroines_back`에 curated source-root fixture(미니 NestJS+Prisma, 라우트3+job1+event1+모델5)를
전용 브랜치 `platty-sync-test`로 구성 → 정적분석 → 기술문서 생성 → **9종 변경(C1) 주입** →
`sync static-map → create-doc-plan`로 각 변경의 전파(candidate 분류)를 검증. 발견한 결함은 분류·기록,
자동수정 대상(F-5)은 직접 고쳐 **루프 재검증**.

## 결론: 정적분석 → sync 변경감지 전파는 **정상 동작**(수정 1건 후)
9종 변경 전부 올바른 candidate로 분류됨 (상세 `01-change-matrix.md`):
- 라우트 추가→`new`, 삭제→`orphan`, 본문수정→`stale(_candidate)`, 경로변경→`orphan`+`new`
- 모델 추가→`new`, 삭제→`orphan`, 필드수정→`stale_candidate`
- job 삭제→`orphan`, 이벤트 발행 추가→영향 전파
- 정적 레이어(entry_points/models/relations/service_map)가 모든 변경을 정확히 반영

## 발견·조치한 엔진 이슈
| ID | 심각도 | 요약 | 상태 |
|---|---|---|---|
| **F-5** | HIGH | 모델 doc 해시에 `line` 번호 오염 → 무관 스키마 변경이 **모든 모델**을 false-invalidate (event까지 cascade) | ✅ **수정+재검증 완료** |
| **F-3** | HIGH | 베이스라인 문서 stamping 미작동(자동 부트스트랩 미구현) → stamped 베이스라인 경로가 비직관적·fragile | ✅ **수정+검증 완료** (`ensureCanonicalStaticSnapshot` + docs start 훅, `run → docs`만으로 stamp) |
| **F-7** | MED | codex 호출 실패를 worker가 빈 catch로 삼켜 "<field> arrays are required"로 둔갑(F-4 진단 지연 원인) | ✅ **수정+검증 완료** (에러 메시지 surfacing) |
| F-4 | — | **코드 버그 아님**: epics 실패의 진짜 원인은 **codex 사용량 한도(quota) 소진**(codex 로그로 확정). quota 회복 시 정상 동작 예상 | 진단 완료(외부 요인) |
| F-1 | MED | 미confirm 게이트에서 `run`이 안내 대신 크래시 | 기록 |
| F-2 | MED | 이벤트명이 상수 식별자면 event 관계 미감지(리터럴만 인식) | fixture 우회 |
| F-6 | LOW | event가 `findRelatedModels` 느슨한 토큰매칭으로 무관 모델에 끌려감 | 관찰 |

## 코드 변경 (이번 라운드)
- `packages/core/src/pipeline_modules/sync/static_map.ts`: F-5(`stripPositionalMetadata`), F-3(`ensureCanonicalStaticSnapshot`), codeBundles 프로젝트 필터
- `packages/core/src/pipeline_modules/build_docs/runtime/runtime.ts`: F-3 부트스트랩 훅(`start()`)
- `packages/core/src/pipeline_modules/build_epics/worker/worker_runner.ts`: F-7 codex 에러 surfacing
- 회귀: sync 19/19, 변경 모듈 테스트 통과(225/226 — 실패 1건은 사전 WIP `draft_contract.ts`, 본 변경 무관)

## 기술문서 sync apply — ✅ 검증 완료 (`03-docs-apply.md`)
`docs start --sync-plan ... --include-stale-candidates` → `docs run`으로 build_docs 전파(apply) 정상:
new 생성 / orphan deleted / stale 재생성·restamp(S1_fixed) 전부 동작. 활성 문서 4개 = C1 entry point 4개 일치.
제약: 매 실행 전 `platty run`으로 build_service_map 새로고침 필요(F-3 churn).

## 아직 검증 못 한 부분 — 외부 요인(codex 크레딧)
- **epic/business 재생성 전파**: codex 사용량 한도(F-4)로 epics 베이스라인 생성이 막혀 검증 보류.
  **quota 회복 시 재개 가능**(코드 문제 아님). F-3 수정으로 stamped 베이스라인은 이미 확보되므로,
  codex만 되면 `epics start/run` → `epics sync` → `business-docs sync`로 바로 이어서 검증 가능.

## 격리/정리 메모
- 격리 home `PLATTY_HOME=/Users/pshift/.platty-synctest` (실제 `~/.platty` 비오염).
- ⚠️ 워크스페이스 `current project` 포인터(`/Users/pshift/Development/.platty/config.json`)가 테스트
  프로젝트로 변경됨 → 원복 필요(원래 id `RMcXsw7946ZaZy0Z3Bd5d` / `heroines_back_sync`).
- heroines_back 전용 브랜치 `platty-sync-test`(C0 `2dc8f0109`, C1 `4da31d6ea`), 원본 `develop` 보존.
- 엔진 수정: `packages/core/src/pipeline_modules/sync/static_map.ts` (F-5, `stripPositionalMetadata`).
