# Demo delivery verification

Prepared November 2, 2026 (Asia/Seoul), version `0.0.9-meko.3`.

The `feat/demo` branch is based on the retained single-skill commit
`401f91c7ebbdc2d1815b8d4b2b6117d6455e218a`. Only `platty` and its
`platty-search` skill are registered. Application source and production rows
are not distributed with the package, and no access credential is bundled.

## Verified

- `python3 verify-package.py .`: **17/17 checks passed**.
- Extracted installation ZIP: **16/16 checks passed**; the repository-only
  archive check is explicitly skipped outside a Git checkout.
- `claude plugin validate .`: **Validation passed**. A nonblocking plugin
  README listing suggestion remains; it did not prevent installation.
- Codex CLI `0.160.0` installed `platty@meko-poc`, version `0.0.9-meko.3`,
  enabled, inside a disposable Linux container without network or host user
  configuration. The extracted installation ZIP was also installed in that
  isolated environment.
- Browser verification at **320, 768 and 1280 px**: no horizontal overflow;
  shell tabs and keyboard navigation, command copy, section links, and details
  all passed. Light/dark rendering succeeded with no JavaScript errors.
- Both ZIPs passed CRC checks; installation archive contents matched source;
  repeated builds were byte-for-byte identical. SHA-256 files accompany them.
- `git diff --check`: exit 0.

The package-readiness test first failed on the missing HTML manual, branch
installation instruction and ZIPs, then passed after they were added. The
English skill and project-specific behavior were previously checked against
missing-tool, wrong-project and incomplete-search scenarios.

## Existing failure outside the demo change

`node scripts/check-issue-intake.mjs` fails because the unchanged
`guide/en/support-matrix.md` lacks the unified feedback-form link. The same
command fails at the same assertion on the base single-skill commit. The demo
does not modify those legacy support/CLI guides. The new README files retain
the unified feedback-form link.

## Recipient checks

Each recipient still needs their own AI account, an authorized MEKO server
credential and connectivity from their execution host. Installing the package
does not verify that user's server permissions. Native Windows client setup
and the PowerShell token-entry example were not executed in the Linux test.

The MCP name is `platty`; the configured endpoint remains
`https://meko-poc.platty-ai.com/mcp` and the expected project is `petshop-full`.
Missing menu context, scheduler imports and search-guide content remain explicit
evidence gaps as described in the manual and project notes.
