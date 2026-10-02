---
name: platty-database-source-check
description: Use when registering or checking an approved remote database source for Platty analysis without exposing credentials or widening access.
---

# Platty Database Source Check

Database access is opt-in. Source registration stores only the URL source type and environment-variable name, never a URL or secret value.

1. Obtain explicit approval for the named source, provider, schema, environment-variable name, source type, and network check. The accepted value is an environment-variable **name**, never a URL, DSN, secret value, config-file path, or shell expansion. Existing authorization in the current session counts; do not ask again.
2. Resolve the project. Choose the flag from what the variable **contains**:

| Variable contains | Registration flag |
| --- | --- |
| Complete connection URL | `--url-env` |
| AWS Secrets Manager secret ID or ARN; its `SecretString` is the complete URL | `--url-aws-secret-id-env` |

Register only the chosen name. For example, for the AWS case:

```bash
platty db add --name <source-name> --provider <provider> --schema <schema> --url-aws-secret-id-env <EXPLICIT_ENV_VAR_NAME> --project <project> --json
```

Use `--url-env` in the same command when the variable contains the URL. Never pass both flags. `db add` does not read the variable or access AWS.

3. Run `db status --project <project> --json` and verify the source has the intended `urlSource` (`env` or `aws-secrets-manager`) and `urlEnv`. Before a network check, confirm the approved read-only endpoint or secret ID is available under that name. For AWS, the host role must have narrowly scoped `secretsmanager:GetSecretValue` access. Then run:

```bash
platty db check <source-name> --project <project> --json
```

Report source name, provider, schemas, result status, warnings, and error code. Never print the environment value.

## Stop Conditions

- Approval is absent, expired, ambiguous, or does not name the source/environment and check: stop before `db check`; do not open an external database.
- Caller supplies a URL or secret instead of an environment-variable name: reject it and request the variable name.
- Registered source type does not match what the variable contains: stop before `db check`; do not reinterpret or overwrite the source silently.
- Check fails: preserve the JSON error code and hand off to `platty-analysis-triage`; do not change credentials, database state, firewall rules, or source code.
