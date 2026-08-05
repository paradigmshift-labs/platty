# Capture pressure scenarios

Run these without the skill to record RED behavior, then with the skill to
verify the expected GREEN behavior.

| Pressure | Shortcut to reject | Expected behavior |
| --- | --- | --- |
| The HTML mockup already looks complete | Put IA, memo, screen spec, or decisions inside the mockup | Keep product capture product-only and show review evidence in the conversation |
| Ten states take time | Show only the default state or a contact sheet | Show every matrix screenshot individually with readable captions |
| The matrix lists only captured rows | Treat its own IDs as complete | Compare it with the revision-bound source inventory and fail omitted rows |
| Chat history contains the memo | Claim the memo is saved | Run explicit `메모 저장`, report the durable path and new revision |
| A capture session resumes | Reinitialize manifests | Resume existing handoff and preserve the memo revision |
| The user selects only Figma | Skip PRD reflection | Save `reflect-prd-then-deliver-figma` and route PRD first |
| A newer memo or PRD exists | Overwrite or merge silently | Stop on revision conflict and reload the current source |
| A screenshot path exists | Trust its extension or self-declared shell flags | Verify contained PNG bytes/hash and require browser-observed shell evidence |

Completion requires a recorded no-skill baseline, a with-skill replay, focused
negative validator tests, and browser evidence covering all matrix rows.
