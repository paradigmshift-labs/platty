---
name: notion-publish
description: Publish a confirmed BA case (JTBD, PRD, user experience) to Notion through the Notion REST API — find the right place, create one bundle page, and put the documents under it as native Notion pages. Use when the planner asks to upload, post, or share BA documents in Notion.
---

# BA Notion Publish

Run when the planner asks to put the BA documents in Notion. The documents must already be
confirmed; publishing a draft is refused — say which stage is unconfirmed instead.

All Notion calls go through `python3 scripts/notion_api.py`, which uses a Notion connection
token. It reads `NOTION_API_TOKEN` (required) and `PLATTY_BA_NOTION_HOME_DATA_SOURCE`
(optional) from the environment, then from the local settings file
`~/.config/platty-mcp/ba.env` (`PLATTY_BA_ENV_FILE` overrides the path). Every command prints
one JSON object; on failure it prints `error`, `status`, and a `hint`.

## 1. Check the connection

```
python3 scripts/notion_api.py check
```

- `error: no NOTION_API_TOKEN …` → tell the planner that the settings file is missing and stop.
- `status: 401` → the token is invalid or revoked; tell the planner to ask the Notion admin.
- `home_data_source` shows where task pages live when it is configured.

## 2. Find the place

The connection can only see pages shared with it, and it cannot create a private or top-level
page: every page it creates needs a parent page.

- **The planner gave a page link** → `notion_api.py page <link>`.
  - `is_database_row: true` → create the bundle as a child page of that row (not a new row).
  - `status: 404` → the page is not shared with the connection, or the link is a database or
    view. Ask for a task page link; with a home data source, list at most three candidates
    from `notion_api.py search "<keywords>"`.
- **No link** → `notion_api.py search "<feature keywords>"`. It searches the home data source
  when one is configured, otherwise the pages shared with the connection. Offer at most three
  results and let the planner choose. If none fits, ask for a parent page link.
- Never create database rows, never move existing pages, never edit pages you did not create.
  The script has no update or delete command.

## 3. Build the pages

1. Use the reading document beside each confirmed artifact: `01-jtbd/jtbd.md`,
   `02-prd/prd.md`, `03-user-experience/user-experience.md` (a layout-1 case keeps them flat in
   the case folder). If one is missing or older than its artifact, run
   `session.py render-docs <case>` (`platty-mcp-ba-assistant/scripts/session.py`); it changes
   no artifact.
2. Convert each: `python3 scripts/md_to_notion.py <file.md> <file.nmd>`.
3. Apply the content rules below, editing the `.nmd` file.
4. Write the bundle page's Markdown and create it first:
   `notion_api.py create --parent <task page> --title "기획 문서 — <feature>" --icon 📄 --markdown-file bundle.nmd`.
   Then create the children with `--parent <bundle id>`, **one call each, in order 1 → 2 → 3**,
   so they list in reading order:

   | Order | Title | Icon | Source |
   | --- | --- | --- | --- |
   | 1 | `1. JTBD — <jtbd title>` | 🎯 | `jtbd.md` |
   | 2 | `2. PRD — <prd title>` | 📋 | `prd.md` |
   | 3 | `3. 유저 스토리 — <user experience title>` | 🧭 | `user-experience.md` |

5. Before sending a child, scan its text for anything the converter could not know: bracket
   labels followed by parentheses, empty tables, local absolute paths, file paths outside inline
   code. Fix them in the file.

### Bundle page

A purple callout with the one-paragraph problem, then 「실험 한눈에 보기」 bullets (arms,
assignment, success, fail line, preconditions), then 원본 (the case path inside the repository)
and a note that these pages are copies. Notion-flavored Markdown indents callout children with
one tab:

```
<callout icon="💡" color="purple_bg">
	<one-paragraph problem>
</callout>
```

### Content rules

- Start every child page with a gray callout (`color="gray_bg"`): 확정 날짜, the repository
  path of the original, status.
- JTBD: keep §1–§4 whole. In §5 keep only coverage, the main evidence in plain sentences, next
  checks, and a dated change log. Leave engine review hashes, ticket lists, and confirmation
  turns in the repository.
- PRD: if 미결 질문 has no rows, write 「없음 — 결정 D-xx~D-yy로 확정」 instead of an empty table.
- 유저 스토리 means the confirmed user-experience document of this case, not an older
  `user_stories.md` of another item.
- Pain point ids may be shown with circled numbers (①~⑧) in the order of the JTBD table.
- Paths are repository-relative and written as inline code (`` `02-prd/prd.md` ``). Notion turns a
  bare file name such as `prd.md` into a web link (`http://prd.md`). Never publish a local
  absolute path.

## 4. After publishing

- Return the bundle URL and each child URL.
- If a storyboard spec exists for the case, put the child URLs in its `docs` (and the bundle URL
  in `docs_home`) and rebuild it.
- Record the URLs in the case README or handoff note so the next session can find them.

## Guardrails

- Publishing writes to a shared workspace: publish only what the planner asked for, where they
  asked for it.
- Never print, paste, or store the token or the settings file content in the chat, a case file,
  a Notion page, or the plugin.
- Pages are created by the connection, not by the planner's Notion account; say so when
  returning the URLs.
