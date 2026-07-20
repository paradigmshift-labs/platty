# Platty

[English](README.md) · **한국어**

## 바이브 코딩. 이제 브라운필드에서도 가능.

**수십만 줄의 기존 코드 위에서도, 아이디어가 자동으로 서비스가 됩니다.**

말만 하면 서비스가 뚝딱 나온다는 바이브 코딩. 왜 회사에서는 안될까요? 기존에
있던 수십만 줄의 코드와 복잡한 레거시가 얽힌 브라운필드 환경에서 바이브 코딩은
무용지물에 가깝습니다. AI한테 코드베이스 전체를 읽어서 작업하라고 하지만, 툭하면
할루시네이션. 고치는 데 시간이 더 드는 경우도 많죠. 그 사이 토큰은 녹아버리고요.

**Spec-Driven Development OS, 플래티를 써 보세요.** 아이디어는 Spec 문서로, Spec
문서는 코드로 자동으로 변환됩니다. Spec 문서는 기존 서비스와 충돌하지 않으면서도
논리적으로 완벽한 형태로 쓰여집니다. 코드도 마찬가지고요.

플래티는 마치 CTO와 CPO처럼 우리 회사를 이해할 수 있는 백과사전을 자동으로
만들어 줍니다. 기획·개발 AI Agent는 이 백과사전을 보고 작업합니다. 결과적으로
기존 서비스와 전혀 충돌하지 않으면서 논리적으로 완벽한 Spec 문서와 코드가
완성되죠.

> 플래티는 주식회사 패러다임시프트의 독점 소프트웨어입니다.

> **정적 분석 지원 현황**
>
> **실제 저장소 검증 완료:** TypeScript/JavaScript 모노레포 · Java 멀티모듈
> 저장소
>
> **프리뷰:** Kotlin · Python · Dart/Flutter
>
> [상세 지원 및 검증 범위 보기 →](guide/ko/support-matrix.md)
>
> [스택 지원 요청](https://github.com/paradigmshift-labs/platty/issues/new?template=static-analysis-support.yml)
> · [정적 분석 버그 신고](https://github.com/paradigmshift-labs/platty/issues/new?template=static-analysis-bug.yml)

## 플래티를 사용해 보세요

### 1. Platty 설치

```bash
npm install -g @paradigmshift/platty  # CLI 설치
platty install                        # 에이전트 스킬 등록
```

기존 Platty 플러그인을 갱신하려면 `platty install`을 다시 실행해 최신 게시
스킬을 받으세요. 설치 또는 갱신 후에는 새 Codex 또는 Claude Code 세션을
시작하세요.

### 2. 온보딩 시작

Platty가 현재 저장소를 등록하고 정적 분석을 실행한 뒤, 문서화 범위를 검토하고
SOT(source of truth) 생성까지 안내합니다.

#### Claude Code

```text
/platty:platty-onboarding .
```

#### Codex

```text
$platty:platty-onboarding .
```

`.`은 AI 에이전트의 현재 작업 디렉터리에 있는 저장소를 뜻합니다.

온보딩은 현재 대화 언어로 진행됩니다. 언어를 명시하려면 호출 뒤에 원하는 언어를
적어 주세요. 대화 언어가 명확하지 않으면 한국어로 진행합니다.

```text
$platty:platty-onboarding . 한국어로 진행해줘
$platty:platty-onboarding . Continue in English.
```

일반 문장으로 요청해도 됩니다:

```text
이 저장소를 Platty에 온보딩해 줘.
```

- 상세 설치 안내: [GETTING_STARTED.md](GETTING_STARTED.md)
- 사용 설명서 — 한글: [guide/ko/usage-guide.md](guide/ko/usage-guide.md) · 영어: [guide/en/usage-guide.md](guide/en/usage-guide.md)

## 아이디어 → 배포 속도를 10배 이상 빠르게

만들고 싶은 아이템이 있나요? 아이디어만 던지세요. 플래티의 기획 에이전트가 CPO
이상으로 서비스를 이해하고 자동으로 기획서(Spec 문서)를 써 줍니다.

AI 코딩, 플래티로 하면 차원이 달라집니다. 그냥 코드베이스를 읽히는 것 대비
오류는 절반 이하, 토큰 사용은 10분의 1 이하로 줄어듭니다. 코딩이 자동으로 되는
것은 당연, QA 시간이 혁신적으로 줄어듭니다.

## 서비스를 이해하는 백과사전을 자동으로 만듭니다

- **멀티 레포 정적분석으로 코드 그래프 작성** — 서비스 전체의 레포를 연결하는 코드 그래프를 자동으로 그립니다. 플래티의 정적분석 기술로 코드를 분석하기 때문에, LLM 분석 대비 정확도가 월등히 높습니다. CTO가 이해하듯이 우리 회사 코드를 정확히 이해합니다.
- **코드 그래프를 서비스 백과사전으로 요약** — 코드 그래프를 분석해 서비스 전체를 체계적으로 이해할 수 있는 자연어 문서를 만듭니다. 이 문서는 백과사전처럼 목차와 목차별 요약본이 있습니다. AI가 마치 CPO처럼 서비스를 이해하도록 해 줍니다.
- **기획·개발 에이전트가 백과사전을 보고 작업합니다** — 기존 레거시와 충돌하지 않는 결과물이 바로바로 나옵니다. 결국 회사 내에서도 바이브 코딩이 가능해집니다.

코드가 업데이트되면 자동으로 백과사전도 업데이트됩니다. 자세한 개념은
[guide/ko/how-platty-works.md](guide/ko/how-platty-works.md)를 참고하세요.

---

## 설치

```bash
npm install -g @paradigmshift/platty  # CLI 설치
platty install                        # 에이전트 스킬 등록
```

`platty install`은 `PATH`에 있는 Codex와 Claude Code를 감지해 일반
`platty@platty` 플러그인을 감지된 모든 런타임에 설치합니다. 특정 런타임만
선택하려면 `platty install --runtime codex` 또는
`platty install --runtime claude`를 사용하세요.

기존 Platty 플러그인을 갱신하려면 `platty install`을 다시 실행해 최신 게시
스킬을 받으세요. 설치 또는 갱신 후에는 새 Codex 또는 Claude Code 세션을
시작하세요.

Codex 수동 설치 대안:

```bash
codex plugin marketplace add paradigmshift-labs/platty
codex plugin add platty@platty
```

Claude Code 수동 설치 대안:

```bash
claude plugin marketplace add paradigmshift-labs/platty --scope user
claude plugin install platty@platty --scope user
```

`platty install`은 별도 `platty-mcp` 플러그인을 설치하지 않습니다.

### CLI에서 직접 시작하기

CLI 안내에 따라 설정하려면 분석할 저장소에서 `platty setup`을 실행하세요.

직접 HTTP MCP 설정은 역할별로 나누세요:

```text
Server operator:
  install/use full platty plugin -> platty:platty-mcp-server-setup

MCP consumer:
  install platty-mcp plugin -> platty-mcp:platty-mcp-client-setup
```

지원되는 MCP URL 프로필:

```text
local  -> http://127.0.0.1:3027/api/mcp
LAN    -> http://<host-ip>:3027/api/mcp
remote -> https://<context-backend-domain>/api/mcp
```

이미 구성된 Platty MCP 서버에 대해 원격 읽기 전용 조회만 필요하다면,
대신 MCP 전용 `platty-mcp` 플러그인을 설치하세요:

```bash
codex plugin add platty-mcp@platty
```

```text
/plugin install platty-mcp@platty
```

## 이 저장소

이 저장소는 Platty 에이전트 플러그인의 공개 배포 표면입니다 — Codex와 Claude
Code가 Platty CLI를 구동하는 법을 가르치는 스킬 모음입니다. Platty 엔진·CLI
구현·백엔드는 포함하지 않습니다(주식회사 패러다임시프트 독점).

전체 `platty` 스킬: `platty:using-platty`, `platty:platty-cli-router`,
`platty:platty-onboarding`, `platty:platty-setup`, `platty:platty-mcp-server-setup`,
`platty:platty-static-analysis`, `platty:platty-docs-target-curation`,
`platty:platty-generated-docs`, `platty:platty-sync`,
`platty:platty-sdd-spec`, `platty:platty-sdd-design`, `platty:platty-memory`.

이미 구성된 Platty MCP 서버에 대한 원격 MCP 조회, 영향 분석, 메모리, SDD handoff에는
`platty-mcp:using-platty-mcp`, `platty-mcp:platty-mcp-client-setup`,
`platty-mcp:platty-mcp-retrieval`, `platty-mcp:platty-mcp-impact-analysis`,
`platty-mcp:platty-mcp-memory`,
`platty-mcp:platty-mcp-sdd-spec`,
`platty-mcp:platty-mcp-sdd-design`를 포함한 `platty-mcp` 플러그인을 설치하세요.
영향 분석은 선택된 스펙, 그래프 클래스, cross-EPIC 탐색, 저장소 범위, 제한된 소스
증거를 하나의 dossier로 수렴하고 선택된 `prd.md`의 마지막 §9 부록만 소유합니다.
SDD 요청 흐름은 `prd.md`와 `user_stories.md`를 작성하며,
설계 흐름은 검토용 `system_design.md`를 먼저 작성하고 명시적 승인 후에만 해당 승인
설계에서 readiness를 분류한 `tasks.md`를 생성합니다.
`platty-mcp` 플러그인은 서버 URL이 배포마다 다르기 때문에 `.mcp.json`이나
`mcpServers`를 포함하지 않는 skills-only 플러그인입니다.

## 요구 사항

- Node.js 20–24 (Node 25는 아직 지원되지 않습니다).
- macOS 또는 Linux (Windows: 정식 지원 예정).
- 문서 생성 단계에 쓰이는 본인의 AI provider 자격 증명. 실행에 로그인·계정은 필요 없습니다.

## 라이선스 및 지원

플래티는 주식회사 패러다임시프트(Paradigm Shift Labs)의 독점 소프트웨어이며,
설치와 사용은 [LICENSE.md](LICENSE.md)를 따릅니다. 라이선스·청구·기능 문의는
공식 Platty 지원 채널을 이용하세요.
