# Platty

[English](README.md) · **한국어**

**브라운필드에서 하는 바이브 코딩.**

AI 코딩은 빈 저장소에선 잘 되지만 실제 코드베이스에선 무너집니다 — 기존
시스템을 모르기 때문입니다. Platty는 여러분의 실제 코드베이스에서 살아있는
소스 오브 트루스(SOT) 스펙을 역추출해, AI 에이전트가 기존 것을 망가뜨리지 않고
계획·스펙 작성·변경 반영을 하도록 합니다.

→ 이미 가지고 있는 코드에서 시작하는 스펙 주도 개발(SDD).

**독점 소프트웨어(오픈소스 아님) · 로컬 퍼스트 · 이 repo는 Platty 에이전트 플러그인의 공개 배포 표면입니다.**

## 여기서 시작

- Platty가 처음이신가요? **[GETTING_STARTED.md](GETTING_STARTED.md)** — CLI 설치, 에이전트 플러그인 설치, 첫 프로젝트.
- 전체 사용 설명서: **[guide/ko/usage-guide.md](guide/ko/usage-guide.md)** · English **[guide/en/usage-guide.md](guide/en/usage-guide.md)**

## Platty를 선택하는 이유

- **파일이 아니라 기능으로 말하세요** — 동료에게 말하듯 던지면("환불 흐름이 건드리는 걸 전부 찾아서, 그 위에 부분 환불을 설계해줘"), Platty가 그걸 *실제로 구현한 코드*에 — 모든 서비스에 걸쳐 — 연결합니다.
- **'대충'이 아니라 완전하고 근거 있게** — Platty는 시스템 전체의 *미리 추출된 증거 연결 지도*에서 작업하므로, 일반 에이전트가 놓치는 다운스트림 이벤트·권한 동기화·폐기된 경로까지 스펙에 들어갑니다. 모든 줄이 소스를 인용하니, 틀리면 고칠 수 있습니다.
- **팀 전체의 단일 진실** — 같은 스펙이 기술 문서와 비즈니스 문서를 함께 만들어, 엔지니어와 리더가 같은 사실 위에서 일합니다.

*일반 코딩 에이전트는 그때그때 검색된 것에서 답하고, 못 본 것은 자신 있게 놓칩니다. Platty는 여러분의 시스템이 이미 하고 있는 것의 완전한 소스 기반 지도에서 시작해, 그것을 자연어로 다듬게 합니다.*

**동작 방식:** 코드베이스를 로컬에서 분석 → 소스 오브 트루스 스펙 추출 → AI 에이전트가 그 스펙을 기준으로 계획·스펙·구현 → 코드가 바뀌면 문서가 동기화. 개념과 로컬 퍼스트 신뢰 모델은 **[guide/ko/how-platty-works.md](guide/ko/how-platty-works.md)**를 참고하세요.

## 빠른 설치

CLI 설치 (Node.js 20–24; Node 25는 아직 지원되지 않습니다):

```bash
npm install -g @paradigmshift/platty
platty version
```

런타임에 맞는 에이전트 플러그인 설치:

```bash
# Codex
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

```text
# Claude Code
/plugin marketplace add paradigmshift-labs/platty
/plugin install platty@platty
```

플러그인 설치/업데이트 후에는 최신 스킬이 로드되도록 새 에이전트 세션을
시작하세요. 그런 다음 분석할 저장소에서 다음을 실행합니다:

```bash
platty setup
```

`platty setup`은 프로젝트 선택/생성과 저장소 등록을 돕고, 매 단계에서 다음
동작을 안내합니다. 전체 명령어 레퍼런스와 에이전트 / CLI 사용 흐름은
[사용 가이드](guide/ko/usage-guide.md)에 있습니다.

## 문서

전체 제품 문서는 [`guide/`](guide/) 폴더에 영어와 한국어로 있습니다:

| 주제 | 한국어 | English |
| --- | --- | --- |
| Platty 동작 원리 (개념, 로컬 퍼스트) | [KO](guide/ko/how-platty-works.md) | [EN](guide/en/how-platty-works.md) |
| 사용 가이드 (설치, AI provider, 명령어) | [KO](guide/ko/usage-guide.md) | [EN](guide/en/usage-guide.md) |
| 지원 매트릭스 (언어, 프레임워크, 벤더) | [KO](guide/ko/support-matrix.md) | [EN](guide/en/support-matrix.md) |

## 이 저장소

이 저장소는 **Platty 에이전트 플러그인의 공개 배포 표면**입니다 — Codex와
Claude Code가 Platty CLI를 구동하는 법을 가르치는 스킬 모음입니다.

**담는 것:** Codex·Claude Code 플러그인 매니페스트, `plugins/platty/skills/`
아래 Platty 스킬, Claude Code 세션 시작 훅, 마켓플레이스 메타데이터.

**담지 않는 것:** Platty 엔진, CLI 구현, 백엔드, SaaS 서비스, 비공개 기획
문서 — 이들은 Paradigm Shift Labs의 독점 자산입니다.

포함 스킬: `platty:using-platty`, `platty:platty-cli-router`,
`platty:platty-setup`, `platty:platty-static-analysis`,
`platty:platty-docs-target-curation`, `platty:platty-generated-docs`,
`platty:platty-sync`, `platty:platty-retrieval`, `platty:platty-sdd-spec`,
`platty:platty-sdd-design`, `platty:platty-memory`. 어떤 워크플로인지 모를
때는 `platty:using-platty`부터 시작하세요.

```text
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
plugins/platty/
  .codex-plugin/plugin.json
  .claude-plugin/plugin.json
  README.md
  hooks/
  skills/
guide/
```

## 요구 사항

- Node.js 20–24 (Node 25는 아직 지원되지 않습니다).
- npm.
- macOS 또는 Linux. Windows: 정식 지원 예정 — 지금도 동작할 수 있지만 문제가 발생할 수 있습니다.
- `PATH`에 `platty` CLI, 그리고 플러그인용 Codex 또는 Claude Code.
- 문서 생성 단계에 쓰이는 본인의 AI provider 자격 증명. Platty 실행에 로그인·계정·가입은 필요 없습니다.

## 라이선스 및 지원

Platty는 독점 소프트웨어(오픈소스 아님)이며, 설치와 사용은
[LICENSE.md](LICENSE.md)를 따릅니다. 여기서 명시적으로 허용하지 않는 한
재배포, 서브라이선스, 판매, 호스팅, 제3자 제공, 또는 경쟁 제품·서비스 제공에
사용할 수 없습니다.

라이선스·청구·기능 문의는 공식 Platty 지원 채널을 이용하세요. 플러그인 설치
문제는 에이전트 런타임·버전, 운영체제, `platty version` 출력, 실패한 명령,
전체 오류 출력을 포함해 알려주세요.
