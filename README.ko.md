# Platty Search

`feat/demo` 브랜치는 `platty` 플러그인 안에 영문 `platty-search` 스킬 하나만 제공합니다.

- [Codex 영문 HTML 매뉴얼](guide/en/platty-demo.html): 실제 화면 6장과 단계별 확인 문구를 담았습니다.
- [Claude Code 영문 HTML 매뉴얼](guide/en/platty-claude-code.html): 실제 화면 4장으로 Git 설치, Platty 토큰 설정, MCP 연결, 스킬 호출과 첫 질문을 안내합니다.
- 각 HTML은 이미지가 포함된 파일 하나로 공유할 수 있습니다. 클라이언트와 Git 설치·로그인은 완료된 상태를 전제로 합니다.
- [자세한 설치 안내](USER_GUIDE.md)

```bash
codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo
codex plugin add platty@platty
```

MCP 연결 이름은 `platty`, 마켓플레이스 이름은 `platty`입니다.
서버 주소는 `https://meko-poc.platty-ai.com/mcp`이며 토큰은 별도로 제공해야 합니다.
현재 제공되는 내용은 분석된 코드와 문서 조회용입니다.

[피드백](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml).
