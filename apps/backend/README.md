# Platty Backend

This backend is the first backend-only slice for anonymous auth, user settings, consent, analytics ingestion, and future user linking.

It intentionally does not include SDK packages, contracts packages, Firebase verification, workspace/license/billing/project/repository domain tables, or product dashboard UI code.

## Runtime

- Framework: NestJS
- Database access: Prisma Client
- Database provider: PostgreSQL
- Package manager: npm workspaces
- Schema: `apps/backend/prisma/schema.prisma`

Useful commands:

```bash
npm run test --workspace @platty/backend
DATABASE_URL='postgresql://platty:platty@localhost:55433/platty?schema=public' npm run test:integration --workspace @platty/backend
DATABASE_URL='postgresql://platty:platty@localhost:55433/platty?schema=public' npm run test:e2e --workspace @platty/backend
npm run build --workspace @platty/backend
npm run typecheck
DATABASE_URL='postgresql://platty:platty@localhost:5432/platty?schema=public' npm run prisma:generate --workspace @platty/backend
DATABASE_URL='postgresql://platty:platty@localhost:5432/platty?schema=public' npm run prisma:migrate --workspace @platty/backend
DATABASE_URL='postgresql://platty:platty@localhost:5432/platty?schema=public' npm run prisma:deploy --workspace @platty/backend
```

## Testing Layers

`npm run test --workspace @platty/backend` runs fast unit, controller, and service tests matched by `*.spec.ts`.

`npm run test:integration --workspace @platty/backend` calls services directly with a real Prisma/PostgreSQL connection.

`npm run test:e2e --workspace @platty/backend` boots `AppModule` and validates the HTTP API through Supertest.

Because DB-backed integration and E2E cleanup delete rows, run both only against a disposable local PostgreSQL database at `localhost:55433/platty`, and apply migrations to that disposable test database first with `DATABASE_URL='postgresql://platty:platty@localhost:55433/platty?schema=public' npm run prisma:deploy --workspace @platty/backend`.

## Modules

- `AuthModule`: starts anonymous sessions with opaque tokens, stores only SHA-256 token hashes, creates/reuses `ClientIdentity`, and creates identity aliases.
- `SettingsModule`: stores user-scoped JSON settings by `(userId, namespace, key)`.
- `ConsentModule`: records consent history and fetches latest consent by user and/or client identity.
- `AnalyticsModule`: validates known event names, blocks sensitive analytics keys, checks analytics consent, and stores idempotent events by `eventId`.
- `UsersModule`: links an anonymous user into a registered user while preserving analytics/settings/consent continuity.
- `PrismaModule`: provides Prisma Client lifecycle integration.

## API Surface

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/anonymous` | Start or refresh an anonymous backend session for a client installation. |
| `PUT` | `/users/:userId/settings/:namespace/:key` | Upsert one user setting. |
| `GET` | `/users/:userId/settings` | List all settings for a user. |
| `GET` | `/users/:userId/settings/:namespace` | List settings in one namespace. |
| `POST` | `/consent` | Record consent history. |
| `GET` | `/consent/latest` | Fetch latest consent for `userId` and/or `clientIdentityId`. |
| `POST` | `/analytics/events` | Ingest one analytics event. |
| `POST` | `/users/link-anonymous` | Merge/link an anonymous user into a registered user. |

## Identity Flow

1. A client generates or reuses a local `installationId`.
2. The client calls `POST /auth/anonymous` with `installationId` and `clientKind`.
3. Backend creates or reuses `ClientIdentity`.
4. Backend creates a canonical `User` with status `ANONYMOUS` if the client is new.
5. Backend creates `AnonymousSession` with token hashes only.
6. Backend records `UserIdentityAlias` for `CLIENT_INSTALLATION_ID` and optional `ANALYTICS_SESSION_ID`.
7. Events, settings, and consent can now be attached to `userId`, `clientIdentityId`, and/or `anonymousSessionId`.
8. After real login is added later, `POST /users/link-anonymous` can merge the anonymous user into a `REGISTERED` user and migrate continuity records.

## ERD

The diagram uses optional parent cardinality for nullable Prisma foreign keys such as `ClientIdentity.userId`, `ConsentRecord.userId`, and `AnalyticsEvent.userId`.

```mermaid
erDiagram
  User o|--o{ ClientIdentity : owns
  User ||--o{ AnonymousSession : starts
  User ||--o{ UserIdentityAlias : has
  User ||--o{ UserSetting : stores
  User o|--o{ ConsentRecord : records
  User o|--o{ AnalyticsEvent : emits
  User o|--o{ User : merged_into

  ClientIdentity o|--o{ AnonymousSession : starts
  ClientIdentity o|--o{ ConsentRecord : records
  ClientIdentity o|--o{ AnalyticsEvent : emits
  ClientIdentity o|--o{ UserSetting : updates

  AnonymousSession o|--o{ AnalyticsEvent : attributes
```

## Merge Policy

`UsersService.linkAnonymousUser` is the future login bridge. It assumes an upstream auth layer has already verified the provider subject.

When linking:

- The source user must be `ANONYMOUS`.
- A provided target user must be `REGISTERED`.
- The source user is guarded with a conditional merge update so concurrent links cannot both migrate records.
- `ClientIdentity`, `AnonymousSession`, `AnalyticsEvent`, `ConsentRecord`, and non-conflicting `UserSetting` rows move to the target user.
- Setting conflicts are target-wins: if target already has the same `(namespace, key)`, the anonymous setting row is deleted.
- Alias conflicts are explicit: aliases owned by another user produce a conflict; aliases already owned by target are accepted or deduplicated.
- Alias unique races retry in a fresh transaction so PostgreSQL aborted-transaction behavior is avoided.

## Analytics Rules

Event names are backend-local for this phase and live in `src/modules/analytics/event-catalog.ts`.

Rules:

- Event names are stable snake_case names from `PLATTY_EVENT_NAMES`.
- `occurredAt` must be strict ISO/RFC3339 datetime with offset.
- `properties` and `context` must be JSON objects.
- Events must include resolvable attribution: `userId`, `clientIdentityId`, `anonymousSessionId`, or `analyticsSessionId`.
- Session and client identity records are canonical. When provided, they override raw user attribution and mismatches are rejected.
- Sensitive keys are rejected recursively, including token, password, secret, API key, email, prompt, raw body, source code, file path, and git remote keys.
- Duplicate `eventId` is idempotent: the existing event is returned.
- If latest `ANALYTICS` consent exists and is denied, ingestion is rejected.

## Future Scope

Planned later, not in this backend slice:

- Firebase ID token verification.
- Registered login provider callback handling.
- Workspace/project/repository/license/billing models.
- Public SDK/client packages.
- Web dashboard and Electron/Flutter clients.
