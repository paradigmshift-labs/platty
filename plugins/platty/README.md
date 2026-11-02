# Platty Search for MEKO

This plugin contains one English skill: `platty-search`, with eight reference
files. It investigates screens, APIs, services, SQL, data definitions, batch
source, and change impact through the configured **`platty`** MCP connection.
It checks that the project is the expected `petshop-full` before retrieving
project content. Design drafts require an explicit request.

Follow the [installation guide](../../GETTING_STARTED.md) or the
[HTML manual](../../guide/en/platty-demo.html). MCP authentication is separate
from plugin installation. No access token or automatic updater is included.

In Codex, select the `platty-search` skill or use:

```text
$platty:platty-search Explain what POST /on/ctrt/tnnt/saveCtrtTnntList does. Use only platty, answer in English, and cite the source.
```

In Claude Code, use `/platty:platty-search` with the same question.

- [Skill instructions](skills/platty-search/SKILL.md)
- [MEKO project reference](skills/platty-search/references/project-notes.md)

The eight reference documents support this one skill; they are not separate skills.
