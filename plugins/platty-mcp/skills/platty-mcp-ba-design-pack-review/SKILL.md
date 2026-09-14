---
name: design-pack-review
description: Render the Heroines design knowledge pack — tokens, components, screen roles, recipe rules, principles, reference screens — as one HTML page a designer can open and judge. Use when someone asks to see, review, or check what the design system currently contains.
---

# 디자인 지식 팩 검토 화면

팩은 4단계 와이어프레임이 쓸 수 있는 **전부**다. 여기 없는 색은 못 쓰고, 여기 없는
컴포넌트는 못 그린다. 그런데 팩은 20만 줄짜리 JSON이라 사람이 읽을 수 없다.
이 스킬은 그것을 한 장의 HTML로 만든다.

```sh
python3 scripts/pack_review.py                       # 최신 팩
python3 scripts/pack_review.py heroines/2026-09-09    # 특정 버전
python3 scripts/pack_review.py -o /tmp/review.html    # 다른 위치로
```

기본 출력은 `design-knowledge/<pack-id>/<version>/pack-review.html`이다.
만든 뒤 **경로를 알려주고 열어보라고 말한다.** 내용을 대신 요약해서 승인을 받지 않는다 —
이 팩의 존재 이유가 "텍스트로 설명하고 넘어가지 말 것"이다.

## 무엇을 보여주나

| 절 | 내용 |
| --- | --- |
| 토큰 | semantic 색(실제 칩 + 흰 배경 대비비), palette 원시값, 타이포 실물 샘플, 간격·조판 막대, radius·shadow·sizing·motion |
| 컴포넌트 | 승격된 컴포넌트를 **4단계 엔진과 같은 마크업으로** 그리고 상태 축마다 변형을 보인다. 아래에 아직 승격 안 된 계약 목록 |
| 화면 역할 | 23개의 when · 구성 순서 · 상태 계약 · 조판 계약 · 예외 |
| 레시피 규칙 | must / must_not / optional |
| 원칙과 검사 | 설계 원칙 33개, 사용성 검사 10개 |
| 참조 화면 | Figma·확장 프레임 스크린샷. 축소판은 위쪽만 보이므로 **전체 화면 열기**로 본다 |
| 출처 | 각 컬렉션이 상류 어느 파일에서 왔는지 |

## 이 화면이 숨기지 않는 것

- **승인 배너.** 미판정이 남아 있으면 맨 위에 경고가 뜬다. 역할 행은
  `AI synthesis; human approval pending`, 레시피는 `draft`다. 승인 전에는 3단계가 뽑는
  화면 목록 전체가 사람이 확인하지 않은 합성 위에 놓인다.
- **행마다 한계(limitation).** BA가 쓴 어댑터와 상류에서 파생된 계약을 태그로 구분한다.
  이걸 안 보면 추정을 정본으로 읽는다.
- **팩 자신의 `must_not`.** 이 문서는 반복 항목을 카드로 두르지 않고 구분선 리스트로 그린다.
  금지 규칙을 설명하는 문서가 그 규칙을 어기면 아무도 안 지킨다.

## 디자이너가 결함을 찾으면

이 스킬은 **읽기 전용**이다. 팩은 판본이라 제자리에서 수정되지 않는다.
고치려면 `/ba-design-pack-edit`으로 넘긴다. 무엇을 어디서 고치는지는
`python3 scripts/pack_edit.py route <대상>`이 답한다.

토큰 값이 틀렸다고 해서 이 저장소에서 고칠 수 있는 것이 아니다. 토큰 정본은 HDS
저장소이고, 이 워크스페이스에는 그 저장소가 없을 수 있다 — `pack_edit.py doctor`가 먼저
가능/불가능을 말한다.

## 주의

- 글꼴은 보는 사람 기계에 설치된 것으로 렌더된다. 자간·줄바꿈은 실제 제품과 다를 수 있다.
- 대비비는 알파를 **흰 배경에 합성한 뒤** 계산했다. 다른 배경 위에서는 다르다.
- 막대 길이는 그 그룹 안에서의 비율이다. 절대 크기가 아니라 옆의 px 값이 정본이다.

## References

- [팩 승인](../../../scripts/pack_approval.py) — 팩 버전마다 한 번, 팩 해시에 묶인다
- [팩 수정](../platty-mcp-ba-design-pack-edit/SKILL.md)
- [4단계 와이어프레임](../platty-mcp-ba-design-system-wireframe/SKILL.md) — 이 팩을 실제로 쓰는 곳
