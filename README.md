# Platty Search PoC

**English** · [한국어](README.ko.md)

The `feature/platty-plugin-develop-poc` branch distributes one plugin,
`platty`, containing one skill, `platty-search`, for Codex and Claude Code.

The skill investigates screens, APIs, services, SQL, tables, columns, batches,
and change impact using configured Platty MCP tools. Answers distinguish
source-confirmed behavior from unverified information. Design drafts are
included only when explicitly requested.

This PoC retains the supplied skill's Shinsegae I&C project notes and tool
assumptions. The eight files under `references/` support the single skill;
they are not separately registered skills.

## Install and use

Follow [GETTING_STARTED.md](GETTING_STARTED.md) to install from this branch's
checkout. Configure access to the intended Platty MCP server separately; this
package contains no server URL or credentials. The search skill uses MCP tools
instead of running the Platty CLI.

Claude Code:

```text
/platty:platty-search 이 화면에서 저장하면 어떤 데이터가 바뀌는지 찾아줘.
```

Codex:

```text
$platty:platty-search 이 컬럼을 변경하면 어떤 화면과 배치에 영향이 있는지 조사해줘.
```

The [CLI usage guide](guide/en/usage-guide.md) documents the separate CLI
workflow; CLI operator skills are not included in this branch's plugin.

## License and support

Platty is proprietary software of Paradigm Shift Labs. See [LICENSE.md](LICENSE.md).
[Report feedback](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml).
