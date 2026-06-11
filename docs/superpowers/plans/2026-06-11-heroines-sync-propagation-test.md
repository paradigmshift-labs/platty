# Heroines Sync 전파 검증 계획 (2026-06-11)

## 0. 목표 (Goal)

코드를 역산해 SOT(Source-of-Truth)를 만드는 엔진이, **코드 변경이 일어났을 때 각 단계
(정적분석 → build_docs → epic → business_docs)로 변경을 올바르게 전파하는지**를 실제 레포
(`heroines_back`)로 end-to-end 검증한다. 검증 중 발견되는 자잘한 엔진 결함은 직접 고치고
다시 루프를 돌려 전 매트릭스가 통과할 때까지 반복한다.

성공 기준(verifiable):
1. 베이스라인(축소 fixture)에 대해 정적분석 → 기술문서 → epic → 비즈니스문서까지 완주.
2. 의도적으로 주입한 **모든 변경 종류**가 `sync create-doc-plan`의 candidate 분류
   (`new_document` / `stale` / `stale_candidate` / `orphan_document`)에 **정확히** 반영됨.
3. 각 후속 단계(build_docs / epic / business_docs)에서 변경이 **딱 영향받은 대상에만** 전파됨
   (불필요한 재생성 없음, 누락 없음).
4. 발견된 결함은 분류(자동수정 가능 / 결정 필요)되어 자동수정분은 수정·재검증 완료.

---

## 1. 핵심 엔진 메커니즘 (설계를 제약하는 사실)

탐색으로 확인한, 설계에 직접 영향을 주는 사실들:

### 1.1 파이프라인 단계
`analyze_repo → build_graph → build_pattern_profile → build_models → build_route →
build_relations → build_service_map`(정적, 레포/프로젝트 phase_status로 게이팅)
→ `build_docs`(기술문서) → `build_epics` → `build_business_docs`(비즈니스문서).

### 1.2 sync 메커니즘
- `sync static-map`: 스테이징 DB에서 build_graph~build_service_map를 **재실행** → Merkle 스냅샷
  생성 → 캐노니컬 DB에 apply. (`packages/core/src/pipeline_modules/sync/static_map.ts`)
- `sync create-doc-plan`: 이전/현재 스냅샷의 해시셋을 diff → `docSyncPlans` + `docSyncCandidates`
  생성. (`doc_sync.ts`)
- candidate 분류 규칙 (`doc_sync.ts`):
  - old에만 존재 → `orphan_document`
  - new에만 존재 → `new_document`
  - 양쪽 존재 + 해시 다름 + 기존 doc의 `documentSourceHash === oldHash` → `stale`
  - 양쪽 존재 + 해시 다름 + doc 불일치 → `stale_candidate`
  - 양쪽 존재 + 해시 동일 → `unchanged`
- 이후 `docs sync` / `epics sync` / `business-docs sync`가 `docSyncPlanId`를 소비해 전파.

### 1.3 해시(변경 감지) 단위
- **라우트(entry point)** 해시 = `entryPoint + reachableNodeHashes + reachableEdgeHashes +
  reachableRelationHashes + relatedModelHashes`. 핸들러 본문이 호출하는 코드가 바뀌면 해시 변함.
- entry point **ID** = `{repoId}:{framework}:{kind}:{httpMethod}:{fullPath}:{handlerNodeId}`.
  → **경로/메서드/핸들러가 바뀌면 ID 자체가 바뀜** = (old orphan + new) 쌍. 본문만 바뀌면 ID 유지 = `stale`.
- **모델** 해시 = 모델 정의. 필드 변경 → 같은 ID로 `stale`. 모델명 변경 → orphan+new.
- **비즈니스** 해시 = 서비스맵 노드/엣지 집계 + 기술문서 해시 집계. → 기술 변경이 비즈니스로 파급.

### 1.4 워크트리 동작 (★ 실험 절차의 핵심 제약)
- `repo add`는 메타데이터만 등록. 워크트리는 **첫 `platty run`**에서 생성.
  (`packages/core/src/repo/analysis-worktree.ts`)
- 워크트리 경로: `~/.platty/worktrees/{repoId}/{slug}/{branch}/`,
  `git worktree add --detach <commit>`.
- `prepareAnalysisWorktree`는 매번 `fetch origin → checkout --detach → reset --hard → clean -fd`.
  → **`platty run`을 돌릴 때마다 워크트리의 비커밋 수정은 삭제됨.** 워크트리 직접 편집은 커밋 동반 필수.
- `resolveBranchCommit`: origin에 브랜치가 있으면 **origin 커밋** 사용, 없으면 **로컬 브랜치 커밋**으로 폴백.
  → **origin에 없는 로컬 전용 브랜치**를 쓰면 push 없이 로컬 커밋으로 분석 가능.
- `sync static-map`은 워크트리를 **갱신하지 않음** — 현재 체크아웃된 HEAD를 그대로 분석
  (`getHeadCommit(worktreePath)`). → 변경 감지를 위해선 **sync 전에 워크트리 HEAD를 새 커밋으로
  전진**시켜야 함. (이 "전진" 단계가 sync 플로우에 자동화되어 있지 않음 → 잠재적 결함 후보, §6 참조.)

---

## 2. 확정된 의사결정 (사용자 컨펌 기반)

| 항목 | 결정 |
|---|---|
| 베이스라인 축소 방식 | **curated source-root 서브폴더 fixture** (`--source-root`로 좁힌 최소 코드 집합) |
| 문서 생성 워커 | **codex_cli 외부 프로바이더** (`--provider codex_cli`) |
| 격리 | heroines_back **소스 레포의 전용 로컬 브랜치**에 fixture/변경 커밋 (main 보존). §1.4 때문에 불가피 |

> 사용자의 "워크트리에서 직접 수정" 아이디어는 §1.4 제약(베이스라인 run이 워크트리를 reset)으로
> 베이스라인에는 적용 불가. 대신 변경은 전용 브랜치 커밋으로 흘려보내고 워크트리 HEAD를 전진시킨다.

---

## 3. 베이스라인 fixture 설계

heroines_back 소스 레포에 전용 브랜치 `platty-sync-test`를 만들고, 그 안에 자족적
fixture 폴더 `src/_platty_fixture/`를 커밋한다(원본 src는 건드리지 않음, source-root로 무시됨).

fixture 구성(NestJS + Prisma 스타일, 실제와 유사하게):
- **컨트롤러 3개 / 라우트 3개**: 예) `auth.controller.ts`(`POST /auth/login`),
  `point.controller.ts`(`GET /point/balance`), `feed.controller.ts`(`GET /feed`).
- 각 라우트의 **usecase/service/repository** 체인(코드 그래프 reachability가 의미 있도록).
- **이벤트 1~2개**: 예) `point-earned.event.ts` + listener (entry point kind=event 커버).
- **모델 4~5개**(trimmed Prisma): 예) `User`, `PointWallet`, `PointLog`, `Feed`.
  - ⚠️ **모델 스코프 이슈**: build_models는 레포의 Prisma schema source를 읽는다. heroines_back의
    전체 `prisma/schema.prisma`(351 모델)가 잡히면 안 됨. 셋업 시 analyze_repo의 schema source
    탐지 방식을 확인하고, fixture 전용 축소 schema가 잡히도록 구성(브랜치에서 schema.prisma를
    fixture 모델만 남기도록 치환하거나, repo config의 schemaSources를 fixture schema로 지정).
    이 검증을 §5 Step 1의 게이트로 둔다.

베이스라인 산출물: 정적분석 결과 + 기술문서(api_spec×3, event_spec×1, data_dictionary/model docs) +
epic(1~2개) + 비즈니스문서(design/data_dictionary/br/ucl/ucs). 그리고 **부트스트랩 스냅샷 S0**.

---

## 4. 변경 주입 매트릭스 (모든 변경 종류)

베이스라인 이후 `platty-sync-test`에 커밋 C1로 아래를 한꺼번에(또는 단계적으로) 주입한다.
각 행은 기대 candidate 분류와 각 단계 기대 전파를 명시한다.

| # | 변경 | 대상 | 기대 candidate | build_docs | epic | business_docs |
|---|---|---|---|---|---|---|
| 1 | 라우트 **추가** (`POST /point/charge`) | entry_point | `new_document` | 신규 api_spec 생성 | epic 링크 추가 | 영향 epic의 ucs/design 갱신 |
| 2 | 라우트 **삭제** (`GET /feed` 제거) | entry_point | `orphan_document` | feed doc `deleted` 표기 | epic 링크 해제 | 영향 epic 재생성 |
| 3 | 라우트 **본문 수정**(핸들러 로직만, 경로 유지) | entry_point | `stale` | 해당 doc 재생성·restamp | (링크 유지) | 본문 변경 파급 시 갱신 |
| 4 | 라우트 **경로 변경**(`/auth/login`→`/auth/signin`) | entry_point | `orphan_document` + `new_document` | old deleted + new 생성 | 링크 재배치 | 갱신 |
| 5 | 모델 **추가**(`Badge`) | model | `new_document` | 모델 doc 생성 | (해당 시 링크) | data_dictionary 항목 추가 |
| 6 | 모델 **삭제**(`PointLog` 제거) | model | `orphan_document` | 모델 doc deleted | — | data_dictionary 항목 제거 |
| 7 | 모델 **필드 수정**(`User`에 필드 추가) | model | `stale` | 모델 doc 재생성 | — | data_dictionary 갱신 |
| 8 | 이벤트 **수정/삭제** | entry_point(event) | `stale`/`orphan_document` | event_spec 갱신/삭제 | 링크 갱신 | 갱신 |

> 라우트 본문 수정(3)은 핸들러가 호출하는 service/usecase 한 줄을 바꿔 reachable 해시가
> 변하도록 한다(entry point ID는 유지). 4는 ID 변경 케이스를 별도로 커버.

---

## 5. 실행 절차 (단계별, 검증 게이트 포함)

각 Step은 "실행 → 검증(verify)" 쌍으로 진행. 검증 실패 시 §6 루프.

**Step 0 — 사전 점검**
- `npm run build` (platty), `node packages/cli/dist/main.js --help` smoke.
- codex_cli 프로바이더 사용 가능 여부 확인(없으면 사용자에게 보고 후 중단/대안 협의).
- heroines_back이 git 클린한지 확인, 전용 브랜치 생성: `git -C ../heroines_back checkout -b platty-sync-test`.

**Step 1 — 베이스라인 fixture 커밋 & 모델 스코프 검증**
- `src/_platty_fixture/` + 축소 schema 작성 → C0 커밋.
- verify: analyze_repo가 fixture 모델만 잡는지 확인(§3 모델 스코프 이슈 게이트).

**Step 2 — 프로젝트/레포 등록 & 정적분석**
- `platty init` → `platty project create heroines-sync` → `platty project use`.
- `platty repo add ../heroines_back --branch platty-sync-test --source-root src/_platty_fixture` (+ schema 지정 필요 시).
- `platty run` (analyze_repo 게이트 confirm 포함) → 정적 7단계 완주.
- verify: `entry_points` 3개(+event), `models` 4~5개, `service_map_*` 생성 확인.

**Step 3 — 기술문서(build_docs)**
- `platty docs start --provider codex_cli` → `platty docs run --provider codex_cli`.
- verify: api_spec×3, event_spec, model docs가 `documents`에 active로 생성, `documentSourceHash` stamp.

**Step 4 — epic / business_docs (베이스라인)**
- `platty epics start/run --provider codex_cli`; `platty business-docs start/run --provider codex_cli`.
- verify: epics, epic_document_links, 비즈니스 docs(design/data_dictionary/br/ucl/ucs) 생성.
- verify: 부트스트랩 스냅샷 S0 존재(`staticMerkleSnapshots`), docs가 S0 해시로 stamp됨.

**Step 5 — 변경 주입 (C1)**
- §4 매트릭스대로 fixture 수정 → `git -C ../heroines_back commit` (C1).
- **워크트리 HEAD 전진**: 워크트리에서 `git checkout --detach <C1>` (또는 엔진 메커니즘).
  ⚠️ 이 사이에 `platty run` 재실행 금지(§1.4).

**Step 6 — sync 정적 전파 검증**
- `platty sync static-map` → 새 스냅샷 S1.
- `platty sync create-doc-plan --from-snapshot-id <S0> --to-snapshot-id latest`.
- `platty sync list-candidates --plan-id <plan>`.
- verify: candidate counts/targets가 §4 매트릭스와 **정확히** 일치.

**Step 7 — build_docs 전파**
- `platty docs sync start/run --doc-sync-plan-id <plan> --provider codex_cli`.
- verify: new→생성, orphan→deleted, stale→재생성·restamp. 무변경 doc는 손대지 않음.

**Step 8 — epic 전파**
- `platty epics sync start/run --doc-sync-plan-id <plan> --provider codex_cli`.
- verify: epic_document_links가 추가/삭제 라우트에 맞게 갱신.

**Step 9 — business_docs 전파**
- `platty business-docs sync ...` (영향 epic 스코프).
- verify: data_dictionary가 모델 add/remove/필드변경 반영, design/ucs 등 영향분만 갱신.

**Step 10 — 리포트**
- `docs/reports/heroines_sync_test/2026-06-11-propagation/` 아래에 단계별 결과/매트릭스 통과표/
  발견·수정 이슈 로그 기록.

---

## 6. 루프 & 수정 프로토콜

검증 실패 시:
1. **분류**: 자동수정 가능(엔진 버그: 해시 입력 누락, candidate 오분류, orphan 미표기, 워크트리
   미전진 등) vs 사용자 결정 필요(설계 모호/스코프 변경).
2. 자동수정: `packages/core` 수정 → `npm run typecheck && npm run build` → 실패 단계부터 재실행 →
   재검증. 관련 단위 테스트가 있으면 같이 갱신.
3. 결정 필요: 한 건씩 사용자에게 질의.
4. 전 매트릭스 통과까지 반복.

**가장 유력한 첫 수정 후보**: §1.4의 "sync static-map이 워크트리를 전진시키지 않는다" 갭.
테스트에서는 수동 `checkout`으로 우회하되, 제품 플로우 결함이면 엔진에 워크트리 refresh 단계를
추가하는 수정을 제안한다(사용자 결정 필요 항목으로 분리 가능).

---

## 7. 리스크 / 열린 항목

- **codex_cli 가용성**: 미설정 시 Step 0에서 중단·보고. (대안: 에이전트 워커 lease/submit.)
- **모델 스코프**: fixture 축소 schema가 안 잡히면 351모델 폭주 → Step 1 게이트로 차단.
- **워크트리 전진 자동화 부재**: §6 첫 수정 후보.
- **fixture 현실성**: 너무 단순하면 epic/business 단계가 빈약 → 라우트 간 service/event/db 관계를
  최소 1개씩 포함해 서비스맵이 의미 있게 형성되도록 구성.

---

## 7.5 확장 목표 (2026-06-11 갱신)

원래 목표(정적→build_docs→epic→business 전파 검증) 중 epic/business **재생성 전파**가 codex quota(F-4)로 막혔다.
이를 **Claude Code 워커(스킬+워크플로우)**로 우회하고, epic/business 전파까지 끝까지 검증한다.

- **A. 스킬+워크플로우로 epic/business 생성 (codex 무관)**
  - `platty-worker` 스킬(`.claude/skills/platty-worker/SKILL.md`): CLI worker 큐(`worker next`→생성→`tasks submit`)를
    Claude Code가 직접 구동. provider-free.
  - 워크플로우: 병렬 drainer 서브에이전트가 큐를 비움(DAG 의존성은 `worker next`가 보장). codex quota 완전 우회.
- **B. epic/business sync 전파 검증 (원래 목적)** — C2 변경 주입 후 검증:
  - epic **링크/연결 수정**: 라우트 doc 변경 시 `epic_document_links` 갱신
  - epic **추가**: 새 기능영역 → 새 도메인/epic 생성
  - epic **삭제**: 기능영역 제거 → epic orphan/해제
  - **business 문서 전파**: data_dictionary(모델 변경)·design·ucl/ucs/br가 영향 epic 스코프로 갱신

검증 경로: `sync static-map → create-doc-plan → docs sync → epics sync → business-docs sync`,
각 단계 산출물(epic_document_links, epics, business documents)을 DB로 확인.

## 8. 산출물 (Deliverables)

1. heroines_back `platty-sync-test` 브랜치 (fixture C0 + 변경 C1) — 소스 레포 격리.
2. 단계별 검증 통과표(§4 매트릭스 기준).
3. 발견/수정 이슈 로그 + (있다면) `packages/core` 수정 diff.
4. `docs/reports/heroines_sync_test/2026-06-11-propagation/` 리포트.
