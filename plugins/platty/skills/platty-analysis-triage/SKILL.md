---
name: platty-analysis-triage
description: Use when Platty static analysis, a database check, connection import, or evidence audit fails, stalls, or returns unexpected evidence and needs a reproducible diagnosis packet.
---

# Platty Analysis Triage

Capture enough state for diagnosis while preserving customer sources and the failed run. Triage diagnoses; it never patches application or Platty code.

1. Record timestamp, CLI version, project selector/id, source package checksum, command arguments with secrets removed, stage, run id, exit code, and JSON error code/message.
2. Collect the current workflow and run state:

```bash
platty status --project <project> --json
platty runs show --run-id <run-id> --project <project> --json
```

3. Classify the failure as scope/input, connection binding, database approval/check, pipeline stage, stalled next action, or evidence mismatch. Include attempted command, observed result, and the next safe owner skill.
4. Preserve logs and JSON output outside customer source. Redact URLs, credentials, tokens, DSNs, private hosts, and raw customer configuration before sharing.

## Stop Conditions

- A run is failed, cancelled, or repeats the same next action twice without progress: stop retrying and hand off the packet.
- The failure needs code, database, network, credential, or customer-source changes: stop. Ask the authorized owner; do not patch code, mutate the database, or alter the customer ZIP.

Use `platty-static-analysis` only when the packet shows a safe, user-approved retry path.
