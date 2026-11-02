# Platty Search

`feat/demo` 브랜치는 `platty` 플러그인 안에 영문 `platty-search` 스킬 하나만 제공합니다.

- [영문 통합 매뉴얼](guide/en/platty-demo.html): 스킬 설치 단계의 **Codex / Claude Code 탭**으로 전체 안내를 전환합니다. 설치 명령, 토큰 설정, MCP 연결, 스킬 호출, 질문 예시가 함께 바뀝니다.
- 실제 화면 10장이 포함된 HTML 파일 하나로 공유할 수 있습니다. 클라이언트와 Git 설치·로그인은 완료된 상태를 전제로 합니다.
- [자세한 설치 안내](USER_GUIDE.md)

```bash
codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo
codex plugin add platty@platty
```

MCP 연결 이름은 `platty`, 마켓플레이스 이름은 `platty`입니다.
서버 주소는 `https://meko-poc.platty-ai.com/mcp`이며 토큰은 별도로 제공해야 합니다.
현재 제공되는 내용은 분석된 코드와 문서 조회용입니다.

[피드백](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml).
