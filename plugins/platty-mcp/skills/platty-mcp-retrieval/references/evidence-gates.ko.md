# MCP 증거 게이트

Platty MCP 검색 결과로 사실 주장을 하기 전에 이 게이트를 적용한다.

| 증거 | 증명할 수 있는 것 | 증명할 수 없는 것 |
| --- | --- | --- |
| Vocabulary normalization | 쿼리 확장, 별칭, 후보 개념 | 비즈니스 사실이나 구현 동작 |
| Project overview | 제품 영역의 방향 잡기 | 정확한 정책, 응답 shape, 코드 동작, 전체 범위 |
| Epic map | 후보 범위와 사용 가능한 문서/spec 표면 | 최종 동작 또는 인접 후보가 없다는 증명 |
| Search hit | 후보 발견 | 그 자체로 사실 |
| BR/DD/DESIGN/UCL item | 의미 라우팅과 문서화된 의도 | 소스로 확인된 enforcement 또는 구현 |
| Document resolution | 연결된 spec과 source-near anchor | 정확한 read 없는 동작 |
| Source-near spec | 소스에 가까운 API/screen/event/schedule 동작 | spec이 얇거나 낡았거나 모순될 때의 source truth |
| Graph trace | 선택한 anchor/options에 대해 확인된 정적 edge | 빠짐없는 영향도, 특히 omitted/candidate edge가 있을 때 |
| `code_search` | 후보 파일, symbol, route, source 위치 | bounded source read 없는 정확한 구현 동작 |
| Bounded `readonly_workspace_shell` source read | 표시된 line range 안의 정확한 source evidence | 표시 범위 밖의 동작 |

## Claim Gate

- Concept explanation: 구현 주장을 하지 않는다면 vocabulary와 project/epic
  context만으로 충분할 수 있다.
- Broad domain, comparison, inventory, impact answer: 먼저 full-cycle map을
  완성한다. project overview, README류 artifact text, glossary, catalog row,
  search hit는 방향 잡기일 뿐이다.
- Business policy: business-rule item을 읽는다. enforcement를 주장하기 전에는
  연결된 spec/source를 읽는다.
- Data field meaning: data-dictionary item을 읽는다. 정확한 usage를 주장하기
  전에는 연결된 spec/source를 읽는다.
- API response shape: exact API spec을 읽는다. spec만으로 response가 충분히
  확정되지 않으면 source-level evidence를 사용한다.
- Permission, DB write, event emit, external call, negative source evidence:
  MCP 서버가 노출한다면 source-level evidence가 필요하다.
- Code behavior, scroll/timer accumulation, lifecycle handling, guard logic,
  exact implementation claim: `code_search`로 후보 위치를 찾은 뒤, 동작을
  주장하기 전에 MCP `readonly_workspace_shell`로 관련 bounded source를 읽는다.
- Broad inventory 또는 impact: 먼저 target map을 만든다. hit 하나로는
  충분하지 않다.

## Negative Claim Gate

search miss는 absence evidence가 아니다. 빈 `ssot_search`, `document_search`,
`spec_search`, `code_search`, glossary 결과만으로 concept, campaign type,
permission, API, field, screen, impact가 없다고 주장하지 않는다.

Negative claim에는 다음 중 하나가 필요하다.

- 해당 branch의 complete relevant map과 absence를 보여주는 exact item/spec read
- 구현, call, write, emit, permission, response field, code location에 대한
  주장이라면 source-level confirmation
- "does not exist" 대신 "읽은 surface에서는 확인되지 않음" 같은 명확한 boundary

## Capability Gap 문구

필수 MCP surface가 없으면 다음처럼 말한다.

```text
I can answer from the configured MCP evidence up to <surface>. I cannot confirm
<claim type> because <missing tool or tier> is not exposed by this MCP server.
```

다음처럼 말하지 않는다.

```text
I will check the local SOT folder.
I will verify outside configured MCP tools.
There is no impact.
```
