# Platty 스킬 E2E 전수 검증 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platty 스킬 9종만 보고 heroines 3개 프로젝트를 제로 상태에서 풀 파이프라인(setup→분석→큐레이션→기술문서→retrieval→에픽→비즈니스문서) 완주 가능한지 검증하고 보고서를 남긴다.

**Architecture:** 측정 작업이므로 코드 변경 없음. `~/.platty` 백업 후 워크스페이스를 제로에서 초기화하고, 프로젝트 3개(back→front→full 순)를 각각 7단계 완주한다. 각 단계는 해당 Platty 스킬을 invoke해서 따르고, 계획서는 검증·기록 절차만 규정한다.

**Tech Stack:** npm으로 전역 설치된 Platty CLI(`platty`), Claude Code Skill 툴, 스펙 `docs/superpowers/specs/2026-06-11-platty-e2e-skill-verification-design.md`

---

## ⚠️ 측정 오염 방지 — 이 계획의 핵심 규칙

이 계획서에 **운영 CLI 명령 시퀀스를 적지 않은 것은 의도적이다.** 검증 대상이 "스킬만 보고 완주 가능한가"이므로:

1. 각 단계 진입 시 해당 스킬을 Skill 툴로 **반드시 invoke**하고, 거기 적힌 절차/명령을 따른다. 이 계획서는 단계의 시작·종료 판정과 기록 방법만 정의한다.
2. 스킬에 없는 행동이 필요해지는 순간 = **finding**. 즉시 기록(아래 템플릿)하고, 최소한의 우회로 진행을 잇는다. 단, 스킬의 Stop Condition에 해당하면 우회하지 말고 멈춰서 사용자에게 보고한다 (이건 finding 아님 — 스킬이 시킨 행동).
3. CLI는 항상 npm으로 전역 설치된 `platty <command> --json`를 사용한다. 전역 CLI가 `UNKNOWN_COMMAND`/`UNEXPECTED_ERROR`를 반환하면 다른 실행 경로로 우회하지 않고 전역 CLI 재설치/재빌드 필요성을 보고한다.
4. 각 단계에서 `[Fx workaround — remove when …]` 태그 규칙이 실제 발동했는지 체크하고 기록한다 (F5/F8/F16).

### Finding 기록 템플릿 (보고서에 누적)

```markdown
### F<번호> — <한 줄 요약>     <!-- 기존 F1~F16에 이어 F17부터 -->
- 프로젝트/단계: <heroines-back / 4.기술문서>
- 증상: <명령, JSON 출력 요지>
- 분류: 스킬 결함 | CLI 결함 | 기타
- 우회: <무엇을 했나 / Stop했나>
```

---

### Task 1: 사전 점검 (Preflight)

**Files:**
- 없음 (읽기 전용 확인)

- [ ] **Step 1: 전역 CLI 설치·동작 확인**

Run: `command -v platty && platty version --json`
Expected: `platty` 경로와 `"ok": true` 버전 정보. 실패하면 전역 CLI를 다시 설치한다: `npm run build:release --workspace @pshift/platty && npm install -g ./packages/cli`.

- [ ] **Step 2: 대상 레포 3개 존재 확인**

Run: `ls -d /Users/uchangmin/Development/heroines_back /Users/uchangmin/Development/heroines /Users/uchangmin/Development/heroines-webview`
Expected: 3개 경로 모두 출력. 하나라도 없으면 STOP — 사용자에게 보고.

- [ ] **Step 3: 보고서 스캐폴드 생성**

`docs/superpowers/skill-eval/2026-06-11-platty-e2e-run.md` 생성, 내용:

```markdown
# Platty 스킬 E2E 전수 검증 — 2026-06-11

스펙: docs/superpowers/specs/2026-06-11-platty-e2e-skill-verification-design.md

## 매트릭스 (단계 완료 시 즉시 갱신)

| 단계 | heroines-back | heroines-front | heroines-full |
|---|---|---|---|
| 1. setup | | | |
| 2. 정적분석 | | | |
| 3. 큐레이션 | | | |
| 4. 기술문서 | | | |
| 5. retrieval ×3 | | | |
| 6. 에픽 | | | |
| 7. 비즈니스문서 | | | |

셀 값: ✅ PASS / ⚠️ PASS(finding 있음, F번호) / ❌ FAIL(F번호) / ⏹ STOP

## Workaround 발동 기록

| 태그 | 발동 여부 | 발동 지점 |
|---|---|---|
| F5 (nextAction에 --project/--json 누락) | | |
| F8 (멀티 repo step-only silent no-op) | | |
| F16 (build_service_map 미실행 → docs PRECONDITION_FAILED) | | |

## Findings (F17~)

## Retrieval 질의/응답 요약
```

---

### Task 2: 워크스페이스 리셋 (측정 범위 밖, 사용자 승인됨)

**Files:**
- 이동: `~/.platty` → `~/.platty.bak-2026-06-11`

- [ ] **Step 1: 백업 이동**

Run: `[ -d ~/.platty ] && mv ~/.platty ~/.platty.bak-2026-06-11 && ls ~/.platty.bak-2026-06-11`
Expected: `cache config.json platty.db state worktrees` 출력. `~/.platty.bak-2026-06-11`이 이미 존재하면 STOP — 사용자에게 보고 (덮어쓰기 금지).

- [ ] **Step 2: 제로 상태 확인**

Run: `ls ~/.platty 2>&1`
Expected: "No such file or directory". **여기서부터 측정 시작.**

---

### Task 3: heroines-back 완주 (단일 repo — 기준 경로)

레포: `/Users/uchangmin/Development/heroines_back` (NestJS backend)

각 Step 공통: ① 명시된 스킬 invoke → ② 따라서 수행 → ③ Expected 판정 → ④ 보고서 매트릭스 셀 + workaround 표 + finding 즉시 갱신.

- [ ] **Step 1: setup** — `platty:platty-project-setup` invoke. 워크스페이스 init부터 (제로 상태이므로 스킬이 init을 안내해야 함 — 안내 없으면 finding). 프로젝트 "Heroines Back" 생성, heroines_back 레포 등록.
판정: `platty status --project heroines-back --json`에 프로젝트와 레포 1개가 나타남.

- [ ] **Step 2: 정적분석** — `platty:platty-static-analysis` invoke. confirm 게이트 포함 완주.
판정: status JSON이 분석 완료를 보고하고 nextAction이 docs 계열로 넘어감.

- [ ] **Step 3: 타겟 큐레이션** — `platty:platty-docs-target-curation` invoke.
판정: 스킬의 점검 명령 기준으로 included 타겟 ≥ 1.

- [ ] **Step 4: 기술문서 생성** — `platty:platty-docs-generation` invoke.
판정: 생성된 기술문서 ≥ 1, 실패/middle-state 런 없음. doc id들을 보고서에 기록.

- [ ] **Step 5: retrieval 질의 3건** — `platty:platty-retrieval` invoke. 질의(고정):
  1. (product) "이 서비스의 핵심 도메인 기능은 무엇인가?"
  2. (dev) "인증/인가는 어떤 흐름으로 처리되는가?"
  3. (data) "핵심 엔티티와 그 관계는 무엇인가?"
판정: 3건 모두 실제 생성된 문서를 인용한 응답. 질의·응답 요지를 보고서 "Retrieval 질의/응답 요약"에 기록.

- [ ] **Step 6: 에픽 생성·confirm** — `platty:platty-epics-generation` invoke.
판정: 에픽이 confirmed 상태로 존재.

- [ ] **Step 7: 비즈니스 문서 생성** — `platty:platty-business-docs-generation` invoke. 첫 submit `--attempt`는 lease 응답의 `attemptNo` 사용.
판정: 비즈니스 문서 ≥ 1 생성 완료, 미완료 런 없음.

- [ ] **Step 8: 매트릭스 열 마감 + 커밋**

Run: `git add docs/superpowers/skill-eval/2026-06-11-platty-e2e-run.md && git commit -m "test(skill-eval): heroines-back E2E column complete"`

---

### Task 4: heroines-front 완주 (멀티 repo — F8 경로)

레포: `/Users/uchangmin/Development/heroines` (Flutter mobile, 분석 브랜치 main) + `/Users/uchangmin/Development/heroines-webview` (Next.js, 분석 브랜치 develop)

- [ ] **Step 1~7:** Task 3의 Step 1~7과 동일한 절차·판정·기록을 프로젝트 "Heroines Front"로 수행. 차이점만:
  - Step 1에서 레포 2개 등록 (워크스페이스는 이미 init됨 — 스킬이 기존 워크스페이스를 올바르게 인식하는지가 추가 관찰 포인트).
  - Step 2에서 **F8 workaround 발동 여부를 반드시 기록** (두 번째 repo의 step-only no-op — 스킬 태그 규칙이 살려내는지).
  - Step 5 질의 3건은 Task 3과 동일 문구 사용 (프로젝트 간 비교 가능하게).

- [ ] **Step 8: 매트릭스 열 마감 + 커밋**

Run: `git add docs/superpowers/skill-eval/2026-06-11-platty-e2e-run.md && git commit -m "test(skill-eval): heroines-front E2E column complete"`

---

### Task 5: heroines-full 완주 (3 repo — F16 경로)

레포: heroines_back + heroines + heroines-webview 전부, 프로젝트 "Heroines Full"

- [ ] **Step 1~7:** Task 3의 Step 1~7과 동일한 절차·판정·기록. 차이점만:
  - Step 2~4에서 **F16 workaround 발동 여부를 반드시 기록** (project-level build_service_map 미실행 → `docs start` PRECONDITION_FAILED).
  - F5 (nextAction.command에 `--project`/`--json` 누락)는 전 단계 공통 관찰 — 발동 시마다 workaround 표 갱신.

- [ ] **Step 8: 매트릭스 열 마감 + 커밋**

Run: `git add docs/superpowers/skill-eval/2026-06-11-platty-e2e-run.md && git commit -m "test(skill-eval): heroines-full E2E column complete"`

---

### Task 6: 종합 판정 + 보고서 마감

- [ ] **Step 1: 전역 판정 작성** — 보고서 상단에 결론 추가: 프로젝트별 PASS/FAIL, 전역 기준(스킬 밖 즉흥 개입 0건) 충족 여부, finding 수와 분류(스킬 결함/CLI 결함) 집계.

- [ ] **Step 2: 메모리 갱신** — `/Users/uchangmin/.claude/projects/-Users-uchangmin-Development-platty/memory/`의 `platty-skill-eval-2026-06-11.md`에 E2E 결과 한 단락 추가 (보고서 경로, 결론, 신규 finding 번호 범위). MEMORY.md 인덱스 줄도 갱신.

- [ ] **Step 3: 최종 커밋**

Run: `git add docs/superpowers/ && git commit -m "test(skill-eval): platty skill E2E verification complete"`

- [ ] **Step 4: 사용자 보고** — 매트릭스, 전역 판정, finding 요약, 백업 위치(`~/.platty.bak-2026-06-11`) 안내. 백업 복원이 필요하면 사용자 지시를 기다린다 (임의 복원/삭제 금지).

---

## 실행자 주의사항 (새 세션 핸드오프)

- 작업 디렉토리: `/Users/uchangmin/Development/platty` (이 repo에서 세션을 열어야 Platty 스킬들이 로드됨).
- 진행 중 막히면: 글로벌 `platty`가 `UNKNOWN_COMMAND`/`UNEXPECTED_ERROR`를 반환하면 전역 CLI가 stale이거나 명령이 없는 것. 멈추고 보고. `PROJECT_AMBIGUOUS` → 사용자에게 물을 것. 대안 명령을 지어내거나 다른 실행 경로로 우회하지 말 것.
- 한 단계가 FAIL이어도 같은 프로젝트의 다음 단계가 독립적으로 가능하면 finding 기록 후 계속, 불가능하면 그 열은 ⏹ 처리하고 다음 프로젝트로.
- 토큰/시간이 길어지는 작업(분석, 문서 생성)은 스킬이 안내하는 폴링 절차를 따른다 — 임의 sleep 루프 금지.
