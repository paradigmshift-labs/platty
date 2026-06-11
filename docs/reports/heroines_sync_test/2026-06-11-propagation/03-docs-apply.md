# 기술문서 sync apply 검증 (build_docs 전파, apply 측)

## 구동 경로 (CLI)
create-doc-plan 이후 기술문서 재생성은 **`docs start --sync-plan <planId>` (incremental 'sync2' 모드)**가 구동.
별도 `apply` 명령은 미노출이며, orphan 삭제/restamp/신규생성은 다음으로 처리됨:
- orphan → `docs start` plan 시점에 자동 `markOrphanDocument`(status=deleted, validity=orphaned)
- new / stale(_candidate) → 워커가 재생성 후 `persistDocument`(restamp)
- `stale_candidate`는 `--include-stale-candidates` 필요(아니면 review_needed로 보류)

명령 시퀀스:
```
platty run                       # build_service_map freshness 새로고침 (F-3 churn 회피)
platty docs start --sync-plan <planId> --include-stale-candidates
platty docs approve --run-id <id>
platty docs run --run-id <id> --provider codex_cli
```

## 결과 (S0_fixed→S1_fixed plan 적용)

incremental 계획: `task_planned:4, new:3, stale_candidate:3, orphan:4, unchanged:3, orphaned_without_task:3`.

최종 documents 상태:

| 대상 | 변경 | 상태 | stamp |
|---|---|---|---|
| api_spec /point/charge | 신규 | passed/fresh | S1_fixed ✅ |
| api_spec /point/wallet (getBalance) | 경로변경 신규 | passed/fresh | S1_fixed ✅ |
| api_spec /auth/login | 본문수정 | 재생성·restamp (old-S0→S1_fixed) | S1_fixed ✅ |
| event_spec point.earned | 변경 | 재생성·restamp | S1_fixed ✅ |
| api_spec /point/balance (구) | 경로변경 구 | **deleted/orphaned** | (old) ✅ |
| api_spec /feed | 삭제 | **deleted/orphaned** | ✅ |
| schedule_spec job | 삭제 | **deleted/orphaned** | ✅ |

- 활성 문서 4개 = C1 entry point 4개와 정확히 일치.
- new 생성 / orphan 삭제 / stale 재생성·restamp 전부 정상.

## 결론
**build_docs 전파(apply 측)는 정상 동작.** 단 매 실행 전 `platty run`으로 build_service_map을
새로고침해야 하는 제약(F-3 freshness churn)이 있음.
