# Heroines Sync 전파 검증 — 진행 로그 (2026-06-11)

대상 계획: `docs/superpowers/plans/2026-06-11-heroines-sync-propagation-test.md`

## 격리 환경
- `PLATTY_HOME=/Users/pshift/.platty-synctest` (사용자 실제 `~/.platty` 비오염)
- 프로젝트: `heroines-sync` (id `3Z1MrgK9W9rcAWhPLyQ8Q`)
- 레포: `heroines-fixture` (id `gaLeTwWKw37wtfbgOrwdW`), repoPath=`/Users/pshift/Development/heroines_back`,
  branch=`platty-sync-test`, sourceRoot=`src/_platty_fixture`
- 워크트리: `/Users/pshift/.platty-synctest/worktrees/gaLeTwWKw37wtfbgOrwdW/heroines_back-a038711e/platty-sync-test-e45e41ed`
- ⚠️ 정리 필요: 워크스페이스 `current project` 포인터(`/Users/pshift/Development/.platty/config.json`)가
  기존 `heroines_back_sync`(id `RMcXsw7946ZaZy0Z3Bd5d`) → 테스트 프로젝트로 변경됨. **종료 시 복원**.

## 베이스라인 fixture (C0 = `2dc8f0109`)
self-contained 미니 NestJS+Prisma: `src/_platty_fixture/`
- 라우트 3 (POST /auth/login, GET /point/balance, GET /feed)
- job 1 (@Cron PointExpiryJob.run)
- event publish/listen 1쌍 (point.earned: AuthService.login emit → PointEarnedListener @OnEvent)
- 모델 5 (User, PointWallet, PointLog, Feed, Notification)

## 정적분석 결과 (Step 2 PASS)
- 7단계 모두 passed/fresh
- entry_points 5: api×3, event×1(point.earned 리스너 승격), job×1
- models 5 (fixture 스코프 — 351 아님) ✓ — `--source-root`+fixture-local `prisma/schema.prisma`로 스코프 확정
- code_relations 9: db_access×6, event_publish×1, event_listen×1, schedule_trigger×1
- service_map: nodes 11(api3/db5/event2/job1), edges 8(accesses_db6/publishes_event1/triggers1)

## build_docs 계획 (Step 3)
- gen run `gen:71fdf929-...`, 5 tasks: api_spec×3, event_spec×1, schedule_spec×1
- provider=codex_cli, outputLanguage=en, source_commit=2dc8f0109

---

## 발견된 엔진 이슈 (검증 부산물)

### F-1 [MEDIUM] `run`이 미confirm 게이트에서 우아하게 보고하지 않고 크래시
- 증상: analyze_repo 후 confirm 전 `platty run` 호출 시 `UNEXPECTED_ERROR: run failed unexpectedly`(상세 없음).
  confirm 후 재실행하면 정상.
- 기대: "confirm 필요" nextAction을 반환해야 함.
- 영향: UX. 분류=결정 필요(메시지 표면화 수정은 자동수정 가능 후보).

### F-2 [MEDIUM] 이벤트명이 문자열 리터럴이 아니면 event 관계 미감지
- 증상: `@OnEvent(POINT_EARNED_EVENT)` / `emit(POINT_EARNED_EVENT, ...)`처럼 **상수 식별자**를 쓰면
  event_publish/event_listen 0개. 문자열 리터럴 `'point.earned'`로 바꾸면 정상 감지.
- 근거: `build_relations/adapters/event/families/nest_decorators.ts:11`(firstArg null이면 후보 미생성),
  `build_graph/.../call_extractor.ts:130-138`(firstArg는 문자열 리터럴만 추출).
- 비교: `nest_cqrs.ts`는 firstArg null일 때 source fallback(`findNestCqrsHandlerTarget`) 있음. decorator/emit 경로엔 없음.
- 조치: fixture를 리터럴로 변경(우회). 엔진 갭은 상수 해석 fallback 추가로 수정 가능(범위 큼 → 별도 결정).
- 분류=결정 필요(엔진 수정 여부).

### F-9 [MED, ✅ 수정·검증 완료] epic soft-delete가 그 epic의 business 문서로 전파 안 됨 (상세: 04-c2 리포트)
- C2 검증에서 발견: epic이 deleted_at로 soft-delete돼도 그 epic 소유 business 문서(br/dd/design/ucl/glossary)가
  active/fresh로 잔존. 기술문서 sync는 orphan을 deleted로 정리하나 business track엔 그 단계 부재.
- 수정: `build_epics/core/f10_persist_confirmed_epics.ts`의 stale-epic 루프(이미 epicDocumentLinks/dependencies를
  정리하던 곳)에서, 그 epic의 business 문서(track='business', scopeId가 epic id를 포함 — epic-scope + use_case 복합)
  를 status='deleted'/validity='orphaned'로 cascade 마킹. epic id는 유니크 nanoid라 substring 매칭 안전.
- 검증: 신규 단위 테스트 `f10_persist_business_orphan.test.ts` — 드롭된 epic의 business 문서(br+ucs)만 orphan,
  살아남은 epic 문서·technical 문서는 미변경. build_epics+sync 122/122 통과.

### F-3 [HIGH] 베이스라인 문서 stamping 미작동 — 부트스트랩 미구현 + 순서 의존성 + sync static-map freshness churn
- 증상 체인:
  1. 스냅샷 생성 전에 `docs start/run`을 돌리면 문서가 `documentSourceHash`/`staticSnapshotId` **null**로 저장됨.
     `getSourceStamp`(`build_docs/runtime/runtime.ts:1778-1800`)가 스냅샷이 없으면 null 반환. 자동 부트스트랩
     (`ensureCanonicalStaticSnapshot`)은 코드베이스에 **부재**(grep 0건) → 첫 docs는 항상 unstamped.
  2. 우회로 `sync static-map`을 먼저 돌려 S0를 만들면, 그 canonical 재적용이 **project-level
     build_service_map**의 upstream_versions를 어긋나게 해 이후 `docs start`가
     `{stale:["project:build_service_map"]}`로 블록됨.
  3. `platty run` 재실행으로 build_service_map을 새로고침해야 docs가 다시 진행됨(S0는 보존).
- 결과적으로 stamped 베이스라인을 얻는 현재 유일 경로(비직관적·fragile):
  `run → sync static-map(S0) → run(refresh) → docs → epics → business`.
- 영향: stamping이 없으면 sync diff에서 **수정된 타겟이 `stale` 대신 `stale_candidate`**로 분류됨
  (자동 재생성 대신 수동 리뷰 필요). new_document/orphan_document 분류는 stamping과 무관하게 정상.
- 근본 해결: `2026-06-11-sync-bootstrap-sot-incremental.md` 계획(ensureCanonicalStaticSnapshot +
  backfillDocumentSourceHashes + syncStaticMap 부트스트랩)이 정확히 이 갭을 겨냥. 미구현 상태.
- 분류=결정 필요(부트스트랩 구현은 범위 큼). 본 테스트는 우회 경로로 stamped 베이스라인 확보 후 전파 검증 진행.
- **✅ (a) 수정·검증 완료**: `ensureCanonicalStaticSnapshot(db, projectId)`를 `sync/static_map.ts`에 추가(캐노니컬
  DB에서 직접 Merkle 스냅샷을 1회 생성, canonical churn 없음)하고 `build_docs/runtime/runtime.ts`의 `start()`에서
  호출. 스냅샷이 없을 때만 생성하므로 첫 docs run은 여전히 'full' 모드(스냅샷 1개 < incremental 임계 2). 부수로
  `buildDefaultMerkleSnapshot`의 codeBundles를 프로젝트 entry point로 필터(canonical 멀티프로젝트 안전).
  검증: 새 프로젝트에서 `run → docs`만으로(=sync static-map 0회) 문서 4개가 bootstrap 스냅샷으로 stamp됨.
- **✅ (b) 수정·검증 완료**: build_service_map "stale" 판정은 타임스탬프 비교(`project_phase_status
  .build_service_map.updated_at` < `max(build_relations.built_at)` → stale, runtime.ts:1430). 원인: sync의
  `runBuildServiceMapForStaticMap`가 `runBuildServiceMap`에 **repoId를 넘겨** repo-scope로 실행 →
  `project_phase_status.build_service_map`은 안 갱신되고 canonical seed 옛값 유지 → 새 relations보다 과거로
  보여 stale. 수정: `runBuildServiceMapForStaticMap`에서 **repoId 제거(project-scope)** → project phase가
  fresh로 갱신·복사됨(서비스맵 내용은 원래 프로젝트 전역이라 동일). 검증: f3에서 `sync static-map` 직후
  `docs start`가 precondition 통과(이전엔 `BUILD_DOCS_PRECONDITION_FAILED`). sync 19/19 통과.
  → **`run → sync static-map → docs` 일반 흐름이 추가 `run` 없이 동작.**

### F-4 [재분류: 환경 이슈, 코드 버그 아님] epics 실패의 진짜 원인은 codex 사용량 한도(quota) 소진
- 증상: epics 생성 시 `taxonomy_consolidation`이 `INVALID_TAXONOMY_CONSOLIDATION_RESULT:
  "domains and epics arrays are required"`로 실패, 제출물 `{}`.
- **진단(codex 로그 확정)**: `~/Development/.platty/tmp/build_epics_runs/<run>/tasks/*consolidated*.log`에
  `ERROR: You've hit your usage limit. ... try again at 6:11 PM.` + githubcopilot MCP auth 에러.
  → codex가 한도 초과로 result.json을 못 써서 `JSON.parse(result)` 실패 → catch가 `{}` sentinel 반환 →
  downstream 스키마 검증이 "domains and epics arrays are required"로 **오해 소지 있게** 표면화.
- 결론: platty 코드 버그가 아니라 **codex 크레딧 소진**. quota 회복 시 정상 동작 예상.
  (taxonomy_candidate는 한도 전에 성공, consolidation에서 한도 초과한 타이밍 차이였음)
- 영향: epic/business 재생성의 end-to-end 검증은 **codex 크레딧이 있어야** 가능(외부 요인).

### F-7 [MED, ✅ 수정] codex 호출 실패를 worker가 삼켜 오해 소지 있는 검증 오류로 둔갑
- 원인: `build_epics/worker/worker_runner.ts`의 `} catch { ... result = failedInvocationResultFor() }`가
  codex 에러(예: 사용량 한도)를 **빈 catch로 완전히 삼킴** → 실제 원인이 per-task `.log`에만 남고,
  DB/CLI에는 "<field> arrays are required"라는 엉뚱한 메시지만 보임(F-4 진단에 시간 소모한 이유).
- 수정: catch에서 에러 메시지를 잡아 `console.error('[build_epics] codex invocation failed ...')`로 출력하고
  `taskStats.lastCodexError`에 담아 `epics run` 요약(JSON)에 노출. 다음 quota 실패부터 즉시 진단 가능.

### F-5 [HIGH, ✅ 수정·재검증 완료] 모델 doc source 해시에 `line` 번호 오염 → 무관 변경이 모든 모델 false-invalidate
- 증상: C1에서 PointLog 제거/Badge 추가/User.tier 추가로 schema 앞부분이 바뀌자, 정의가 전혀 안 바뀐
  Feed/Notification/PointWallet 모델까지 sync diff에서 `stale_candidate`로 잡힘. create-doc-plan
  counts `unchanged:0`(전부 변경으로 오판). route 해시의 `relatedModelHashes`를 통해 event_spec까지 cascade.
- 근본 원인: `stableModel`(`sync/static_map.ts`)이 `fields`/`relations` JSON을 그대로 해싱하는데, 그 안에
  필드별 `line` 번호가 포함됨. 파일 앞부분이 한 줄이라도 바뀌면 뒤따르는 모든 모델의 필드 line이 시프트 → 해시 변경.
  (route/node/edge/relation 핸들러 해시에는 line이 없어 영향 없음 → 모델만 과민)
- 결정성 확인: 동일 코드 2회 스냅샷(S1 vs S2)은 모델 해시 완전 동일 → 비결정성 아님, 순수 line 오염.
- 수정: `stableModel`에서 `fields`/`relations`의 `line`(및 위치 메타) 재귀 제거(`stripPositionalMetadata`).
  `packages/core/src/pipeline_modules/sync/static_map.ts`.
- 재검증(수정 후): Feed/Notification/PointWallet → `unchanged`로 복귀, counts `unchanged:3`. 실제 변경분
  (Badge new / PointLog orphan / User changed)만 잡힘. ✅
- 분류=자동수정 완료(자잘한 변경, 루프 1회).

### F-6 [LOW, 관찰] event_spec이 `findRelatedModels`의 느슨한 토큰 매칭으로 무관 모델 변경에 끌려감
- 증상: 이벤트 리스너 로직은 무변경인데 event point.earned가 `stale_candidate`로 잡힘.
- 원인: `findRelatedModels`(`static_map.ts`)가 관계의 target/operation/payload를 토큰화해 모델명과 매칭.
  notification.create의 `userId` → "user" 토큰 → **User 모델**(tier로 실제 변경됨)에 연결 → 이벤트 해시 변경.
- 판정: 과도하게 보수적(이벤트가 User.tier에 실질 의존하지 않음). 단, 잘못된 전파는 아니며 안전측 동작.
  필요 시 findRelatedModels를 관계 kind=db_access의 canonicalTarget 모델로 한정하는 정밀화 가능(별도 결정).
