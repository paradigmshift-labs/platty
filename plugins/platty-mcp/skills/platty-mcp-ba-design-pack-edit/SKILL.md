---
name: design-pack-edit
description: Change what the Heroines design knowledge pack contains — tokens, components, screen roles, recipe rules, principles, usability checks, reference screens — through the upstream seeds that produce it, then build and verify a new pack version. Use when a designer wants to fix, add, or remove something in the design system.
---

# 디자인 지식 팩 수정

## 먼저 알아야 할 것: pack.json은 고칠 수 없다

엔진이 행마다 해시를 `upstream-manifest.json`과 대조한다(`validatePackProvenance`).
손으로 고치면 **바뀐 팩이 나오는 게 아니라 로드되지 않는 팩이 나온다**.

그리고 팩이 읽는 12개 소스 파일도 대부분 고칠 수 없다 — 그것들도 빌드 산출물이다.
사람이 고치는 것은 그 위의 **씨앗**이다.

```
씨앗 수정 → 상류 재생성 → build-pack.py → 새 버전 팩 → 사람 승인 → 새 케이스가 채택
```

## 언제나 doctor부터

```sh
python3 scripts/pack_edit.py doctor
```

이 머신에서 무엇이 가능하고 무엇이 막혔는지 말한다. **막힌 것을 우회하지 않는다.**

| 검사 | 막히면 |
| --- | --- |
| `upstream_present` | 상류 체크아웃이 없다 → `--source-root` 또는 `BA_DESIGN_PIPELINE_SOURCE_ROOT` |
| `sibling_repos` | `heroines-design-system`·`heroines-webview`가 없다 → **토큰과 컴포넌트 계약은 불가능** |
| `upstream_matches_pack` | 상류가 앞서 있다 → 아직 반영 안 된 변경이 있다 |
| `recipe_roles_exist` | 발화 못 하는 레시피가 있다 → **빌드 자체가 거부된다. 먼저 고친다** |
| `pack_approved` | 미판정이 남았다 → 그 위의 도출은 미승인 합성이다 |

## 무엇을 어디서 고치나

```sh
python3 scripts/pack_edit.py route            # 전체 표
python3 scripts/pack_edit.py route role       # 하나만
```

| 대상 | 씨앗 | 재생성 |
| --- | --- | --- |
| `token` | HDS 저장소 `core.tokens.json`, `user.semantic.json` | `scripts/tokens.py` |
| `component-contract` | HDS/WebView TypeScript 소스 | `extract-ui.mjs`, `component-source.mjs` |
| `component-promote` | `tools/design-pipeline/component-knowledge.json` | 없음 |
| `role` | `expansion/type-guidance.json` | `expansion/build-rulebook.py` |
| `recipe` | `inputs/recipe-decisions.json` | `scripts/recipes.py` |
| `principle` | `design/required/principles.json` | 없음 — 정본 파일 |
| `usability` | `design/required/usability.json` | 없음 — 정본 파일 |
| `reference` | `inputs/figma-*.json` | `scripts/inventory.py`, `archive-expansion.py` |

`route`가 각 대상의 **규칙**도 같이 준다. 규칙을 읽지 않고 씨앗을 고치면 빌드가 거부하거나,
더 나쁘게는 통과하고 틀린 팩이 나온다.

## 컴포넌트 승격 — 가장 자주 필요한 것

계약이 팩에 있다는 것과 와이어프레임이 쓸 수 있다는 것은 **다르다**.
팩에는 컴포넌트 계약이 수백 개 있지만 엔진이 쓸 수 있는 건 `componentKnowledge`에 있는 것뿐이다.
엔진이 `supportedStates`를 함께 요구하는데, 그것은 파서가 만들어내지 못하는 사람의 판단이다.

```sh
python3 scripts/pack_edit.py promote-component \
  --component Radio --role checkbox \
  --states "visible,checked,disabled,focus,value,invalid" \
  --source-path components/props.json \
  --origin upstream-derived-contract \
  --interface-file "src/libs/hds/base/controls/radio/Radio.tsx" \
  --interface-name RadioProps --kind hds-interface \
  --limitation "Closed RadioProps are validated; label ReactNode and onChange callback are not." \
  --dry-run
```

**반드시 `--dry-run`으로 먼저 본다.** 검사하는 것:

- `--states`는 엔진의 10개 상태 축 안에만 있어야 하고 `visible`을 포함해야 한다.
  엔진이 단정할 수 없는 축은 지원 상태가 아니다.
- `--interface-*`를 주면 팩의 `componentProps`에 실재해야 한다. 없으면 엔진이 계약을 못 찾는다.
- `--origin upstream-derived-contract`는 닫힌 인터페이스를 가리켜야 한다.
  인터페이스가 없으면 그것은 `ba-authored-adapter`다. **라벨을 섞으면 팩 로드가 거부된다.**
- `--source-path`는 팩이 빌드하는 12개 소스 중 하나여야 한다. 아니면 revision을 기록할 수 없다.
- `--limitation`은 이 행이 **약속하지 않는 것**을 적는다. 빈칸으로 두지 않는다.

승격은 `component-knowledge.json`을 바꿀 뿐이고, **새 팩을 빌드해야 반영된다.**

## 빌드

```sh
python3 scripts/pack_edit.py build --version heroines/2026-11-20 --regenerate role,recipe
```

- **버전은 항상 새 날짜다.** 팩은 불변 판본이다. 같은 버전을 덮어쓰면 그 팩을 쓰던 모든
  케이스가 `hash mismatch`로 깨지고 승인이 `stale`이 된다. `--overwrite`는 그래서 있고,
  사용자가 그것을 명시적으로 요구할 때만 쓴다.
- `--regenerate`에 고친 대상만 적는다. 적지 않은 것은 상류의 현재 산출물을 그대로 쓴다.
- 빌드 뒤 **엔진으로 실제 로드해 본다**. provenance가 깨지면 여기서 잡힌다.
- 실패하면 만들다 만 디렉터리를 남기지 않는다.

## 빌드 다음에 남는 일

빌드는 끝이 아니다. 순서대로:

1. **사람 승인** — `python3 scripts/pack_approval.py`. 팩 버전마다 한 번, 팩 해시에 묶인다.
   승인 없이는 그 위의 3단계 도출 전체가 미승인 합성 위에 놓인다.
2. **검토 화면** — `python3 scripts/pack_review.py <새 버전>`, 디자이너가 눈으로 본다.
3. **차이 확인** — `python3 scripts/pack_edit.py diff <이전> <새 버전>`.

## 기존 케이스는 자동으로 옮겨가지 않는다

진행 중인 케이스는 `knowledge_binding`에 팩 버전이 박혀 있어 옛 팩으로 계속 돈다.
freeze된 run은 당시 팩 기준의 증거로 영원히 남는다 — 소급 수정하지 않는다.

새 팩을 쓰려면 **3단계부터 다시 도출한다.** 3단계가 화면·상태·조판을 팩에서 가져오므로,
팩이 바뀌면 그 도출 자체가 무효다.

## 하지 않는 것

- `pack.json`·`upstream-manifest.json` 직접 편집
- 참조 저장소(`heroines-*`) 쓰기 — 읽기 전용이다
- 막힌 경로를 우회해서 값을 지어내기. 토큰이 안 고쳐지면 **안 고쳐진다고 말한다.**
  브랜드 색을 추측하면 반드시 틀리고, 그 화면은 기획자에게 거짓 정보가 된다
- 손으로 `status`를 `approved`로 적기 — 승인은 `pack_approval.py`가 기록한다

## References

- [검토 화면](../platty-mcp-ba-design-pack-review/SKILL.md)
- [4단계 와이어프레임](../platty-mcp-ba-design-system-wireframe/SKILL.md) — 이 팩을 실제로 쓰는 곳
- [팩 빌더](../platty-mcp-ba-assistant/design-pipeline/scripts/build-pack.py)
- [승격 목록](../platty-mcp-ba-assistant/design-pipeline/component-knowledge.json)
