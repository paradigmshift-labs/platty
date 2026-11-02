# Platty Search PoC

[English](README.md) · **한국어**

`feature/platty-plugin-develop-poc` 브랜치는 Codex와 Claude Code용
`platty` 플러그인 하나와 `platty-search` 스킬 하나를 배포합니다.

이미 연결된 Platty MCP 도구로 화면·API·서비스·SQL·테이블·컬럼·배치의 동작과
변경 영향을 조사합니다. 원본 코드로 확인한 내용과 확인하지 못한 내용을 구분하고,
설계를 명시적으로 요청한 경우에만 설계 초안을 작성합니다.

첨부 스킬의 신세계아이앤씨 프로젝트 참고 정보와 도구 전제를 유지한 PoC입니다.
`references/`의 문서 8개는 이 스킬의 참고 자료이며 별도 스킬로 등록되지 않습니다.

## 설치와 사용

[GETTING_STARTED.md](GETTING_STARTED.md)에 따라 이 브랜치를 체크아웃한 경로에서
설치하세요. 사용할 Platty MCP 서버 연결은 별도로 구성해야 합니다. 이 패키지에는
서버 주소나 인증 정보가 없으며, 검색 스킬은 CLI 대신 MCP 도구를 사용합니다.

Claude Code:

```text
/platty:platty-search 이 화면에서 저장하면 어떤 데이터가 바뀌는지 찾아줘.
```

Codex:

```text
$platty:platty-search 이 컬럼을 변경하면 어떤 화면과 배치에 영향이 있는지 조사해줘.
```

[CLI 사용 설명서](guide/ko/usage-guide.md)는 별도 CLI 워크플로의 참고 문서입니다.
이 브랜치의 플러그인에는 CLI 운영 스킬이 포함되지 않습니다.

## 라이선스 및 지원

플래티는 주식회사 패러다임시프트의 독점 소프트웨어입니다.
[LICENSE.md](LICENSE.md)를 따릅니다.
[피드백 보내기](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml).
