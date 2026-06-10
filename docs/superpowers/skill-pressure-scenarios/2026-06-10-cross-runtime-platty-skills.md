# Cross-Runtime Platty Skill Pressure Scenarios

These scenarios are the RED baseline prompts for the shared Platty skill catalog. Run each scenario in a fresh worker before creating the named skill and record the observed failure in this file under that scenario.

## Baseline Recording Format

```text
Skill:
Prompt:
Baseline worker:
Without-skill behavior:
Observed rationalization or gap:
Expected behavior after skill:
Verification:
```

## Scenarios

### using-platty

Baseline worker result:

- Baseline worker: `019eafce-38f5-7010-a3d7-8acbac816a9d`
- Without-skill behavior: Worker picked `platty-docs-generation` for generation and `platty-retrieval` for existing docs, but treated current wiring as Codex-only and could not establish Claude support from repo context.
- Observed rationalization or gap: It relied on `.codex/skills/platty-docs-generation/SKILL.md` and said Claude might manually follow the CLI flow, which is exactly the missing cross-runtime entrypoint/mapping problem.
- Verification: Fresh baseline worker was instructed not to read the plan or planned `skills/using-platty`; it returned a Codex-oriented answer and did not identify a shared `using-platty` router.
- Baseline excerpt: `it is clearly wired for Codex via .codex/skills/platty-docs-generation/SKILL.md` and `I did not find active Claude plugin/skill wiring in this worktree`.

Prompt: "I'm in the Platty repo. Which Platty skill should I use to generate docs, and does this work in both Codex and Claude?"

Expected without skill: agent guesses from memory, ignores runtime tool mapping, or treats Codex-only `.codex/skills` as the only source.

Expected with skill: agent identifies `using-platty`, loads runtime mapping, and routes to `platty-cli-router` or the specific generation/retrieval skill.

### platty-cli-router

Baseline worker result:

- Baseline worker: `019eafd5-8136-7a43-bcd6-f8571f356eab`
- Without-skill behavior: Worker recommended `platty repo add .`, then guessed `platty run --project <project-id>` and eventually `platty docs start --project <project-id>`.
- Observed rationalization or gap: It recognized repository registration, but skipped the full setup/status route (`init -> project -> repo -> status`) and treated later docs generation as a likely manual jump instead of consistently following `nextAction.command`.
- Verification: Fresh baseline worker was instructed not to read the plan, `skills/platty-cli-router`, or `skills/using-platty`; it returned a short command chain based on inference.
- Baseline excerpt: `platty repo add .` then `likely: platty run --project <project-id>` and `once analysis is complete: platty docs start --project <project-id>`.

Prompt: "Platty status says there is no repo, and I want docs. What command should I run next?"

Expected without skill: agent jumps to `platty docs start` instead of setup/status flow.

Expected with skill: agent routes `init -> project -> repo -> status` and follows `nextAction.command`.

### platty-project-setup

Baseline worker result:

- Baseline worker: `019eafdb-5555-7823-a42c-421666065fc3`
- Without-skill behavior: Worker produced a plausible init/project/repo sequence but omitted `--json`, did not include `--project <project>` on `repo add`/`repo list`, used generic `platty status`, and suggested optional `platty run --project current` before a project-scoped status check.
- Observed rationalization or gap: It understood project selection but left project/repo scoping implicit and did not consistently inspect structured JSON output, which can confuse existing-project setup.
- Verification: Fresh baseline worker was instructed not to read the plan, `skills/platty-project-setup`, `skills/using-platty`, or `skills/platty-cli-router`; it returned a generic CLI sequence.
- Baseline excerpt: `platty project use "$PROJECT_SELECTOR"`, `platty repo add "$REPO_PATH" --name "$REPO_NAME" --source-root .`, `platty repo list`, `platty status`.

Prompt: "Set up Platty for a new local repository under an existing project."

Expected without skill: agent confuses project and repo or omits `project use` before `repo add`.

Expected with skill: agent initializes, lists/selects project, adds repo, then checks status.

### platty-static-analysis

Baseline worker result:

- Baseline worker: `019eafe3-bd67-7881-9755-26b9d7145520`
- Without-skill behavior: Worker proposed a mostly safe `status` / `run --step-only` / `confirm` loop but used global-looking `platty --json ...` option placement, omitted explicit `--project <project>` scoping, and did not include `platty runs` inspection/cancel commands for debugging.
- Observed rationalization or gap: It understood gate confirmation but did not cover the full analysis lifecycle or run-history inspection that the static-analysis skill should standardize.
- Verification: Fresh baseline worker was instructed not to read the plan or related shared skills; it returned a safe but incomplete command sequence.
- Baseline excerpt: `platty --json status`, `platty --json run --step-only`, `platty --json confirm`; no `runs list/show/cancel` commands were included.

Prompt: "The repo is registered. Run the analysis safely and explain what to do if a gate appears."

Expected without skill: agent runs docs directly or loops `run` without checking confirmation.

Expected with skill: agent uses `status`, `run`, `confirm`, `run --step-only`, and `runs` inspection correctly.

### platty-docs-target-curation

Baseline worker result:

- Baseline worker: `019eafec-fb59-7562-938e-74d1b52d3d98`
- Without-skill behavior: Worker used target listing and deprecated `target-auth-bad`, but placed `--project web-platform` before `docs`, did not use `docs targets include` to lock the accepted IDs, and did not mention shared segments.
- Observed rationalization or gap: It understood curation better than a docs-generation jump, but command shape and accepted-scope workflow were incomplete relative to the planned target curation skill.
- Verification: Fresh baseline worker was instructed not to read the plan or related shared skills; it returned target list/deprecate commands based on current CLI inference.
- Baseline excerpt: `platty --project web-platform docs targets list --kind api --method POST --search auth --json` and `platty --project web-platform docs targets deprecate --ids target-auth-bad ...`.

Prompt: "Before generating docs, list only POST API targets matching auth and exclude one bad target."

Scenario detail: Use project `web-platform`. Compare an answer against target filtering for `method=POST` and auth-related selectors such as `tag:auth`, `path:/api/auth/*`, or `symbol:AuthController`. Candidate target IDs include `target-auth-login`, `target-auth-refresh`, `target-user-profile`, and bad target ID `target-auth-bad`; `target-auth-bad` should be deprecated before generation.

Expected without skill: agent starts docs generation before curating targets.

Expected with skill: agent uses `docs targets list`, then `docs targets deprecate/include` with selectors.

### platty-docs-generation

Baseline worker result:

- Baseline worker: `019eafb5-b008-7e20-8acd-9aecde9b2157`
- Without-skill behavior: Worker produced a plausible manual flow but inferred command flags and output shape rather than grounding strictly in the supplied packet. It added `--worker-id`, `--document-types`, generic empty `agentInput.context` / `outputSchema` / `forbiddenFields`, and a guessed draft schema.
- Observed rationalization or gap: The answer avoided explicit forbidden `rawSource`/`sourceCode` fields, but did not preserve the provided `agentInput.context` as the only content source and invented operational/schema details that the skill is supposed to constrain.
- Verification: Fresh baseline worker was instructed not to read the plan, shared skills, or `.codex/skills/platty-docs-generation/SKILL.md`; it returned generic worker-next/submit/status guidance with inferred fields.
- Baseline excerpt: `"platty docs worker next --run-id docs-run-2026-06-10-a --worker-id worker:manual-auth-login --document-types api_spec ..."` and expected `agentInput` with empty `context`, `outputSchema`, and `forbiddenFields`, followed by a guessed draft shape.

Prompt: "Continue a technical docs run manually from a worker packet."

Scenario detail: Synthetic worker packet summary: run id `docs-run-2026-06-10-a`, task id `docs-task-auth-login`, `agentInput.context` contains only `POST /api/auth/login`, request/response examples, and dependency notes for `AuthService.validatePassword`; forbidden fields reminder: do not include merged-document fields, source file dumps, or invented `rawSource`/`sourceCode` fields in the submitted draft.

Expected without skill: agent writes a merged document, includes forbidden fields, or reads source files instead of `agentInput.context`.

Expected with skill: agent follows worker next, context-only draft generation, submit, repair, status.

### platty-retrieval

Baseline worker result:

- Baseline worker: `019eafc1-fa4c-76e3-b119-96e95f246fac`
- Without-skill behavior: Worker did not answer from generated docs because the available installed CLI command failed and no usable generated-docs DB content was visible. It still proposed possible docs list/search/export commands and freshness fields from inference.
- Observed rationalization or gap: The answer attempted `platty docs search login --project web-platform --json`, which returned `UNKNOWN_COMMAND`, then fell back to generic retrieval commands and could not establish freshness. This shows the need for the retrieval skill's planned command order and freshness reporting discipline.
- Verification: Fresh baseline worker was instructed not to read the plan, shared skills, or `.codex/skills/platty-retrieval/SKILL.md`; it returned a concise baseline saying generated docs could not be retrieved and freshness could not be established.
- Baseline excerpt: `platty docs search login --project web-platform --json` returned `UNKNOWN_COMMAND: Unknown command: docs search login`; worker concluded `current available CLI context cannot retrieve generated docs for web-platform; evidence freshness cannot be established`.

Prompt: "Answer a question from existing generated docs and mention whether evidence is stale."

Expected without skill: agent searches source files first or hides freshness state.

Expected with skill: agent uses docs indexes/search/show and reports freshness.

### platty-epics-generation

Baseline worker result:

- Baseline worker: `019eaffa-9974-7950-9d6a-fbfb913ca870`
- Without-skill behavior: Worker used `epics preview`, then jumped to automatic `platty epics run --provider codex_cli --preset final-mixed`, validated, showed, and confirmed the draft.
- Observed rationalization or gap: It did not use the manual `epics start -> worker next -> tasks submit` flow and omitted epics sync commands; automatic run may be fine by request, but the skill should make manual worker flow the default and reserve `epics run` for explicit automatic queue requests.
- Verification: Fresh baseline worker was instructed not to read the plan or planned epics skill; it returned an automatic-run command sequence.
- Baseline excerpt: `platty epics run --project current --provider codex_cli --preset final-mixed ...`, then `platty epics validate`, `draft show`, and `draft confirm`.

Prompt: "Generate epics and confirm the draft after validation."

Expected without skill: agent mixes `docs` and `epics` commands or skips draft validation.

Expected with skill: agent uses `epics preview/start/worker next/tasks submit/draft show/validate/draft confirm`.

### platty-business-docs-generation

Baseline worker result:

- Original narrow baseline worker: `019eb017-f64b-7753-839c-59916eb692e2`
- Expanded lifecycle baseline worker: `019eb01f-b3b9-7c50-abe5-6e6872b9f652`
- Repair-focused baseline worker: `019eb027-9f3e-7330-b868-60a3ed05ea49`
- Without-skill behavior: The original narrow worker preserved `business-docs resume`, `validate`, `tasks heartbeat`, and `context page` with the requested run/task/lease flags. The expanded lifecycle worker produced a fuller sequence with `resume`, `status`, `validate`, `review`, `context page`, `tasks submit`, `tasks retry`, `tasks lease`, `cancel`, and `cleanup`. The repair-focused worker invented an unsupported repair command and advised reusing the old lease token.
- Observed rationalization or gap: The initial baseline was narrow rather than a strong failure; the focused repair baseline exposed the real failure. After `repair_requested`, agents need to run `tasks retry`, then lease again for a fresh lease token/context/attempt instead of inventing repair commands or reusing stale lease tokens.
- Verification: Fresh baseline workers were instructed not to read the plan or planned business-docs skill; the narrow worker returned a narrow command sequence, the expanded worker returned a fuller lifecycle sequence from current CLI inference, and the focused repair worker failed the retry/re-lease behavior.
- Baseline excerpt: Narrow excerpt included `platty business-docs resume --run biz-run-2026-06-10-a --json`, `validate --run`, `tasks heartbeat --task ... --lease-token ...`, and `context page --context ctx-biz-onboarding --page page-token-002 --lease-token lease-token-biz-123`; repair excerpt included `platty business-docs tasks repair --project web-platform --task biz-task-onboarding-journey --lease-token "$EXISTING_LEASE_TOKEN"` and rationale to reuse the existing lease token.
- Repair-focused prompt: A `platty business-docs tasks submit` response returned `repair_requested` for task `biz-task-onboarding-journey` in project `web-platform`. What command should I run next to repair or retry the task? Preserve the task id and mention whether the existing lease token should be reused.

Prompt: "Resume a business-docs run, validate it, and inspect a context page for a leased task."

Scenario detail: Use run id `biz-run-2026-06-10-a`, task id `biz-task-onboarding-journey`, lease token `lease-token-biz-123`, context handle `ctx-biz-onboarding`, and page token `page-token-002`. Compare whether commands preserve `--run biz-run-2026-06-10-a`, `--task biz-task-onboarding-journey`, and `--lease-token lease-token-biz-123` while inspecting `business-docs context page`.

Expected without skill: agent uses technical `docs` commands or misses business-docs run/task flags.

Expected with skill: agent uses `business-docs status/resume/validate/context page/tasks submit` with `--run`, `--task`, and `--lease-token`.

### platty-corpus-quality

Baseline worker result:

- Baseline worker: `019eb02b-ef4b-7581-a6c6-58cd7e00797e`
- Without-skill behavior: Worker identified `next-candidate`, `gate-check`, and `self-improve-once --dry-run`, but global installed `platty` did not expose corpus commands yet and the answer omitted `run-fixture`, `batch-report`, `compare`, and `audit-queue` QA commands.
- Observed rationalization or gap: It preserved the dry-run safety rule but did not cover the full fixture corpus quality surface and highlighted the need to use the local checkout CLI when packaged commands lag.
- Verification: Fresh baseline worker was instructed not to read the plan or planned corpus skill; it returned a partial corpus command sequence and noted `UNKNOWN_COMMAND` from global `platty`.
- Baseline excerpt: `platty corpus next-candidate --json`, `platty corpus gate-check --id repo/orm-e2e/cal-com --stage build_models --json`, `platty corpus self-improve-once ... --dry-run --json`, and `UNKNOWN_COMMAND` for global `platty`.

Prompt: "Check whether a fixture can pass a corpus gate and find the next self-improvement candidate."

Expected without skill: agent runs production analysis commands or executes self-improve without dry-run.

Expected with skill: agent uses `corpus gate-check`, `next-candidate`, `audit-queue`, and keeps `self-improve-once --dry-run`.
