# Platty Monorepo Architecture

Platty is managed as an npm-workspaces monorepo. The repo separates internal engine code, installable client packages, and deployable apps so CLI, backend, web, desktop, and future mobile surfaces can grow without collapsing dependency boundaries.

## Workspace Layout

```text
platty/
  package.json
  package-lock.json
  tsconfig.base.json
  tsconfig.json

  packages/
    core/
    sdk/
    cli/

  apps/
    backend/
    web/
    desktop/
```

## Package Roles

`packages/core` is the internal engine package. It owns analysis, pipeline orchestration, graph construction, generated document workflows, LLM runtime adapters, and local persistence contracts as those are migrated. It must not import CLI, backend, SDK, web, or desktop implementation code.

`packages/sdk` is the TypeScript HTTP API client. It is not the backend API itself. It wraps backend endpoints into typed functions such as `client.projects.list()`, handles base URL composition, authorization headers, JSON parsing, and normalized API errors. It must not import `@platty/core` or backend implementation code.

`packages/cli` is the npm-published `platty` command package. It can call `@platty/core` for local engine work and `@platty/sdk` for backend/cloud API work.

The CLI package name remains `@pshift/platty` to preserve the current public npm package identity. Internal packages use the `@platty/*` namespace.

`apps/backend` is the HTTP API server. It owns routes, auth/session APIs, analytics forwarding, remote run orchestration, and deployment configuration. It calls `@platty/core` for engine behavior.

`apps/web` is the web dashboard. It calls backend APIs through `@platty/sdk`.

`apps/desktop` is the future Electron surface. In this first scaffold, desktop source should use `@platty/sdk` only. A later Electron-specific plan can add a `main` process boundary that is allowed to call `@platty/core`.

Flutter/mobile code is not part of npm workspaces. A future `apps/mobile` should use `pubspec.yaml`. Flutter cannot import the TypeScript SDK directly; it needs a Dart client generated from an API contract or maintained under the mobile app until it is large enough to split.

## Dependency Rules

```text
@platty/core      -> no workspace package/app imports
@platty/sdk       -> no @platty/core or app/backend implementation imports
@pshift/platty    -> may import @platty/core and @platty/sdk
@platty/backend   -> may import @platty/core
@platty/web       -> may import @platty/sdk
@platty/desktop   -> may import @platty/sdk only in this scaffold
```

## Build

Each workspace owns its own build script:

```bash
npm run build --workspace packages/core
npm run build --workspace packages/sdk
npm run build --workspace packages/cli
npm run build --workspace apps/backend
npm run build --workspace apps/web
npm run build --workspace apps/desktop
```

The root can build everything:

```bash
npm run build
```

## Deployment Lanes

`packages/core` is private and is not deployed by itself.

`packages/cli` is the npm-published CLI package.

`apps/backend` is deployed as a server process or container.

`apps/web` is deployed as a dashboard frontend.

`apps/desktop` is packaged through Electron tooling when implemented.

`packages/sdk` stays private at first. It should be published only when external TypeScript consumers need a supported Platty API client.
