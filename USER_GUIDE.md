# MEKO PoC: Platty setup and user guide

Version `0.0.9-meko.3` · Prepared November 2, 2026 (Asia/Seoul)

This guide is for developers using the MEKO code analysis environment. Choose
**Codex** or **Claude Code**; you do not need both. The package adds one
`platty-search` skill. Your AI client connects to the MEKO server to read
project documents and analyzed source code.

For a screen-by-screen walkthrough, open the
[illustrated HTML manual](guide/en/platty-demo.html). Its six screenshots are
embedded, so you can share that one file and read it offline. Each step explains
what to enter and what to check. Use **Enlarge screenshot** for the original
image size. The screenshots show Codex CLI on Linux.

## 1. Before you start

Codex (or Claude Code) and Git are already installed, and you are already
signed in to your AI client. This guide starts with registering the Platty
plugin. Have a MEKO PoC access token from your administrator and network
access to:

```text
https://meko-poc.platty-ai.com/mcp
```

The expected project is `petshop-full`. The token for this connection is
separate from your OpenAI/Anthropic account credentials. Request an individual
or otherwise administrator-approved token; this package does not contain one.

Examples below use Bash on macOS, Linux, or Windows WSL. Run the configuration
commands on the same computer or remote host where the AI client makes its MCP
requests. Settings on your laptop do not automatically configure a remote VM.
Edit the configuration on the execution host, including for remote sessions.

## 2. Install the plugin from Git

Git must be available. Use `feat/demo` explicitly; the default branch contains
a different distribution. Install directly from Git without a manual download
or local source-folder registration.

For Codex:

```bash
codex plugin marketplace add paradigmshift-labs/platty --ref feat/demo
codex plugin add platty@meko-poc
codex plugin list --json
```

For Claude Code:

```bash
claude plugin marketplace add https://github.com/paradigmshift-labs/platty.git#feat/demo --scope user
claude plugin install platty@meko-poc --scope user
```

The marketplace is `meko-poc`, the plugin is `platty`, and its only skill is
`platty-search`. Neither client needs the global Platty CLI. The
[standalone HTML manual](guide/en/platty-demo.html) follows the Codex path.

If another marketplace is already named `meko-poc`, inspect its source before
continuing and have your administrator resolve the conflict. Another Platty
distribution can also expose `platty-search`: disable the conflicting plugin
for the MEKO session or select this delivery explicitly rather than relying on
ambiguous automatic skill selection. Do not remove unrelated MCP connections.

## 3. Paste your Bearer token and connect

Use the token supplied by your MEKO administrator. Replace only
`YOUR_MEKO_TOKEN` in the configuration below; keep `Bearer ` and its trailing
space. If your supplied value already starts with `Bearer `, replace the whole
quoted value so the prefix appears once. Keep the filled configuration private
and out of Git, chat and support screenshots.

### Codex

Open `~/.codex/config.toml` on the host running Codex and merge:

```toml
[mcp_servers.platty]
url = "https://meko-poc.platty-ai.com/mcp"
http_headers = { Authorization = "Bearer YOUR_MEKO_TOKEN" }
```

Replace the placeholder, save the file and restart Codex. The
[Codex template](config/codex.config.toml.example) contains the same example.
If `platty` already exists, update it instead of creating a duplicate table.
When switching this entry to direct input, remove an old `bearer_token_env_var`
setting or other Authorization source. Preserve unrelated settings and servers.
The [official Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
documents static `http_headers` values.

### Claude Code

Merge the server from [claude.mcp.json.example](config/claude.mcp.json.example)
into the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "platty": {
      "type": "http",
      "url": "https://meko-poc.platty-ai.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_MEKO_TOKEN" }
    }
  }
}
```

Replace the placeholder, preserve unrelated entries, keep the filled file out
of Git, and restart Claude Code. Follow the client's project trust prompt.
If `platty` already exists in another scope, update the entry actually used by
your session. Merely installing the skill does not replace an old credential.

## 4. Verify the connection and skill

Restart `codex` or `claude` after saving your token. Start a
new session after plugin installation.

In Codex CLI, run `/skills`, choose **List skills**, and confirm
**`platty-search (platty)`** appears. Type `$platty` to filter the picker, then
press Enter on that entry. Codex inserts `$platty:platty-search` into the prompt;
this confirms the installed skill is recognized. The names were checked in
Codex CLI `0.160.0` using actual UI interaction.

Run `/mcp` in the session and check that `platty` is connected. Approve the
intended read tools if your client asks.

Send this first prompt:

```text
Use only the platty MCP connection. Check context_status and list the
authorized repositories. Confirm the project name and report unavailable
capabilities. Do not print credentials or use another MCP connection.
Answer in English.
```

The server should identify `petshop-full` (use `project_get` if its name is
not in the status response). On November 2, 2026, ten repositories were
available; their source analysis was dated October 30. Your token may have
narrower access and later snapshots can differ. A project mismatch should be
resolved with your administrator before asking project-specific questions.

Now select the installed skill from the client's skill picker, or type:

Claude Code:

```text
/platty:platty-search Explain what POST /on/ctrt/tnnt/saveCtrtTnntList does. Use only platty, answer in English, and cite source locations.
```

Codex:

```text
$platty:platty-search Explain what POST /on/ctrt/tnnt/saveCtrtTnntList does. Use only platty, answer in English, and cite source locations.
```

If your client displays a different qualified skill label, choose the
`platty-search` entry belonging to `Platty for MEKO` / `platty@meko-poc` in its
picker. The live server operations for this prompt read source; the assistant
must not execute the save API.

Successful setup means a real project/repository call and a real document or
source read succeed. A plugin appearing in a list or a green server label alone
does not verify all tools. The observed repository/capability details are in
the [project notes](plugins/platty/skills/platty-search/references/project-notes.md).

## 5. Ask useful questions

Include an exact screen/file/API/table identifier when you know one. For a
change-impact question, include what will change and the proposed value or
condition. These prompts illustrate read-only investigations:

| Goal | Example prompt |
| --- | --- |
| Read a business rule | Find the document titled "매장 휴무 및 운영 관리 업무 규칙" and explain two rules in English. Mark document-only statements. |
| Explain a screen | In pts-adm-web/SHOP/SHOP0103.xfdl, explain the save function's validation and confirmation checks. Cite the source and identify unread server-side checks. |
| Trace an API | Trace POST /on/ctrt/tnnt/saveCtrtTnntList from controller to service and SQL. List the written tables, SQL IDs, conditions, and returned values. |
| Investigate other writers | Find the APIs and batch jobs that write CTRT_TNNT_M. Report search completeness and cite the statements actually read. |
| Evaluate a planned change | I plan to change [exact column or condition] from [current] to [proposed]. Investigate affected screens, APIs, jobs, and integrations. Do not edit code or data. |

Answers should give a short English conclusion followed by a developer
appendix with repository/file/line evidence and explicit unknowns. Original
identifiers and Korean UI text remain unchanged; explanatory English labels
are translations. The assistant may ask which similarly named function you
mean before investigating it.

## 6. Understand the available evidence

This environment provides analyzed source code and project documents. It can
show code paths, SQL statements, data definitions, and documented rules. It
does not establish today's database rows, actual permissions, a successful
production execution, or current external-system behavior.

The current snapshot has three known gaps:

| Gap | What still works | What remains unverified |
| --- | --- | --- |
| Code search guide not supplied | Repository discovery, source search and exact file reads | A prewritten project-navigation guide |
| Menu context not supplied | Screen files, API and source-based tracing | Exact authorized menu paths and menu visibility |
| Scheduler data not imported | Batch source definitions and SQL | Scheduler dependency order, enabled state and actual execution times |

These gaps do not mean authentication failed. The skill records them and
continues supported reads. Results marked `needs_review`, incomplete document
coverage, unread candidates, and truncated search pages need explicit handling.
An empty incomplete search does not prove that a feature or writer is absent.

## 7. Troubleshooting

| Symptom | Check and next action |
| --- | --- |
| `401 Unauthorized` / `AUTHENTICATION_REQUIRED` | Replace the token placeholder in the active configuration. Check the exact URL, one `Bearer ` prefix and duplicate connection entries. Restart; ask the administrator to validate/reissue the token if it persists. |
| `403` or expected repositories missing | Ask the administrator to check that token's project/repository permissions. Do not substitute another connection. |
| Token was saved but the app still fails | The app or remote VM may use another environment. Edit the configuration on the actual execution host and restart the client. |
| Project is not `petshop-full` | Stop project retrieval and verify the endpoint, token scope and server default with the administrator. |
| `platty-search` is not available | Check that `platty@meko-poc` is installed, enabled and loaded in a new session. Check for another plugin exposing the same skill name. |
| The CLI does not recognize `plugin` or an installation subcommand | Check its local `--help` and use a client version that supports these plugin commands. Keep the current package; do not install a different Platty distribution as a workaround. |
| A source read says `Path does not exist` | Use the exact repository-relative path returned by source search, including its module directory. The reported sourceRoot is not an instruction to remove that prefix. |
| A search is truncated, times out or returns a lower-bound count | Narrow by repository/file type, follow cursors and read missing source ranges. The result is incomplete until those gaps are resolved. |
| Timeout or TLS/network error | Confirm access to the exact HTTPS endpoint from the execution host and check organization proxy/firewall policy. Do not disable certificate checks. |

For support, provide the client/version, execution host, connection name,
project, prompt/identifier, tool name, error code, and time with timezone.
Remove tokens, Authorization headers and confidential source excerpts from
screenshots or logs before sharing them.

## 8. Update or remove this delivery

For Codex, refresh the registered Git branch before reinstalling the plugin:

```bash
codex plugin marketplace upgrade meko-poc
codex plugin add platty@meko-poc
```

Check the installed version and start a new session. Keep the marketplace
pinned to `feat/demo` when upgrading. For Claude Code, refresh `meko-poc` in
its plugin marketplace manager and update this plugin from that marketplace.

Remove only this delivery when required:

```bash
# Codex
codex plugin remove platty@meko-poc
codex plugin marketplace remove meko-poc
codex mcp remove platty
```

```bash
# Claude Code: use the MCP scope chosen during setup
claude plugin uninstall platty@meko-poc --scope user
claude plugin marketplace remove meko-poc --scope user
claude mcp remove --scope user platty
```

For a project `.mcp.json` entry, remove only that server key from the file
instead of removing a user-scope entry. Close active sessions, remove the saved token, and have the administrator revoke it
when access should end. Uninstalling a plugin does not revoke its server token.

## References and verification scope

- [Codex Git marketplace registration](https://developers.openai.com/plugins/build/plugins).
- [Codex MCP configuration](https://developers.openai.com/codex/mcp).
- [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp) and
  [Git marketplace setup](https://code.claude.com/docs/en/plugin-marketplaces).
- Plugin command syntax was also checked using installed client `--help`.
  This package was installed successfully in isolated Codex CLI (Linux) and
  Claude Code configurations. MEKO token authorization must be checked on that
  user's machine; the publisher's authenticated connection does not provision
  a new user's access.
