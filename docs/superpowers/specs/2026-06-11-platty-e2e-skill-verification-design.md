# Platty 스킬 E2E 전수 검증 — 설계

날짜: 2026-06-11
상태: 사용자와 합의된 설계 (실행 계획: `docs/superpowers/plans/2026-06-11-platty-e2e-skill-verification-plan.md`)

## 목표

Platty 스킬 카탈로그(9종, `platty-corpus-quality` 제외)만 보고 — 즉흥 우회 없이 — heroines 3개 프로젝트를 제로 상태에서 풀 파이프라인 완주할 수 있는지 검증한다.

같은 날 선행 작업과의 차이:
- 행동 평가(`docs/superpowers/skill-eval/2026-06-11-platty-skill-tree-measurement.md`): 스킬별 **단위** 측정 → 10/10 PASS
- 스킬 개선(`docs/reports/2026-06-11-platty-skill-improvement-results.md`): Stop Conditions/Invariants/Red Flags 적용
- **이번**: 개선된 스킬로 "연결된 실전 흐름"이 끊기지 않는지 검증

## 검증 대상 스킬 (9종)

`using-platty`(엔트리), `platty-cli-router`, `platty-project-setup`, `platty-static-analysis`, `platty-docs-target-curation`, `platty-docs-generation`, `platty-retrieval`, `platty-epics-generation`, `platty-business-docs-generation`

제외: `platty-corpus-quality` (픽스처 코퍼스 작업용 — 프로젝트 파이프라인과 무관)

## 준비 (측정 범위 밖)

1. `~/.platty`를 `~/.platty.bak-2026-06-11`로 **백업 이동** (사용자 승인됨 — 되돌리기 가능)
   - 근거: CLI에 `project delete`가 없음 (create/list/use/status뿐). 상태가 `~/.platty/platty.db` SQLite에 있어 개별 삭제는 DB 수술이 필요 → 전체 리셋이 안전. 사용자가 "기존 프로젝트 삭제 후 동일 이름 재생성"을 선택함.
2. 이후 `platty init`부터가 측정 대상 (워크스페이스 초기화도 검증 범위)

## 실행 매트릭스 (순차, 단순한 것부터)

| 순서 | 프로젝트 | 레포 | 검증 포인트 |
|---|---|---|---|
| 1 | heroines-back | `/Users/uchangmin/Development/heroines_back` (NestJS backend) | 단일 repo 기준 경로 |
| 2 | heroines-front | `/Users/uchangmin/Development/heroines` (Flutter mobile, branch main) + `/Users/uchangmin/Development/heroines-webview` (Next.js, branch develop) | 멀티 repo — F8 workaround 실전 발동 |
| 3 | heroines-full | 위 3개 레포 전부 | 최대 규모 + F16 workaround |

### 프로젝트당 7단계

1. **setup** — `platty-project-setup` 스킬로 프로젝트 생성 + 레포 등록
2. **정적분석** — `platty-static-analysis`, confirm 게이트 포함 완주
3. **타겟 큐레이션** — `platty-docs-target-curation`
4. **기술문서 생성** — `platty-docs-generation`
5. **retrieval 질의 3건** — `platty-retrieval`, product/dev/data 카테고리 각 1건
6. **에픽 생성·confirm** — `platty-epics-generation`
7. **비즈니스 문서 생성** — `platty-business-docs-generation`

각 단계 진입 시 해당 스킬을 Skill 툴로 invoke하고 그대로 따른다.

## 운영 규칙

- `using-platty` 코어 룰 준수: 로컬 빌드 CLI(`node packages/cli/dist/main.js`) 사용, `--json`, `nextAction.command` 추종, Stop Conditions.
- 글로벌 npm `platty`는 stale — 절대 사용하지 않는다.
- 스킬의 Stop Condition에 걸리면 우회하지 않고 멈춰서 사용자에게 보고 (스킬이 시킨 행동이므로 finding 아님).
- business-docs submit 계약: 첫 submit `--attempt`는 lease 응답의 `attemptNo`(보통 0).

## 합격 기준

- **프로젝트별 PASS**: 7단계 산출물 전부 존재 — 분석 완료 상태, 기술문서 생성됨, retrieval 응답이 실제 문서 인용, 에픽 confirmed, 비즈니스 문서 생성됨.
- **전역 PASS**: 스킬 밖 즉흥 개입 0건. 개입이 필요했던 지점은 전부 finding으로 기록하고 "스킬 결함 / CLI 결함"으로 분류.
- F5/F8/F16 workaround 태그(`[Fx workaround — remove when …]`) 발동 여부를 단계마다 체크 — 향후 CLI 수정 시 회수 근거.

## 산출물

`docs/superpowers/skill-eval/2026-06-11-platty-e2e-run.md`:
- 프로젝트(3) × 단계(7) 매트릭스
- finding 목록 — 기존 F1~F16에 이어 F17부터 번호 부여
- F5/F8/F16 workaround 발동 기록
- retrieval 질의/응답 요약

## 알려진 지뢰 (선행 측정에서 발견, 미수정 CLI 버그)

- **F8**: 멀티 repo 프로젝트에서 `platty run --step-only`가 두 번째 repo부터 silent no-op (status가 confirm_required 미보고) — 스킬에 workaround 있음
- **F16**: step-only가 project-level `build_service_map`을 실행하지 않아 `docs start`가 `PRECONDITION_FAILED` — 스킬에 workaround 있음
- **F5**: `nextAction.command`에 `--project`/`--json` 누락 — 스킬 룰로 재부착
