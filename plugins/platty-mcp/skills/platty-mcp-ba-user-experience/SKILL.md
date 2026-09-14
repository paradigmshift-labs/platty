---
name: user-experience
description: Derive role-based Heroines journeys, states, branches, exceptions, and recovery from a confirmed PRD without interviewing the planner. Use only while the session stage is user_experience.
---

# BA User Experience

Run only when `session.py status` reports `stage=user_experience` and the upstream artifact is
confirmed.

**This stage asks the planner nothing.** The planner's intent is already in `jtbd.json` and
`prd.json`; this stage reads it, not the planner. `session.py ask --kind interview` is refused
here. The only question you may create is the final `confirmation`.

## Derivation manifest

Before writing any row, record where it comes from. A row with no upstream citation is not a
row — it is a backflow.

| 만드는 것 | 상위 출처 |
| --- | --- |
| 여정 단계 | PRD §4 해결 방향 · 사용자 스토리 · JTBD 6칸의 **칸 안 시간 순** 행 |
| 분기 | PRD §5 `R-*` / `AC-*` |
| 예외 | JTBD `뭐가 안 되나` · 스토리의 예외 흐름 |
| 화면 요구 | JTBD `필요 경험` (채널 중립 그대로) · PRD §4 |
| 상태 | 디자인 팩 역할의 `stateContract` (`standard_derived`) |
| 복구 | 스토리의 복구 문장 · usability `N09` |

Cite each with `provider: prd` or `provider: jtbd` and `kind: imported`. The controller accepts
these providers; `provider: user` does not belong in this stage.

## 막혔을 때 — 묻지 말고 닫거나 돌려보낸다

Three moves, in this order.

1. **확정 결정이 답을 갖고 있는지 본다.** PRD §6 `D-*`는 미결 질문을 덮는다. 예: 스토리가
   「한도 도달을 안내받는다」까지만 말해도 `D-02`가 「기존 값을 그대로 쓰고 새 분류를 만들지
   않는다」면 답은 나와 있다. 이 경로가 파생이 성립하는 주된 이유다.
2. **상위가 이미 미결로 표시했는지 본다.** PRD §7 `O-*`는 그대로 미결로 옮긴다. 갈래 수가
   `O-*`에 달린 분기는 갈래를 지어내지 않고 미결로 남긴다.
3. **그래도 답이 없으면 역류(backflow)한다.**

   ```
   session.py backflow <case> --to prd --question <상위가 답할 질문> --reason <파일> --area <영역>
   ```

   기획자에게 지금 묻지 않는다. 역류는 확인을 막지만 **나머지 파생은 계속한다** — 답에
   의존하지 않는 것은 다 만들고 멈춘다.

**상태 계약은 예외다.** 로딩·빈 결과·일부 로드·추가 로드 실패는 PRD에 없어도 끌어온다.
제품 의도가 아니라 구현의 필연이므로 역류가 아니라 `standard_derived`로 받는다.

## Scope

Keep element-level layout, animation timing, and focus behavior for screen behavior unless they
change the user journey itself. Write `필요 경험`을 채널 중립으로 — `알림`·`버튼`·`화면`·`팝업`이
들어가면 솔루션이 샌 것이다.

## Completion

Update and assess the experience artifact after each derivation pass, not after an answer.
**확인 질문을 만들지 않는다.** 검증이 `ready_for_confirmation`에 닿으면 컨트롤러가 스스로
확정하고 `start_screen_behavior`를 낸다. 기획자는 여기서 멈추지 않는다 — 그 판단은 이미
JTBD와 PRD에서 끝났다.

## References

- [파생 검증 실행](../../../artifacts/derivation-runs/reciprocate-received-support/stage2-user-experience.md)
  — 이 규칙으로 실제 PRD를 돌린 기록. 질문 0, 상위로 닫힌 항목 33, 역류 4.
