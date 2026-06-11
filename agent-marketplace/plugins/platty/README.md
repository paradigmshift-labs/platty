# Platty

Platty is being organized as an npm-workspaces monorepo. This repository currently contains the foundation only: package boundaries, TypeScript project references, and architecture documentation. Real engine, backend, dashboard, desktop, and mobile implementation work should be added in follow-up plans.

## Workspace Layout

```text
platty/
  packages/
    core/      # private analysis engine package
    sdk/       # private TypeScript API-client package
    cli/       # publishable platty CLI package

  apps/
    backend/   # backend server app
    web/       # future web dashboard app
    desktop/   # future Electron app
```

## Package Roles

- `packages/core` owns the internal analysis engine and must not import CLI, SDK, backend, web, or desktop code.
- `packages/sdk` is the TypeScript HTTP API client. It wraps backend API calls for web, desktop, CLI cloud workflows, and future external TypeScript consumers.
- `packages/cli` owns the npm `platty` command. It can use the local engine through `@platty/core` and backend/cloud APIs through `@platty/sdk`.
- `apps/backend` owns the HTTP API server and calls `@platty/core` for engine behavior.
- `apps/web` calls the backend through `@platty/sdk`.
- `apps/desktop` starts as an SDK-only Electron surface. A later Electron plan can split main-process engine access from renderer API calls.

Flutter is intentionally outside this npm workspace. A future Flutter app should use Dart and `pubspec.yaml`; it cannot import this TypeScript SDK directly without a separate Dart client or generated API client.

## Commands

```bash
node --test tests/architecture/workspace-contract.test.mjs
npm run typecheck
npm run build
```

`npm install` will create `package-lock.json` in a later verification step.

## Architecture

See `docs/architecture/monorepo.md` for the full package boundary and deployment-lane contract.
