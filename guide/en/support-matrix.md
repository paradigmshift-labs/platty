<div align="right">

🇬🇧 English · [🇰🇷 한국어](../ko/support-matrix.md)

</div>

# Platty Support Matrix

> What Platty can read and understand today. Platty's engine is layered so it can
> grow across languages, frameworks, ORMs, HTTP clients, and SaaS vendors
> independently. This matrix separates analyzer availability from the depth of
> real-world validation.

## How to read this matrix

**Validated** means the full static-analysis pipeline has been exercised on
representative real-world repositories, including the repository layouts shown
below.

**Preview** means deterministic parsers and adapters are available and have
fixture or smoke coverage, while broader validation on large real-world
repositories and monorepos is still in progress.

Validation is pattern- and topology-specific. `Validated` does not mean that
every framework version, library API, metaprogramming pattern, or runtime binding
is recognized. The catalogs below describe adapter-backed coverage; they do not
promote an entire ecosystem to `Validated`.

| Ecosystem | Analyzer | Validation | Validated repository layouts |
| --- | --- | --- | --- |
| TypeScript / JavaScript (including TSX) | tree-sitter | **Validated** | Representative single repositories and monorepos |
| Java | tree-sitter | **Validated** | Representative single repositories and multi-module repositories |
| Kotlin | tree-sitter | **Preview** | Fixture-level validation; broader repository validation pending |
| Dart / Flutter | tree-sitter | **Preview** | Application fixtures; real-world monorepo validation pending |
| Python | Regex-based parser | **Preview** | Application fixtures and smoke cases; large-repository and monorepo validation pending |

For concepts see [How Platty Works](how-platty-works.md); to get started see the
[Usage Guide](usage-guide.md).

---

## What if your stack isn't listed?

This matrix is what Platty's **static analysis** recognizes deterministically
through dedicated adapters. If the source language can be parsed, imports, calls,
and literal values may remain as low-level graph evidence even when a library or
vendor has no dedicated adapter. That does **not** guarantee a structured entry
point, model, relation, cross-repository edge, or inclusion in generated-document
context.

The LLM documentation phase can describe unlisted technology only when the
relevant source evidence reaches its document context. Platty preserves
reviewable unresolved evidence where it can, but does not invent a target or
connection that the source cannot prove.

If a stack or repository layout you need is missing,
[report an issue or request support](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml)
with a public example or sanitized minimal reproduction.

---

## Framework entry points

These adapters recognize one or more API, page/screen, job, or event entry-point
patterns. Coverage depends on the concrete source pattern and framework version.

| Layer | Frameworks |
| --- | --- |
| **Backend** | Next.js (App + Pages Router), NestJS, Express, FastAPI (Python), Flask (Python), Spring Boot (Java), Ktor (Kotlin), Fastify |
| **Edge / meta** | Astro, Nuxt, SvelteKit, Hono, Elysia, Koa |
| **Frontend** | React (components, state, and navigation patterns), Flutter (Dart) |
| **Mobile routing** | GoRouter, GetX, AutoRoute, Beamer, Navigator (Flutter) |

---

## Data models and database relations

Model/schema extraction and DB-call recognition are separate capabilities. The
first column below produces structured model or schema evidence. The second can
recognize DB access relations but does not, by itself, imply model extraction.

| Ecosystem | Model / schema extraction | Additional DB-relation patterns |
| --- | --- | --- |
| **TS / JS** | Prisma, Drizzle, TypeORM, Sequelize, Mongoose, MikroORM, Objection.js, Knex, Kysely, Supabase schema | Raw SQL (`pg`, `mysql`, `sqlite3`, …), Redis, Firebase Firestore |
| **Python** | SQLAlchemy, Pydantic | Raw SQL patterns |
| **JVM** | JPA / Hibernate, MyBatis, Exposed (Kotlin), KTorm (Kotlin), R2DBC | QueryDSL, repository call patterns |
| **Dart / mobile** | Drift | Sqflite |

---

## HTTP clients & data fetching

| Category | Libraries |
| --- | --- |
| **JS / TS HTTP** | Axios, Fetch, Got, Ky, Wretch, Superagent, node-fetch / cross-fetch / isomorphic-fetch |
| **Python HTTP** | requests, httpx |
| **Dart HTTP** | dio, http |
| **JVM HTTP** | RestTemplate / TestRestTemplate (Spring) |
| **GraphQL** | Apollo Client, graphql-request, urql, graphql_flutter |
| **RPC** | tRPC, oRPC |
| **Data-fetching / state** | TanStack Query, SWR, RTK Query, Redux (Thunk/Saga), Zustand, Recoil, Jotai, RxJS Ajax |

---

## External services / SaaS vendors

Platty ships dedicated adapters for a broad third-party catalog — **dozens of
services** across these categories:

| Category | Vendors |
| --- | --- |
| **Billing / payments** (12) | Stripe, Paddle, Lemon Squeezy, Square, PayPal, Braintree, Adyen, Mollie, Razorpay, Paystack, Chargebee, Recurly |
| **Auth / identity** (9) | Auth0, Clerk, Okta, Stytch, WorkOS, Descope, Supabase Auth, Firebase Auth, generic OAuth |
| **Storage / files** (10) | AWS S3, Supabase Storage, Cloudinary, UploadThing, Azure Blob, Azure File Share, Google Cloud Storage, Dropbox, Box, MinIO |
| **Search / vector** (9) | Algolia, Elasticsearch, Typesense, Meilisearch, Pinecone, Qdrant, Weaviate, Milvus, Chroma |
| **Email** | Nodemailer, SendGrid, Mailgun, Mailjet, Resend, Postmark, Brevo, Mailchimp Transactional, Django mail, FastAPI-Mail |
| **SMS · chat · notifications** | Twilio, Vonage, Slack, Discord, Intercom, Klaviyo, Zendesk, Novu, OneSignal, Courier, Plain |
| **Product analytics** (8) | PostHog, Segment, Mixpanel, Amplitude, RudderStack, Customer.io, Tinybird, OpenPanel |
| **AI** | OpenAI, Google Gemini / Vertex AI |
| **AWS SDK** | S3, DynamoDB, Lambda, SES, Secrets Manager, Athena, SQS, SNS |
| **Google Cloud** | Cloud Storage, Pub/Sub, Vertex AI / Gemini |
| **Azure** | Blob Storage, File Share, Storage Queue, Service Bus, Event Hubs |
| **Platform / other** | Firebase, Sentry, GitHub, Notion, Sanity, Shopify, HubSpot, LaunchDarkly, Mux, Airtable, Jira, Trello, Asana |

---

## Events, queues & scheduling

| Category | Support |
| --- | --- |
| **Brokers / queues** | BullMQ / Bull / Bee-Queue, Kafka, RabbitMQ, NATS, AWS SQS/SNS, Google Pub/Sub, Azure Service Bus / Event Hubs / Storage Queue, Redis Pub/Sub, Ably, Pusher, Socket.io, GraphQL subscriptions, Node EventEmitter, NestJS CQRS |
| **Python task queues** | Celery, RQ, Dramatiq, Arq, Taskiq |
| **Scheduling** | NestJS Schedule, node-cron, cron, Agenda, Bree, Bull repeat, Spring `@Scheduled` |

---

> The vendor catalog grows continuously. When Platty can't prove an external
> target, it preserves the relation with a reviewable reason rather than
> inventing an edge — so the gap stays visible in your documentation. See
> [How Platty Works](how-platty-works.md#the-guiding-principle-never-invent-meaning).

## Requests and bug reports

- Use the [unified feedback form](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml)
  for an unlisted language, framework, library, or repository layout.
- Use the [unified feedback form](https://github.com/paradigmshift-labs/platty/issues/new?template=platty-feedback.yml)
  when Platty misses or incorrectly identifies a route, model, relation, or
  cross-repository connection in an available analyzer.

Do not include proprietary source code, credentials, secrets, or personal data.
A public example repository or sanitized minimal reproduction is the most useful.
