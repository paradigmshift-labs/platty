<div align="right">

[🇬🇧 English](../en/usage-guide.md) · 🇰🇷 한국어

</div>

# Platty 사용 가이드

> Platty가 처음이신가요? 개념을 먼저 익히려면 [Platty의 동작
> 원리](how-platty-works.md)를 읽어 보세요. 이 가이드는 직접 따라 하는 단계별
> 매뉴얼입니다.

---

## 목차

- [요구 사항](#요구-사항)
- [로그인 불필요](#로그인-불필요)
- [CLI 설치](#cli-설치)
- [AI 프로바이더 설정](#ai-프로바이더-설정)
- [Platty를 사용하는 두 가지 방법](#platty를-사용하는-두-가지-방법)
- [출력 모드](#출력-모드-사람-vs-에이전트)
- [Platty가 데이터를 저장하는 위치](#platty가-데이터를-저장하는-위치)
- [문서를 최신으로 유지하기](#문서를-최신으로-유지하기)
- [명령어 레퍼런스](#명령어-레퍼런스)
- [문제 해결](#문제-해결)
- [지원](#지원)
- [라이선스](#라이선스)

---

## 요구 사항

| 요구 사항 | 지원 |
| --- | --- |
| **Node.js** | **20.x – 24.x** (LTS 권장). **Node 25는 _지원되지 않습니다_.** |
| **npm** | Node에 함께 번들됩니다. |
| **OS** | macOS, Linux. **Windows: 정식 지원 예정** — 지금도 동작할 수 있지만 문제가 발생할 수 있습니다. |
| **Git** | 필수 — Platty는 로컬 Git 저장소를 등록하고 분석합니다. |
| **AI 프로바이더** | 문서 생성에 필수 — [아래](#ai-프로바이더-설정)를 참고하세요. |

> ⚠️ **Node 버전 정책:** Platty는 Node **20부터 24까지**를 대상으로 합니다. Node
> 25는 아직 지원되지 않습니다 — 활성 LTS 라인(20 또는 22)을 사용하세요. 여러
> Node 버전을 관리한다면 `nvm install 22 && nvm use 22`가 안전한 선택입니다.

```bash
node --version   # must be >=20 and <25
npm --version
```

---

## 로그인 불필요

Platty는 전적으로 로컬 CLI로 동작합니다 — **로그인도, 계정도, 가입도 필요
없습니다**. 설치하고 바로 실행하면 됩니다. 코드는 여러분의 머신에서 분석됩니다
([Platty 동작 원리](how-platty-works.md) 참고).

유일한 외부 의존성은 문서 생성 단계에 쓰이는 여러분 자신의 **AI 프로바이더**이며,
자격 증명은 본인 것을 사용합니다. Platty는 오픈 소스가 아닌 독점 소프트웨어이며,
내부 사용을 위해 [PolyForm Internal Use License](../../LICENSE.md)에 따라
라이선스가 부여됩니다.

---

## CLI 설치

배포된 CLI를 전역으로 설치합니다:

```bash
npm install -g @paradigmshift/platty
```

바이너리를 확인합니다:

```bash
# macOS / Linux / Git Bash
command -v platty
platty version
platty --help
```

```powershell
# Windows PowerShell
Get-Command platty
platty version
platty --help
```

---

## AI 프로바이더 설정

정적 분석(`platty analyze`)은 완전히 로컬에서 동작하며 AI 프로바이더가 필요
없습니다.

**문서화 단계**(`platty generate-docs`)는 AI 모델을 사용해 문서를 작성하므로,
실행할 때 프로바이더를 선택합니다:

| 프로바이더 (`--provider`) | 사용하는 것 |
| --- | --- |
| `claude_api` | 여러분 자신의 Anthropic API 키. |
| `claude_code` | 로컬 Claude Code 설치본. |
| `codex_cli` | 로컬 Codex CLI 설치본. |

> 🚧 **프로바이더 목록은 확장 중입니다.** 앞으로 더 많은 AI 프로바이더가 추가될
> 예정이며, 위 세 가지가 현재 사용 가능한 프로바이더입니다.

```bash
# Generated docs default to codex_cli; pass --provider to choose another
platty generate-docs run --provider claude_api --model <model>
```

`generate-docs`는 기본값으로 `codex_cli`를 사용합니다. `claude_api` 프로바이더는
`ANTHROPIC_API_KEY` 환경 변수(또는 `~/.platty/.env`)에서 키를 읽습니다. EPIC
확인을 위해 생성이 일시 중지되면, 후속 `generate-docs confirm-epics` 명령에서도
**동일한 `--provider`를 유지하세요**.

> 💡 **비용에 관하여:** 문서화 단계는 추출된 지도를 AI 모델로 보내므로,
> 프로바이더 토큰을 소비하며 여러분의 AI 프로바이더 계정에 비용이 발생할 수
> 있습니다. 정적
> 분석 단계는 그렇지 않습니다. 대규모 프로젝트를 실행하기 전에 작은 저장소에서
> 시작해 사용량을 가늠해 보세요.

### 복구

어떤 단계에서 실패한 작업이 보고되면, `platty generate-docs retry-failed
--stage <stage> --run-id <id>`로 동일한 실행을 복구한 다음 `platty generate-docs
run`을 다시 실행하세요(미완료된 작업만 재개해 다시 추출합니다). `generate-docs
agent-next` / `agent-submit` 명령은 일반적인 첫 실행이 아니라 수동 워커 복구를
위한 것입니다.

---

## Platty를 사용하는 두 가지 방법

Platty를 구동하는 방법은 두 가지이며, 위에서 설정한 동일한 CLI와 AI 프로바이더를
함께 사용합니다. 여러분의 작업 방식에 맞는 쪽을 고르세요 — 어느 쪽이든 모든 것이
여러분의 머신에서 실행됩니다.

- **옵션 A — AI 에이전트로 Platty 구동하기**(가장 쉬움): Codex 또는 Claude Code에
  Platty 플러그인을 설치한 다음, 평범한 말로 요청하세요.
- **옵션 B — 직접 CLI 실행하기**: 명령어를 직접 입력하세요.

### 옵션 A — AI 에이전트로 Platty 구동하기

Platty는 **Codex**와 **Claude Code**용 에이전트 플러그인을 제공합니다. 설치하면
번들된 스킬이 에이전트에게 Platty 워크플로 전체를 가르쳐 줍니다 — 그래서 여러분은
원하는 것을 평범한 말로 설명하고, 에이전트가 올바른 명령어를 올바른 순서로
실행하며, 사람의 결정이 필요한 지점에서 멈춥니다.

**1. 플러그인을 설치합니다.**

Codex:

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

Claude Code:

```text
/plugin marketplace add paradigmshift-labs/platty
/plugin install platty@platty
```

**2. 스킬이 로드되도록 새 에이전트 세션을 시작합니다**(Claude Code는 세션 시작
훅도 함께 로드합니다).

**3. 그냥 요청하세요.** 예를 들면:

> "`~/code/myapp`에 있는 저장소를 분석하고 그 문서를 생성해 줘."

에이전트는 프로젝트를 확정하고, 분석을 실행하며, 문서화 대상을 검토하고, 문서를
생성합니다 — 사람의 결정이 필요한 단계에서는 여러분에게 확인을 받습니다. 명령어를
외울 필요가 전혀 없습니다. 스킬이 순서, 중단 조건, 복구를 모두 책임집니다.

> 에이전트도 여전히 `platty` CLI 설치([CLI 설치](#cli-설치) 참고)와
> [AI 프로바이더](#ai-프로바이더-설정)가 필요합니다. 플러그인은 에이전트에게
> Platty를 *어떻게* 사용하는지 가르칠 뿐, CLI를 대체하지는 않습니다.

### 옵션 B — 직접 CLI 실행하기 (실전 시나리오)

직접 구동하는 쪽을 선호하시나요? 전체 실행 과정을 소개합니다. `~/code/myapp`에
저장소가 있고 그에 대한 문서를 원한다고 가정해 봅시다.

```bash
# One-time: initialize Platty's local workspace state
platty init

# Create a project — a workspace that can hold one or more repos
platty project create "My App" --description "Repository analysis workspace"
platty project use "My App"

# Register the repository you want to understand
platty repo add ~/code/myapp

# 1) Static analysis — fully local; reads the code and builds the map
platty analyze

# 2) Review what Platty found: the APIs, screens, jobs, and events it will document
platty targets list --status active

# 3) Generate the documentation (uses your AI provider)
platty generate-docs run --provider claude_api --model <model>

# Not sure what to do next? Ask Platty at any point
platty status
```

**무엇을 얻나요:** 검색 가능한 소스 오브 트루스(source-of-truth)에 더해 기술
문서와 비즈니스 문서를 얻으며, 모든 주장은 실제 코드로 추적할 수 있습니다.
여기서부터는 `platty sync`로 문서를 최신으로 유지하고, `platty code search`와
`platty sot export`로 질의합니다(아래 참고).

> 명령어를 하나씩 입력하는 대신 안내형 대화식 흐름을 선호하시나요? `platty
> setup`을 실행하세요 — 프로젝트 생성과 저장소 등록을 단계별로 안내하고, 각
> 단계마다 다음 동작을 알려 줍니다.

> 저장소 경로는 **절대** 프로젝트 셀렉터가 아닙니다. 항상 `project create` /
> `project use`로 프로젝트를 먼저 확정하세요(또는 `--project <selector>`를
> 전달하세요).

> 💡 **Platty 프로젝트란 무엇인가요?** 프로젝트는 서로 관련된 저장소와 그로부터
> 생성된 지식을 담는 워크스페이스입니다. 새로운 제품, 앱, 또는 시스템 영역에는
> 새 프로젝트를 만드세요. 저장소가 이미 등록된 작업에 속한다면 기존 프로젝트를
> 재사용하세요. 여러 저장소가 하나의 아키텍처를 이룬다면 그 저장소들을 하나의
> 프로젝트에 추가하세요.

---

## 출력 모드 (사람 vs. 에이전트)

Platty에는 두 가지 출력 모드가 있습니다:

- **사람 모드 (기본값)** — 간결한 요약이며, 후속 명령어를 알 수 있을 때 `Next:`
  힌트를 함께 보여 줍니다.
- **에이전트 / JSON 모드 (`--json`)** — 기계가 읽을 수 있는 출력입니다. 자동화,
  스크립트, AI 에이전트는 `--json`을 전달하고 `data`, `nextAction`, `warnings`,
  `errors`, `evidenceRefs`를 읽어야 합니다.

CLI가 현재 상태와 다음 동작을 책임집니다: 대부분의 명령어는 `Next:` 힌트(또는
JSON에서는 `nextCommand` / `nextAction.command`)를 반환합니다. 반환된 그 명령어를
따라가는 것이 Platty를 구동하는 의도된 방식이며, 에이전트 스킬은 단지 이를
자동화할 뿐입니다.

```bash
platty status
platty status --json
```

> 자동화에서 기본 사람용 출력을 파싱하지 마세요 — 그 표현은 릴리스마다 바뀔 수
> 있습니다. **JSON 형태가 안정적인 계약입니다.**

---

## Platty가 데이터를 저장하는 위치

Platty는 분석 대상 저장소 내부가 **아니라** 사용자 전역 Platty 홈에 상태를
보관합니다.

| 무엇 | 기본 위치 | 재정의 |
| --- | --- | --- |
| Platty 홈 | `~/.platty` (macOS/Linux) · `%APPDATA%\Platty` (Windows) | `PLATTY_HOME` |
| 데이터베이스 (SQLite) | `~/.platty/platty.db` | `PLATTY_DB_PATH` |
| 분석 워크트리 | `~/.platty/worktrees/` | `PLATTY_WORKTREE_ROOT` |
| SOT 내보내기 | `~/.platty/sot/<projectId>/` | `--out <path>` |

CLI 설정 필드 `projectRoot`는 분석 대상 저장소가 아니라 이 상태 루트를
가리킵니다. 저장소는 `platty repo add`로 별도로 등록합니다.

---

## 문서를 최신으로 유지하기

코드가 변경된 후에는 전체를 다시 생성하는 대신 문서를 증분적으로 갱신하세요:

```bash
platty sync static-map               # refresh the static snapshot
platty sync plan                     # plan an incremental doc update
platty sync run --plan-id <plan-id>  # apply the doc sync
```

### 결과 검색하기

```bash
platty code search --symbol "createCheckoutSession"
platty sot export                    # project the SOT to a Markdown tree for grep/read
```

---

## 명령어 레퍼런스

모든 명령어는 `--json`(기계용 출력)과 `--project <selector>`(프로젝트 id, 이름,
슬러그, 또는 `current`)를 받습니다.

### 프로젝트 & 저장소

| 명령어 | 용도 |
| --- | --- |
| `platty project create <name> [--description <text>]` | 프로젝트를 생성합니다. |
| `platty project list` | 프로젝트를 나열하고 현재 프로젝트를 표시합니다. |
| `platty project use <selector>` | 현재 프로젝트를 설정합니다. |
| `platty project remove <selector> --confirm <name>` | 프로젝트를 제거합니다. |
| `platty repo add <path> [--name <n>] [--branch <b>] [--source-root <p>]` | 로컬 Git 저장소를 등록합니다. |
| `platty repo list` | 현재 프로젝트의 저장소를 나열합니다. |
| `platty repo update <selector> [...]` | 저장소 설정을 업데이트합니다. |
| `platty repo remove <selector>` | 저장소를 제거합니다. |

### 설정 & 분석

| 명령어 | 용도 |
| --- | --- |
| `platty setup` | 안내형 대화식 설정(사람 친화적). |
| `platty init [--root <path>]` | Platty 워크스페이스 상태를 초기화합니다. |
| `platty analyze [--from <stage>] [--step-only]` | 정적 분석 파이프라인을 실행합니다(로컬). |
| `platty status` | 분석 상태와 권장되는 다음 동작을 확인합니다. |

`analyze --from <stage>`는 다음 단계부터 재개합니다: `analyze_repo`,
`build_graph`, `build_pattern_profile`, `build_models`, `build_route`,
`build_relations`, `build_service_map`.

### 문서화

| 명령어 | 용도 |
| --- | --- |
| `platty targets list [--kind api\|screen\|job\|event\|all] [--status active\|deprecated\|all]` | 문서화 대상을 나열합니다. |
| `platty targets deprecate --ids <id,id>` | 대상을 폐기하고 서비스 맵을 다시 빌드합니다. |
| `platty targets include --ids <id,id>` | 폐기된 대상을 복원합니다. |
| `platty generate-docs run [--from <stage>] [--provider <p>] [--model <m>]` | 문서 파이프라인을 실행합니다(기술 문서 → EPIC → 비즈니스 문서). |
| `platty generate-docs confirm-epics --run-id <id>` | EPIC 초안을 확정하고 비즈니스 문서를 실행합니다. |
| `platty generate-docs status --run-id <id>` | 문서 실행/단계를 확인합니다. |
| `platty generate-docs retry-failed --run-id <id>` | 복구를 위해 실패한 작업을 리셋합니다. |
| `platty generate-docs report --run-id <id>` | 소요 시간, 토큰, 실패를 보고합니다. |

### 동기화

| 명령어 | 용도 |
| --- | --- |
| `platty sync static-map` | 정규 정적 맵 스냅샷을 갱신합니다. |
| `platty sync plan` | 스냅샷으로부터 문서 동기화 계획을 생성합니다. |
| `platty sync run [--plan-id <id>]` | 증분 문서 동기화를 실행합니다. |
| `platty sync confirm --plan-id <id> --epics-run-id <id>` | 동기화를 확정하고 적용합니다. |

### 검색, 그래프 & SOT

| 명령어 | 용도 |
| --- | --- |
| `platty code search --symbol <query> [--repo <id>] [--limit <n>]` | 이름/경로/시그니처로 코드 노드를 검색합니다. |
| `platty code snippet --repo <id> --file <path> --lines <start>-<end>` | 범위가 지정된 소스 조각을 읽습니다. |
| `platty graph view [--out <path>]` | 독립형 프로젝트 그래프 HTML 뷰를 빌드합니다. |
| `platty graph trace --from <node-id> [--direction downstream\|upstream] [--depth <n>]` | 노드로부터 서비스 맵 엣지를 추적합니다. |
| `platty sot export [--out <path>]` | SOT를 Markdown 폴더 트리로 투영합니다. |

### 지식 / 메모리

| 명령어 | 용도 |
| --- | --- |
| `platty memory add --content <text> --kind <why\|correction\|constraint\|context>` | 문서/EPIC에 고정된 사람 지식을 기록합니다. |
| `platty memory list` / `show --memory <id>` / `update --memory <id> --reason <text>` / `delete --memory <id> --reason <text>` | 메모리를 관리합니다. |
| `platty memory questions list` / `answer --id <id> --content <text>` / `dismiss --id <id> --reason <text>` | 지식 간극을 해소합니다. |

### 실행 & 유틸리티

| 명령어 | 용도 |
| --- | --- |
| `platty runs list` / `show` / `status` / `cancel` / `release` | 파이프라인 실행과 락을 확인하고 관리합니다. |
| `platty version` | CLI 버전을 표시합니다. |
| `platty uninstall` | 제거 단계를 보여 주고 선택적으로 상태를 삭제합니다. |

---

## 문제 해결

| 증상 | 해결 |
| --- | --- |
| `command not found: platty` | 전역 설치를 확인하세요(`command -v platty`). `npm install -g @paradigmshift/platty`로 재설치하세요. |
| 존재해야 할 명령어인데 `UNKNOWN_COMMAND`가 발생 | 설치된 CLI가 낡았습니다 — `@paradigmshift/platty`를 업데이트하세요. |
| Node 25에서 오류 / 크래시 | Node 25는 지원되지 않습니다. Node 20–24로 전환하세요(`nvm use 22`). |
| "A repository path is not a project selector" | 프로젝트를 먼저 확정하거나(`platty project use <name>`), `--project <selector>`를 전달하세요. |
| 다음에 무엇을 할지 불명확함 | `platty status --json`을 실행하세요 — 권장되는 다음 동작을 보고합니다. |

종료 코드: `0` 성공 · `1` 복구 가능한 실패(재시도 가능) · `2` 검증/사용자 오류.

---

## 지원

라이선스, 결제, 또는 기능 관련 문의는 공식 Platty 지원 채널을 이용하세요. 문제를
신고할 때는 다음을 포함해 주세요:

- 사용 중인 런타임(에이전트를 사용 중이라면 에이전트 런타임/버전도),
- 운영 체제,
- `platty version`의 출력,
- 실패한 정확한 명령어,
- 전체 오류 출력.

---

## 라이선스

Platty는 **독점**(proprietary) 소프트웨어이며(오픈 소스가 아닙니다), 여러분의
내부 사용을 위해 [PolyForm Internal Use License](../../LICENSE.md)에 따라
라이선스가 부여됩니다. 거기에서 명시적으로 허용되지 않는 한, 이를 재배포,
서브라이선스, 판매, 호스팅하거나 제3자에게 제공할 수 없으며, 경쟁 제품 또는
서비스를 제공하는 데 사용할 수 없습니다.

---

## 함께 보기

- **[Platty의 동작 원리](how-platty-works.md)** — 개념, 2단계 모델, 그리고
  로컬 우선 신뢰 모델.
- **[지원 매트릭스](support-matrix.md)** — 지원되는 언어, 프레임워크, ORM, HTTP
  클라이언트, SaaS 벤더.
