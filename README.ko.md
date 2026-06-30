# Platty

[English](README.md) · **한국어**

Platty는 코드베이스 리버스 엔지니어링 엔진입니다. 저장소를 읽어 코드가 실제로
하는 일 — 라우트, 데이터 모델, DB 접근, API 호출, 이벤트, 잡, 외부 서비스 — 의
소스 오브 트루스(SOT)를 추출하고, 검색하고 신뢰할 수 있는 기술·비즈니스 문서로
만들어 줍니다.

**독점 소프트웨어(오픈소스 아님) · 로컬 퍼스트 · 이 repo는 Platty 에이전트 플러그인의 공개 배포 표면입니다.**

## 여기서 시작

- Platty가 처음이신가요? **[GETTING_STARTED.md](GETTING_STARTED.md)** — CLI 설치, 에이전트 플러그인 설치, 첫 프로젝트.
- 전체 사용 설명서: **[guide/ko/usage-guide.md](guide/ko/usage-guide.md)** · English **[guide/en/usage-guide.md](guide/en/usage-guide.md)**

## Platty가 하는 일

- **코드를 로컬에서 분석** — 여러분의 머신에서 정적 분석; 소스를 업로드하거나 실행하지 않습니다.
- **소스 오브 트루스 추출** — 라우트·모델·데이터 접근·연동·이벤트를 실제 코드에 근거해 검색 가능한 지도로 만듭니다.
- **문서 생성·최신 유지** — 기술·비즈니스 문서를 만들고, 모든 서술이 실제 소스로 추적됩니다.

개념과 로컬 퍼스트 신뢰 모델은 **[guide/ko/how-platty-works.md](guide/ko/how-platty-works.md)**를 참고하세요.

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
