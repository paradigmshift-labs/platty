<div align="right">

🇬🇧 English · [🇰🇷 한국어](../ko/support-matrix.md)

</div>

# Platty Support Matrix

> What Platty can read and understand today. Platty's engine is layered so it can
> grow across languages, frameworks, ORMs, HTTP clients, and SaaS vendors
> independently — this matrix reflects the adapters actually present in the
> engine.

**Maturity legend:** ✅ Full · 🟡 Partial / emerging

For concepts see [How Platty Works](how-platty-works.md); to get started see the
[Usage Guide](usage-guide.md).

---

## What if your stack isn't listed?

This matrix is what Platty's **static analysis** recognizes deterministically
through dedicated adapters. When a library or vendor isn't covered by an adapter,
the static phase doesn't silently drop it — it preserves the raw code evidence
(imports, calls, literal values) with a reason. The **business-document phase
(LLM)** then reads that preserved evidence and can still describe the behavior in
your generated docs.

In short: a gap in this static matrix is **supplemented during LLM extraction**,
so niche or unlisted tech can still surface in your documentation — it just won't
have a structured, adapter-backed relation behind it.

---

## Languages

| Language | Parsing | Status |
| --- | --- | --- |
| TypeScript / JavaScript (incl. TSX) | tree-sitter | ✅ |
| Java | tree-sitter | ✅ |
| Kotlin | tree-sitter | ✅ |
| Dart | tree-sitter | ✅ |
| Python | regex-based parser (no tree-sitter yet) | 🟡 |

---

## Frameworks

| Layer | Frameworks |
| --- | --- |
| **Backend** | Next.js ✅ (App + Pages Router), NestJS ✅, Express ✅, FastAPI ✅ (Python), Spring Boot ✅ (Java), Ktor ✅ (Kotlin), Fastify 🟡 |
| **Edge / meta** | Astro, Nuxt, SvelteKit, Hono, Elysia, Koa |
| **Frontend** | React ✅ (components + state), Flutter ✅ (Dart) |
| **Mobile routing** | GoRouter, GetX, AutoRoute, Beamer, Navigator (Flutter) |

---

## ORMs & data models

| Ecosystem | ORMs / model libraries |
| --- | --- |
| **TS / JS** | Prisma, Drizzle, TypeORM, Sequelize, Mongoose, MikroORM, Objection.js, Knex, Kysely, Supabase schema |
| **Python** | SQLAlchemy, Pydantic |
| **JVM** | JPA / Hibernate, MyBatis, QueryDSL, Exposed (Kotlin), KTorm (Kotlin), R2DBC |
| **Dart / mobile** | Drift, Sqflite |
| **Raw / other** | Raw SQL (pg, mysql, sqlite3, …), Redis, Firebase Firestore |

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
