# Platty Search — MEKO 데모

`feat/demo` 브랜치는 `platty` 플러그인 안에 영문 `platty-search` 스킬 하나만 제공합니다.

- [영문 HTML 설치·사용 매뉴얼](guide/en/platty-demo.html): 실제 화면 7장과 단계별 확인 문구를 담았습니다. 이미지가 포함된 HTML 파일 하나로 공유할 수 있습니다.
- [자세한 설치 안내](USER_GUIDE.md)

```bash
codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo
codex plugin add platty@meko-poc
```

MCP 연결 이름은 `platty`, 마켓플레이스 이름은 `meko-poc`입니다.
서버 주소는 `https://meko-poc.platty-ai.com/mcp`이며 토큰은 별도로 제공해야 합니다.
현재 제공되는 내용은 분석된 코드와 문서 조회용입니다.

[피드백](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml).
