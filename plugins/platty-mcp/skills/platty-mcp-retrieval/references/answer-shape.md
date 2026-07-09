# MCP Retrieval Answer Shape

Use this reference when `platty-mcp-retrieval` answers product or implementation
questions for mixed planning and engineering readers.

## Stakeholder Answer Shape

For product or implementation questions, prefer a concise layered answer. Put
the answer first, evidence second, and uncertainty last; do not start with a
long evidence dump.

Use this shape when the user asks what changed, how something works, where to
confirm it, whether a policy or feature exists, or how to explain it to
planners and developers.

Default sections:

```text
## 현재 확인된 기준
<Explain the policy, variable, enum, API, or spec name in plain language first.>
<State confidence briefly: source-confirmed, spec-confirmed, search candidate, or partial evidence.>

## 실제 동작
- <User/operator-visible behavior>
- <System calculation or control point>
- <Exceptions, type differences, or condition branches>

## 관련 위치
- <Human-readable name + technical anchor; 2-5 entries>

## 더 확인할 후보
- <Not yet source-confirmed>
- <Product boundary to decide>
- <Follow-up surface: user screen, admin screen, batch, settlement, etc.>
```

Rules:

- Prefer 3-5 bullets per section.
- Do not split by planning/engineering unless the user asks for that split.
- Explain internal names before listing files, symbols, enums, APIs, or spec ids.
- Use "확인됨" only for exact MCP spec, document-item, graph, code, or artifact
  content reads. Artifact paths alone are not proof.
- Use "후보", "근거상 보임", or "추가 확인 필요" for search hits, partial
  specs, or inferred behavior.
- Keep every claim under the Answer Contract in `../SKILL.md`; this shape
  improves readability but does not reduce evidence requirements.

Example:

```text
User: 후기 작성 가능 시점 차이는 어떻게 봐야 해?

## 현재 확인된 기준
후기 작성 가능 시점은 `reviewUnlockDays` 값으로 계산됩니다. 이 값은 참여자가
상품을 받은 뒤 며칠 후부터 쇼핑다이어리를 작성할 수 있는지를 판단하는 기준으로
보입니다.

## 실제 동작
- 검증단은 7일 기준으로 계산되는 근거가 있습니다.
- 일반 체험단 또는 그 외 캠페인은 3일 기준으로 계산되는 근거가 있습니다.
- 계산 결과는 참여자 주문 정보의 작성 가능 시점으로 내려가는 것으로 보입니다.

## 관련 위치
- `AdminPurchaseCampaignParticipationListQueryUsecase.getCampaignOrders`
- `ShoppingDiaryPurchasesQueryUsecase.calculateStatus`
- `reviewUnlockDays`

## 더 확인할 후보
- 기준일이 배송완료일인지 구매확정일인지
- 사용자 화면 버튼 노출도 같은 기준인지
- 일반 체험단의 정확한 campaignType 범위
```
