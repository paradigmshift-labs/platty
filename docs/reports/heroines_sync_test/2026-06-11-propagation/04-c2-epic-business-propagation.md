# C2 전파 검증 — epic / business (Claude 워커, codex 무관)

베이스라인(f3, C1): 기술문서 4 + epic 3(Auth/PWB/Notif) + business 문서 20.
**전부 codex 없이 Claude Code agent-worker(워크플로우 병렬 드레이너)로 생성.**

## C2 변경 (커밋 `105766369`)
- auth 기능 제거(auth.controller/service 삭제) — epic 삭제 케이스
- Coupon 기능 추가(coupon.controller `GET /coupon/list`,`POST /coupon/redeem` + coupon.service + Coupon 모델) — epic 추가 케이스
- `GET /point/history` 추가 — epic 링크 수정 케이스

## 1. 정적 + sync 감지 (결정론적)
entry_points C1→C2: /auth/login 제거, /coupon/list·/coupon/redeem·/point/history 추가.
create-doc-plan(C1 bootstrap → S_C2):
```
unchanged 5, new 4, stale 3, staleCandidate 0, orphan 1
```
- new: Coupon(data_dictionary), /coupon/list, /coupon/redeem, /point/history
- orphan: /auth/login
- stale: event, /point/wallet, /point/charge  ← **staleCandidate 0** (F-3 수정으로 베이스라인 stamp됨)
- unchanged 5 모델 (F-5 수정으로 line-shift false-positive 없음)

## 2. docs sync 전파 (agent-worker, 6 태스크 / 2 워커)
- 결과: 활성 기술문서 = api 5(coupon/list·coupon/redeem·point/history 신규 + wallet·charge 재생성) + event 1
- /auth/login → deleted/orphaned ✓
- 6/6 saved, runStatus completed.

## 3. epics sync 전파 (agent-worker) — ★ 3 케이스 전부 검증
epics sync impact: new 3, changed 3, deleted 1.
assignment 결과(repair 포함: DUPLICATE_SYNC_EPIC → 2번째 coupon doc을 assign_existing로 수정):

| 케이스 | 결과 | 근거 |
|---|---|---|
| epic **추가** | **Coupons**(CPN) 신규 epic, coupon/list+redeem 소유 | epics.deleted_at=null, links 2 |
| epic **삭제** | **User Authentication** `deleted_at=2026-06-11T00:50:19` (soft-delete) | 유일 doc(/auth/login) orphan |
| epic **링크 수정** | **Point Wallet & Balance**에 /point/history 추가 → 소유 doc 3개 | edl 3행 |
| cross-link | charge→Notifications (event_flow) | charge가 point.earned 발행 |

confirm: confirmedCount 3, softDeletedCount 1, linkCount 6, dependencyCount 1.

## 4. business-docs sync 전파 (agent-worker, 7→9 태스크 / 2 워커)
- business sync가 **영향 epic(Coupons) + project glossary로 스코프**됨 → 증분 전파(전체 재생성 아님) 확인. ✓
- 결과: 9/9 saved(ucl_refine가 ucs 2개 파생), 0 failed. design의 mermaid가 items[].content.flow에서 파생돼
  BUSINESS_LANGUAGE_CONTAMINATION 게이트를 타는 점을 repair로 해결.
- **epic-추가 전파 ✓**: Coupons epic에 비즈니스 문서 **5개(epic) + ucs 2개** 생성, 전부 active/fresh.
- ⚠️ **epic-삭제 전파 갭(F-9)**: 아래 참조.

### F-9 [MED, ✅ 수정·검증 완료] epic soft-delete가 그 epic의 business 문서로 전파되지 않음
- 증상: `epics sync`에서 User Authentication epic이 `deleted_at`로 soft-delete됐는데, 그 epic이 소유한
  **business 문서 5개(br/data_dictionary/design/ucl/glossary)가 여전히 status=active/validity=fresh**로 남음.
- 근본 원인: epic soft-delete(`f10_persist_confirmed_epics.ts` stale 루프)는 epicDocumentLinks/dependencies는
  정리하나, 그 epic 소유 business 문서는 건드리지 않음. (build_business_docs/sync에 삭제-epic orphan 경로가
  일부 있으나 sync 드래프트 metadata 의존이라 본 시나리오에선 안 먹음.)
- 수정(Candidate A): stale 루프에서 그 epic의 business 문서를 status='deleted'/validity='orphaned'로 cascade.
  scopeId가 epic id를 포함하는 문서(epic-scope + use_case 복합) 대상, technical-track·생존 epic 문서는 미변경.
- 검증: 단위 테스트 `f10_persist_business_orphan.test.ts` 통과 + build_epics/sync 122/122. (기존 f3의 Auth 문서는
  수정 *전* 삭제돼 이미 잔존 상태였고, fix는 *이후* epic 삭제부터 적용됨.)

## 결론
정적분석 → sync 감지 → **build_docs / epic / business 전 단계 전파**를 codex 없이 Claude 워커로 end-to-end 검증.
- ✅ epic 수정(링크): Point에 /point/history 추가
- ✅ epic 추가: Coupons (+ 비즈니스 문서 7)
- ✅ epic 삭제: Auth epic soft-delete(deleted_at)
- ✅ business 증분 전파: 영향 epic 스코프로 생성
- ❌ **F-9**: epic 삭제가 그 epic의 business 문서까지는 전파되지 않음(잔존)
워커 풀의 repair 재제출 + peer 회복으로 Claude의 스키마 강제 불가도 견딤(병렬 bw/bsw 워커 다수 동시 실행 확인).
