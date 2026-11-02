# Getting Started with Platty Search

This branch provides the `platty` plugin with only the `platty-search` skill.
It retains the supplied Shinsegae I&C PoC reference notes and uses an already
configured Platty MCP connection for code search and change impact investigation.

## 1. Check out the PoC branch

```bash
git clone --single-branch --branch feature/platty-plugin-develop-poc https://github.com/paradigmshift-labs/platty.git
cd platty
```

Use the absolute path to this checkout in the commands below. Registering the
repository without selecting this branch would use the default branch instead.
If a marketplace named `platty` is already registered, change its source to this
checkout before installing the plugin.

## 2. Install the plugin

### Codex

```bash
codex plugin marketplace add /absolute/path/to/platty
codex plugin add platty@platty
```

### Claude Code

```bash
claude plugin marketplace add /absolute/path/to/platty --scope user
claude plugin install platty@platty --scope user
```

Restart the agent session after installation so the new skill is discovered.
The plugin version is recorded in `plugins/platty/VERSION` and both plugin
manifests. It contains no automatic updater that switches back to `main`.

## 3. Connect Platty MCP

Configure the intended Platty MCP server in your runtime separately. Server
URLs and credentials are deployment-specific and are not bundled here.
The skill expects tools such as `context_status`, `workspace_repo_list`,
`code_search_guide_get`, `workspace_search`, and `readonly_workspace_shell`.
Use the server's current tool availability as the source of truth.

The search skill does not require the global Platty CLI and does not configure
or start a server. See the separate [CLI guide](guide/en/usage-guide.md) for
operator workflows.

## 4. Ask a question

Claude Code:

```text
/platty:platty-search 이 화면에서 저장하면 어떤 데이터가 바뀌는지 찾아줘.
```

Codex:

```text
$platty:platty-search 이 컬럼을 변경하면 어떤 화면과 배치에 영향이 있는지 조사해줘.
```

The skill and its eight reference documents live in
[`plugins/platty/skills/platty-search/`](plugins/platty/skills/platty-search/).
The project notes describe the supplied PoC environment and may differ from
the currently connected server.
