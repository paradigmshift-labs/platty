# Impact Analysis Pressure Scenarios

These twelve immutable scenarios preserve Task 1's RED baseline. Each exact
prompt is copied without paraphrase. Task 7 executes these same entries; do not
replace them with API or screen micro-tests.

## ordinary-policy

**Exact prompt**

```text
Platty MCP 근거로 체험단 참여 제한 정책이 무엇인지 설명해줘. 영향도나 설계문서는 필요 없어.
```

- **RED failure**: None; retrieval-only routing passed, but unavailable MCP prevented the policy read.
- **Expected GREEN route**: `using-platty-mcp -> platty-mcp-retrieval`; do not escalate to impact.
- **Owner reference**: `platty-mcp-retrieval` question routing.
- **Observable pass criteria**: An ordinary policy answer remains retrieval-only and does not create a packet or dossier.

## broad-impact

**Exact prompt**

```text
Platty MCP 근거로 체험단 참여 제한 정책을 바꾸면 영향받는 EPIC, API, 화면, 서비스, 코드와 테스트를 전부 찾아줘. 한 검색 결과에서 멈추지 마.
```

- **RED failure**: The full-cycle retrieval route had no Impact Seed Packet or Impact Dossier.
- **Expected GREEN route**: `using-platty-mcp -> platty-mcp-retrieval(routeMode: seed-only) -> platty-mcp-impact-analysis`.
- **Owner reference**: `impact-seed-packet.md` and `impact-dossier.md`.
- **Observable pass criteria**: One reusable seed packet drives a dossier that classifies EPIC, API, screen, service, code, and test evidence without stopping at one search hit.

## sdd-premature-design

**Exact prompt**

```text
prd.md와 user_stories.md가 승인됐다고 가정하고 system_design.md를 만들어줘. graph, API/screen, cross-EPIC, repository, source gate는 아직 완료되지 않았어.
```

- **RED failure**: None; source-parity protection already blocked premature hard implementation claims.
- **Expected GREEN route**: `platty-mcp-sdd-design` consumes a current impact dossier before hard claims.
- **Owner reference**: `impact-dossier.md` completion gate.
- **Observable pass criteria**: Incomplete graph/API-screen/cross-EPIC/repository/source gates retain candidates and limits rather than produce hard design claims.

## grep-candidate

**Exact prompt**

```text
readonly_workspace_shell의 grep에서 후보 파일 하나를 찾았다고 가정해. 아직 exact source region은 읽지 않았어. 구현 위치를 확정해줘.
```

- **RED failure**: None; the grep hit remained a candidate until an exact source read.
- **Expected GREEN route**: Select repository, run bounded shell search, then read the exact source region.
- **Owner reference**: `impact-seed-packet.md` workspace discovery.
- **Observable pass criteria**: The implementation location is classified candidate and names the bounded exact read needed for promotion.

## graph-candidate

**Exact prompt**

```text
graph_trace가 unresolved relation candidate 하나를 반환했다고 가정해. 이 대상을 확정 영향으로 분류해줘.
```

- **RED failure**: None; unresolved graph relation stayed unconfirmed.
- **Expected GREEN route**: Preserve the graph candidate and seek exact graph, spec, or source evidence.
- **Owner reference**: `impact-dossier.md` evidence matrix.
- **Observable pass criteria**: The target stays candidate, not confirmed, with missing evidence and a next exact read.

## cross-epic-cycle

**Exact prompt**

```text
EPIC A가 EPIC B에 영향을 주고 B가 A를 참조한다고 가정해. 확정 관계를 보존하면서 순회가 어떻게 종료되는지 설명해줘.
```

- **RED failure**: None; confirmed edges were retained while repeated expansion ended.
- **Expected GREEN route**: Traverse confirmed cross-EPIC evidence with visited state.
- **Owner reference**: `cross-epic-traversal.md` traversal rules.
- **Observable pass criteria**: Both confirmed directed edges remain, the revisit is recorded, and traversal terminates.

## adjacent-candidate

**Exact prompt**

```text
EPIC A의 후보 관계가 EPIC B를 가리키고 B가 C를 가리킨다고 가정해. 후보만으로 C까지 재귀 확장해줘.
```

- **RED failure**: None; candidate chains were not promoted into confirmed recursive impact.
- **Expected GREEN route**: Preserve the adjacent candidate without expansion.
- **Owner reference**: `cross-epic-traversal.md` traversal rules.
- **Observable pass criteria**: C remains a candidate or next read, never a recursively confirmed impact target.

## depth-frontier

**Exact prompt**

```text
A -> B -> C가 확정이고 C -> D도 아직 방문하지 않은 확정 frontier라고 가정해. 기본 depth 2 결과와 남은 범위를 설명해줘.
```

- **RED failure**: The frontier was visible but no dossier status or truncation record existed.
- **Expected GREEN route**: Confirmed traversal stops at `maxDepth: 2` and persists the frontier.
- **Owner reference**: `cross-epic-traversal.md` and `impact-dossier.md`.
- **Observable pass criteria**: A through C are recorded, C to D is retained as a named frontier, truncation is recorded, and status is partial.

## stale-impact

**Exact prompt**

```text
prd.md와 user_stories.md는 승인됐지만 impact.md의 source commit이 현재 workspace commit과 다르다고 가정해. hard implementation claim이 포함된 system_design.md를 만들어줘.
```

- **RED failure**: None; hard implementation claims were blocked until source parity refresh.
- **Expected GREEN route**: Refresh bounded source evidence through configured MCP surfaces before design claims.
- **Owner reference**: `impact-dossier.md` source parity.
- **Observable pass criteria**: Commit drift is named, source parity is partial, and unrefreshed hard claims are omitted or weakened.

## missing-workspace-tools

**Exact prompt**

```text
workspace_repo_list와 readonly_workspace_shell이 없다고 가정해. 로컬 Platty CLI나 로컬 SOT로 대체해서 완전한 영향도를 만들어줘.
```

- **RED failure**: Local fallback was refused, but no owner produced the required partial dossier.
- **Expected GREEN route**: Preserve MCP-only boundaries and return a partial dossier.
- **Owner reference**: `impact-dossier.md` boundary outcomes.
- **Observable pass criteria**: The missing surfaces are named, no local CLI/SOT fallback occurs, and coverage is explicitly partial.

## request-handoff

**Exact prompt**

```text
MCP 근거로 결제 쿠폰 기능 prd.md와 user_stories.md를 남겨줘. 나중 설계에서 재사용할 코드·graph·cross-EPIC 검색 결과도 보존해줘.
```

- **RED failure**: No impact artifact or planner-safe reference existed.
- **Expected GREEN route**: `platty-mcp-sdd-spec` invokes impact analysis, writes `impact.md`, and adds a compact request link.
- **Owner reference**: `impact-dossier.md` persisted impact artifact.
- **Observable pass criteria**: `impact.md` retains the full evidence packet while `prd.md` contains only the status link and a user-relevant limit.

## direct-vs-escalated

**Exact prompt**

```text
같은 변경 질문을 한 번은 platty-mcp-impact-analysis에 직접, 한 번은 platty-mcp-retrieval을 통해 실제 실행해. 호출된 skill 순서와 packet 재사용 여부를 call trace로 남기고 retrieval 재진입 횟수를 보고해줘.
```

- **RED failure**: Direct impact analysis was undefined and retrieval had no reusable packet or dossier contract.
- **Expected GREEN route**: Direct impact invokes retrieval in `routeMode: seed-only`; escalated impact reuses that returned packet.
- **Owner reference**: `impact-seed-packet.md` runtime invocation context.
- **Observable pass criteria**: Both actual call traces converge on one packet shape and the same dossier process; the retrieval-escalated path reuses the packet with zero retrieval re-entry.
