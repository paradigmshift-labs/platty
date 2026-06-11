# C1 변경 주입 매트릭스 (계획 vs 관측)

베이스라인 C0(`2dc8f0109`) → 변경 C1. 모든 변경은 `src/_platty_fixture/` 내부.
관측 열은 sync 실행 후 채운다.

C0=`2dc8f0109`, C1=`4da31d6ea`. 관측은 **F-5 수정 후** create-doc-plan(S0_fixed→S1_fixed) 기준.

| # | 변경 | 기대 candidate | **관측 candidate** | 판정 |
|---|---|---|---|---|
| 1 | API 라우트 **추가** `POST /point/charge` | `new_document` | `new_document` (api_spec PointController.charge) | ✅ |
| 2 | API 라우트 **삭제** `GET /feed` | `orphan_document` | `orphan_document` (api_spec FeedController.list) | ✅ |
| 3 | API 라우트 **본문 수정** `POST /auth/login` | `stale` | `stale_candidate`* (api_spec AuthController.login) | ✅* |
| 4 | API 라우트 **경로 변경** balance→wallet | `orphan`+`new` | `orphan_document`+`new_document` (둘 다 getBalance 노드, 경로만 상이) | ✅ |
| 5 | 모델 **추가** `Badge` | `new_document` | `new_document` (data_dictionary Badge) | ✅ |
| 6 | 모델 **삭제** `PointLog` | `orphan_document` | `orphan_document` (data_dictionary PointLog) | ✅ |
| 7 | 모델 **필드 수정** `User.tier` | `stale`(또는 candidate) | `stale_candidate` (data_dictionary User) | ✅ |
| 8 | Job **삭제** `@Cron PointExpiryJob` | `orphan_document` | `orphan_document` (schedule_spec PointExpiryJob.run) | ✅ |
| 9 | 이벤트 (charge가 point.earned 추가 발행) | 발행 라우트/event 영향 | event_spec `stale_candidate` (findRelatedModels가 User에 연결 → F-6) | ✅ |

\* #3/#7이 `stale`이 아니라 `stale_candidate`인 이유: 베이스라인 docs가 **F-5 수정 이전 해싱의 S0**로 stamp돼,
재해싱된 S0_fixed와 불일치 → candidate로 강등. 동일 해싱으로 stamp된 베이스라인이면 `stale`이 됨(분류 로직 자체는 정상).

### F-5 수정 효과 (무변경 모델 false-positive 제거)
| 모델 | 수정 전(S0→S1) | 수정 후(S0_fixed→S1_fixed) |
|---|---|---|
| Feed (정의 무변경) | ❌ stale_candidate | ✅ unchanged |
| Notification (정의 무변경) | ❌ stale_candidate | ✅ unchanged |
| PointWallet (정의 무변경) | ❌ stale_candidate | ✅ unchanged |
| User (tier 추가) | stale_candidate | stale_candidate |
| Badge / PointLog | new / orphan | new / orphan |

create-doc-plan counts: 수정 전 `{unchanged:0, new:3, stale:2, staleCandidate:4, orphan:4}`
→ 수정 후 `{unchanged:3, new:3, stale:0, staleCandidate:3, orphan:4}`.

## 상호 의존성 메모
- #6(PointLog 삭제)과 #8(job 삭제)은 묶음: job의 `expireStalePoints`가 PointLog/PointWallet를 썼으므로,
  job 파일과 `PointService.expireStalePoints`를 함께 제거해야 dangling db_access가 안 생김.
- #4와 #1은 같은 point.controller.ts를 수정.

## 기대 다운스트림 전파
- build_docs sync: new→생성, orphan→deleted, stale→재생성·restamp(S1).
- epic sync: 추가/삭제 라우트 doc에 대한 epic_document_links 갱신.
- business_docs sync: data_dictionary가 Badge 추가/PointLog 삭제/User.tier 반영, 영향 epic의 design/ucs 갱신.
