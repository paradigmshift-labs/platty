<div align="right">

[🇬🇧 English](../en/support-matrix.md) · 🇰🇷 한국어

</div>

# Platty 지원 매트릭스

> Platty가 오늘날 읽고 이해할 수 있는 것들입니다. Platty의 엔진은 계층화되어 있어
> 언어, 프레임워크, ORM, HTTP 클라이언트, SaaS 벤더에 걸쳐 독립적으로 확장될 수
> 있습니다 — 이 매트릭스는 엔진에 실제로 존재하는 어댑터를 반영합니다.

**성숙도 범례:** ✅ 완전 지원 · 🟡 부분 / 도입 중

개념은 [Platty의 동작 원리](how-platty-works.md)를, 시작 방법은 [사용
가이드](usage-guide.md)를 참고하세요.

---

## 스택이 표에 없다면?

이 표는 Platty의 **정적 분석**이 전용 어댑터를 통해 결정론적으로 인식하는
범위입니다. 어떤 라이브러리나 벤더가 어댑터로 커버되지 않더라도, 정적 단계는
이를 조용히 버리지 않습니다 — import, 호출, 리터럴 값 같은 원시 코드 증거를 그
이유와 함께 보존합니다. 그러면 **비즈니스 문서 단계(LLM)**가 그 보존된 증거를
읽어, 생성되는 문서에서 해당 동작을 여전히 설명할 수 있습니다.

요약하면, 이 정적 표의 공백은 **LLM 추출 단계에서 보강**되므로, 표에 없는
틈새 기술도 문서에 드러날 수 있습니다 — 다만 어댑터가 뒷받침하는 구조화된
관계(relation)는 갖지 못합니다.

---

## 언어

| 언어 | 파싱 | 상태 |
| --- | --- | --- |
| TypeScript / JavaScript (incl. TSX) | tree-sitter | ✅ |
| Java | tree-sitter | ✅ |
| Kotlin | tree-sitter | ✅ |
| Dart | tree-sitter | ✅ |
| Python | regex-based parser (no tree-sitter yet) | 🟡 |

---

## 프레임워크

| 레이어 | 프레임워크 |
| --- | --- |
| **Backend** | Next.js ✅ (App + Pages Router), NestJS ✅, Express ✅, FastAPI ✅ (Python), Spring Boot ✅ (Java), Ktor ✅ (Kotlin), Fastify 🟡 |
| **Edge / meta** | Astro, Nuxt, SvelteKit, Hono, Elysia, Koa |
| **Frontend** | React ✅ (components + state), Flutter ✅ (Dart) |
| **Mobile routing** | GoRouter, GetX, AutoRoute, Beamer, Navigator (Flutter) |

---

## ORM & 데이터 모델

| 생태계 | ORM / 모델 라이브러리 |
| --- | --- |
| **TS / JS** | Prisma, Drizzle, TypeORM, Sequelize, Mongoose, MikroORM, Objection.js, Knex, Kysely, Supabase schema |
| **Python** | SQLAlchemy, Pydantic |
| **JVM** | JPA / Hibernate, MyBatis, QueryDSL, Exposed (Kotlin), KTorm (Kotlin), R2DBC |
| **Dart / mobile** | Drift, Sqflite |
| **Raw / other** | Raw SQL (pg, mysql, sqlite3, …), Redis, Firebase Firestore |

---

## HTTP 클라이언트 & 데이터 페칭

| 카테고리 | 라이브러리 |
| --- | --- |
| **JS / TS HTTP** | Axios, Fetch, Got, Ky, Wretch, Superagent, node-fetch / cross-fetch / isomorphic-fetch |
| **Python HTTP** | requests, httpx |
| **Dart HTTP** | dio, http |
| **JVM HTTP** | RestTemplate / TestRestTemplate (Spring) |
| **GraphQL** | Apollo Client, graphql-request, urql, graphql_flutter |
| **RPC** | tRPC, oRPC |
| **Data-fetching / state** | TanStack Query, SWR, RTK Query, Redux (Thunk/Saga), Zustand, Recoil, Jotai, RxJS Ajax |

---

## 외부 서비스 / SaaS 벤더

Platty는 폭넓은 서드파티 카탈로그에 대해 전용 어댑터를 제공합니다 — 아래
카테고리에 걸쳐 **수십 개 서비스**를 인식합니다:

| 카테고리 | 벤더 |
| --- | --- |
| **결제 / 빌링** (12) | Stripe, Paddle, Lemon Squeezy, Square, PayPal, Braintree, Adyen, Mollie, Razorpay, Paystack, Chargebee, Recurly |
| **인증 / 아이덴티티** (9) | Auth0, Clerk, Okta, Stytch, WorkOS, Descope, Supabase Auth, Firebase Auth, generic OAuth |
| **스토리지 / 파일** (10) | AWS S3, Supabase Storage, Cloudinary, UploadThing, Azure Blob, Azure File Share, Google Cloud Storage, Dropbox, Box, MinIO |
| **검색 / 벡터** (9) | Algolia, Elasticsearch, Typesense, Meilisearch, Pinecone, Qdrant, Weaviate, Milvus, Chroma |
| **이메일** | Nodemailer, SendGrid, Mailgun, Mailjet, Resend, Postmark, Brevo, Mailchimp Transactional, Django mail, FastAPI-Mail |
| **SMS · 채팅 · 알림** | Twilio, Vonage, Slack, Discord, Intercom, Klaviyo, Zendesk, Novu, OneSignal, Courier, Plain |
| **제품 분석** (8) | PostHog, Segment, Mixpanel, Amplitude, RudderStack, Customer.io, Tinybird, OpenPanel |
| **AI** | OpenAI, Google Gemini / Vertex AI |
| **AWS SDK** | S3, DynamoDB, Lambda, SES, Secrets Manager, Athena, SQS, SNS |
| **Google Cloud** | Cloud Storage, Pub/Sub, Vertex AI / Gemini |
| **Azure** | Blob Storage, File Share, Storage Queue, Service Bus, Event Hubs |
| **플랫폼 / 기타** | Firebase, Sentry, GitHub, Notion, Sanity, Shopify, HubSpot, LaunchDarkly, Mux, Airtable, Jira, Trello, Asana |

---

## 이벤트, 큐 & 스케줄링

| 카테고리 | 지원 |
| --- | --- |
| **Brokers / queues** | BullMQ / Bull / Bee-Queue, Kafka, RabbitMQ, NATS, AWS SQS/SNS, Google Pub/Sub, Azure Service Bus / Event Hubs / Storage Queue, Redis Pub/Sub, Ably, Pusher, Socket.io, GraphQL subscriptions, Node EventEmitter, NestJS CQRS |
| **Python task queues** | Celery, RQ, Dramatiq, Arq, Taskiq |
| **Scheduling** | NestJS Schedule, node-cron, cron, Agenda, Bree, Bull repeat, Spring `@Scheduled` |

---

> 벤더 카탈로그는 지속적으로 늘어납니다. Platty가 외부 타깃을 증명할 수 없을 때는,
> 엣지를 지어내는 대신 검토 가능한 이유와 함께 관계를 보존합니다 — 그래서 그
> 간극이 여러분의 문서에 드러나 보입니다.
> [Platty의 동작 원리](how-platty-works.md#핵심-원칙-의미를-절대-지어내지-않습니다)를
> 참고하세요.
