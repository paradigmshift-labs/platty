# Platty Search

This plugin contains one skill: `platty-search`.

It investigates screens, APIs, services, SQL, tables, columns, batches, and
change impact through an already configured Platty MCP connection. Explicit
design requests can also produce a design draft. The supplied Shinsegae I&C
PoC instructions and project reference notes are preserved.

## Install

Follow the [branch installation guide](../../GETTING_STARTED.md). This package
contains no MCP server URL, credentials, server launcher, or automatic updater.

## Invoke

Claude Code:

```text
/platty:platty-search 이 화면에서 저장하면 어떤 데이터가 바뀌는지 찾아줘.
```

Codex:

```text
$platty:platty-search 이 컬럼을 변경하면 어떤 화면과 배치에 영향이 있는지 조사해줘.
```

## Contents

- [Skill instructions](skills/platty-search/SKILL.md)
- [Project notes](skills/platty-search/references/project-notes.md)
- Seven further reference documents for clarification, investigation, impact,
  design, answer formatting, and review, loaded through the skill's instructions.

The reference documents are supporting files, not additional skills.
