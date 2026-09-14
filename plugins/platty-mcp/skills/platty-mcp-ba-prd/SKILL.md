---
name: prd
description: Turn a confirmed job-to-be-done into a PRD by copying the planner's judgments and asking only about the solution, under a two-question discovery budget. Use only while the session stage is prd.
---

# BA PRD

Run only when `session.py status` reports `stage=prd` and the job is confirmed.

`start --stage prd` already copied the planner's judgments. **Do not interview them again for
anything that arrived in the carry.**

## 이미 옮겨진 것 — 다시 묻지 않는다

| PRD | 출처 | 상태 |
| --- | --- | --- |
| §1 사용자 과업 | job 한 문장 | 복사됨 |
| §2 페인포인트 | §3 선택·기각과 사유 | 복사됨 |
| §7 `A-*` 가정 | `가설` 행 + **확인 방법 그대로** | 복사됨 |
| §8 `H-*` 성공 가설 | job `성공 판정` | 복사됨 |
| §9 조사 한계 | `미조사` 칸 + coverage limits | 복사됨 |

판단은 복사하고 근거는 참조한다. job 문장을 §1에 복사하는 이유는 **링크만으로는 아무도 읽지
않기 때문**이다. 경험 매트릭스는 복사하지 않는다.

## Question manifest

Before each question, create a manifest naming `stage=prd`, the active issue, the evidence, and
one intent: `solution`, `scope`, or `rules`.

**질문 예산은 2개다.** `discovery.questions_asked`가 2를 넘으면 검증기가 거부한다. 이 단계는
interview가 아니다 — 앞 단계가 interview였다.

예산을 쓰기 전에 확인할 것:

1. 답이 carry에 이미 있는가
2. 조회로 확인되는 제품 사실인가 → [BA Platty Retrieval](../platty-mcp-ba-platty-retrieval/SKILL.md)
3. 둘 다 아니고 해결 방향을 가르는 판단인가 → 그때 예산을 쓴다

## 사람이 답할 것

| 절 | 내용 |
| --- | --- |
| §3 범위 | 포함·제외. 이미 있는 기능은 조회로 확인하고 제외에 적는다 |
| §4 해결 방향 | 각 방향은 **다루기로 한 페인포인트에 연결된다.** 연결 없는 방향은 의도를 지어낸 것이라 거부된다 |
| §5 규칙·수용 기준 | 각 규칙은 해결 방향에 연결된다. `R-*` ↔ `AC-*` |
| §6 확정 결정 | `D-*`. **아래를 보라** |

## 확정 결정이 하류를 닫는다

`D-*`는 이 문서에서 가장 값나가는 칸이다. 2~3단계는 기획자에게 묻지 않으므로, 미결 질문을
덮는 것은 확정 결정뿐이다.

> 예: 스토리가 「한도 도달을 안내받는다」까지만 말해도 `D-02` 「기존 값을 그대로 쓰고 새
> 분류를 만들지 않는다」가 있으면 2단계가 스스로 닫는다. 없으면 역류가 발생한다.

확정할 수 없는 것은 §7 미결 질문(`O-*`)에 추천안·소유자와 함께 남긴다. 하류는 `O-*`를
미결로 그대로 물려받고 갈래를 지어내지 않는다.

## 흐름은 한 방향이다

**이 문서는 job에 없는 페인포인트를 만들 수 없다.** §2가 새 페인을 필요로 하면 `jtbd`로
역류(backflow)한다. 이슈를 `target: jtbd`로 열고, 기획자에게 여기서 묻지 않는다.

`H-*`가 배포 후 미달성이면 두 갈래다 — 솔루션이 틀렸거나 **job이 틀렸거나**. 후자는 `jtbd`로
돌아간다.

## 종료

각 `H-*`가 자신을 지탱하는 규칙에 연결되고, 다루기로 한 페인포인트마다 해결 방향이 있고,
범위가 채워지면 `ready_for_confirmation`이다. 확인 후 오케스트레이터가
`start --stage user_experience`를 실행한다.

## References

- `scripts/prd.py` — carry와 예산과 방향↔페인 연결을 강제한다
