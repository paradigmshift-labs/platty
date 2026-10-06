# Codex Dispatch

Read only when the runtime is Codex. The job split, Job Cards, collector
JSON, ledger, and audit are identical to Claude Code; only the dispatch
tools differ.

## Requirements

- Native multi-agent mode needs `spawn_agent` and `wait_agent`. `close_agent`
  frees a slot when the runtime has it (some Codex versions do not — a
  finished worker then simply ends and the next one is spawned).
- Tool missing (`spawn_agent` or `wait_agent` not listed) → run the same jobs
  sequentially in-session at once (SKILL.md Runtime modes). Worker failure
  (spawn error, timeout, malformed JSON) → re-dispatch that job once, then
  in-session. An external model CLI is never a fallback.
- Model labels (Luna / SOL class) are role preferences: map them to slugs
  from the operator's configuration; without one, ask the user once and
  record the served model and effort per job in the ledger `notes` when
  they differ; never substitute a model the user named without asking.

## Spawning a collector

| Action | Codex tool |
| --- | --- |
| Dispatch one job | `spawn_agent` with `fork_turns: "none"`, explicit `model` (Luna-class) and `reasoning_effort: "xhigh"`, self-contained prompt |
| Collect a result | `wait_agent` |
| Free a slot | `close_agent` when present |
| Verify + Answer | the main session when it is SOL / Astra class; else a SOL-class worker spawned the same way |
| Claim audit | one `spawn_agent` per question, Luna-class, `reasoning_effort: "low"`, no tools |
| Impact investigator | one `spawn_agent` per impact question instead of the code job, SOL-class, `reasoning_effort: "high"`, no call budget (below) |

`fork_turns: "none"` is mandatory: the default `"all"` rejects model and
effort overrides and hands the worker the whole session (full guide,
opposite-track results), which breaks collector isolation. Because nothing is
forked, the spawn prompt must contain everything the worker needs, inline:

1. the read-only rule (no file writes, no memory / alias / mutation tools, no
   local CLI or host shell — the Claude Code hook does not apply here);
2. the Job Card with its Session Card and Guide Brief (job-cards.md);
3. the full text of the collector skill for that track —
   `platty-mcp-doc-search/SKILL.md` or `platty-mcp-code-search/SKILL.md`;
4. the collector JSON shape and the Levels section of job-cards.md.

Concurrency = the runtime's free agent slots: count the slots the runtime
reports (the root occupies one) and keep at most `min(4, slots − 1)` workers
alive (≤ 2 docs + ≤ 2 code), rolling dispatch, the next spawn only after a
`wait_agent` return (and `close_agent` when it exists). Back off on clustered
`CONTEXT_UNAVAILABLE` / timeouts and re-dispatch only the missing jobs;
repeated `SERVER_BUSY` → one code worker. A repair is a new worker with the
`repair:` line on its card.

## Impact investigator worker

Codex has no plugin agent, so the investigator is a worker. Spawn it with
`fork_turns: "none"`, explicit model and effort (table above). Prompt = the
body of `agents/platty-impact-investigator.md` (below its frontmatter) + the
read-only rule + its card (impact.md One investigator) with the Session Card
and Guide Brief + the Claim rules, shell input rules, and Return sections of
`platty-mcp-code-search/SKILL.md` + the collector JSON shape and Levels of
job-cards.md, verbatim (nothing is forked, so "load the skill" means this
inline text). The agent body itself carries the relation checklist, asked
effects, S1–S7 criteria, and the no-candidate fallback — the same text the
Claude Code agent reads. Spawn it with the docs worker, then `wait_agent`
on both before anything else; never end the turn while it runs. A gap it
lists is one repair worker of the same kind.

## Synthesis worker (only when the main is not SOL class)

Spawn with `fork_turns: "none"`, explicit model and effort. Prompt = the body
of `agents/platty-search-synthesizer.md` (below its frontmatter — it carries
the verify ≤ 8 cap and what to write when the cap is reached) + the SKILL.md
Per-question call budget section, and pass
explicitly: the collector JSON results, the Session Card (with `today` and
`revision`), the `Q<n> → audience` list, the `asks`, `scope` readings and
Term Map per question, and the text of SKILL.md Ground rules + Core rules +
steps 5–6 (including the verify block: docs vs code → code only, mismatch
never written),
job-cards.md (Levels, Session ledger), answer-template.md, and impact.md for
an impact question. It returns the draft blocks with `[c: id]` markers and
the session ledger JSON — never the final answer. The main then runs the
claim audit and applies the verdicts.

## Claim audit worker

Prompt = the body of `agents/platty-claim-auditor.md` (below its
frontmatter) + `today` + the question's `asks` + its draft block with markers
+ the ledger entries it cites (quotes included) + its gap entries + for a block
that says "근거: Q<m> 참고", Q<m>'s 근거 items with their entries. Collect the verdict
JSON with `wait_agent`; apply every listed verdict mechanically (an unlisted
line is supported); add a 확인할 수 없는 부분 item per `asksUncovered` ask;
strip the markers; answer in the four parts of answer-template.md. Without workers, run the same checklist
in-session and write the verdict JSON before editing any sentence.

## Clarification gate on Codex

Use `request_user_input` when available; otherwise ask in the reply and stop.
Never ask in an `exec` / scripted run — answer every reading instead.
