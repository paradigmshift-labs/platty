<div align="right">

[🇬🇧 English](../en/support-matrix.md) · 🇰🇷 한국어

</div>

# Platty 지원 매트릭스

> Platty가 오늘날 읽고 이해할 수 있는 것들입니다. Platty의 엔진은 계층화되어 있어
> 언어, 프레임워크, ORM, HTTP 클라이언트, SaaS 벤더에 걸쳐 독립적으로 확장될 수
> 있습니다. 이 매트릭스는 분석기 제공 여부와 실제 저장소 검증 수준을 구분합니다.

## 이 표를 읽는 방법

**검증 완료(Validated)**는 명시된 저장소 구조를 포함한 대표적인 실제
코드베이스에서 전체 정적 분석 파이프라인을 실행해 검증했다는 의미입니다.

**프리뷰(Preview)**는 결정론적 파서와 어댑터가 제공되고 fixture 또는 smoke
검증을 거쳤지만, 대규모 실제 저장소와 모노레포에 대한 폭넓은 검증은 아직 진행
중이라는 의미입니다.

검증 상태는 구체적인 코드 패턴과 저장소 구조를 기준으로 합니다. `Validated`가
모든 프레임워크 버전, 라이브러리 API, 메타프로그래밍 패턴 또는 런타임 바인딩을
인식한다는 뜻은 아닙니다. 아래 목록은 어댑터가 있는 범위를 보여 주며, 목록에
포함됐다는 이유만으로 전체 생태계가 `Validated`가 되지는 않습니다.

| 생태계 | 분석기 | 검증 수준 | 검증된 저장소 구조 |
| --- | --- | --- | --- |
| TypeScript / JavaScript (TSX 포함) | tree-sitter | **Validated** | 대표적인 단일 저장소 및 모노레포 |
| Java | tree-sitter | **Validated** | 대표적인 단일 저장소 및 멀티모듈 저장소 |
| Kotlin | tree-sitter | **Preview** | Fixture 수준 검증; 더 폭넓은 저장소 검증 예정 |
| Dart / Flutter | tree-sitter | **Preview** | 애플리케이션 fixture; 실제 모노레포 검증 예정 |
| Python | 정규식 기반 파서 | **Preview** | 애플리케이션 fixture 및 smoke 사례; 대규모 저장소와 모노레포 검증 예정 |

개념은 [Platty의 동작 원리](how-platty-works.md)를, 시작 방법은 [사용
가이드](usage-guide.md)를 참고하세요.

---

## 스택이 표에 없다면?

이 표는 Platty의 **정적 분석**이 전용 어댑터를 통해 결정론적으로 인식하는
범위입니다. 소스 언어를 파싱할 수 있다면 전용 어댑터가 없는 라이브러리나 벤더도
import, 호출, 리터럴 값이 저수준 그래프 증거로 남을 수 있습니다. 하지만 이것이
구조화된 진입점, 모델, 관계, 저장소 간 엣지 또는 생성 문서 컨텍스트 포함을
보장하지는 않습니다.

LLM 문서화 단계는 관련 소스 증거가 문서 컨텍스트까지 도달한 경우에만 목록에 없는
기술을 설명할 수 있습니다. Platty는 가능한 경우 검토 가능한 미해결 증거를
보존하지만, 소스로 증명할 수 없는 타깃이나 연결을 지어내지는 않습니다.

필요한 스택이나 저장소 구조가 목록에 없다면 공개 예제 또는 익명화한 최소 재현과
함께 [정적 분석 지원 요청](https://github.com/paradigmshift-labs/platty/issues/new?template=static-analysis-support.yml)을
등록해 주세요.

---

## 프레임워크 진입점

아래 어댑터는 API, 페이지/화면, 잡 또는 이벤트 진입점 패턴 중 하나 이상을
인식합니다. 실제 범위는 구체적인 소스 패턴과 프레임워크 버전에 따라 달라집니다.

| 레이어 | 프레임워크 |
| --- | --- |
| **Backend** | Next.js (App + Pages Router), NestJS, Express, FastAPI (Python), Flask (Python), Spring Boot (Java), Ktor (Kotlin), Fastify |
| **Edge / meta** | Astro, Nuxt, SvelteKit, Hono, Elysia, Koa |
| **Frontend** | React (컴포넌트, 상태 및 내비게이션 패턴), Flutter (Dart) |
| **Mobile routing** | GoRouter, GetX, AutoRoute, Beamer, Navigator (Flutter) |

---

## 데이터 모델과 데이터베이스 관계

모델/스키마 추출과 DB 호출 인식은 서로 다른 기능입니다. 아래 첫 번째 열은 구조화된
모델 또는 스키마 증거를 생성합니다. 두 번째 열은 DB 접근 관계를 인식할 수 있지만,
그 자체로 모델 추출을 의미하지는 않습니다.

| 생태계 | 모델 / 스키마 추출 | 추가 DB 관계 패턴 |
| --- | --- | --- |
| **TS / JS** | Prisma, Drizzle, TypeORM, Sequelize, Mongoose, MikroORM, Objection.js, Knex, Kysely, Supabase schema | Raw SQL (`pg`, `mysql`, `sqlite3`, …), Redis, Firebase Firestore |
| **Python** | SQLAlchemy, Pydantic | Raw SQL 패턴 |
| **JVM** | JPA / Hibernate, MyBatis, Exposed (Kotlin), KTorm (Kotlin), R2DBC | QueryDSL, repository 호출 패턴 |
| **Dart / mobile** | Drift | Sqflite |

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

## 지원 요청 및 버그 신고

- 목록에 없는 언어, 프레임워크, 라이브러리 또는 저장소 구조는
  [정적 분석 지원 요청](https://github.com/paradigmshift-labs/platty/issues/new?template=static-analysis-support.yml)에
  등록해 주세요.
- 제공되는 분석기에서 라우트, 모델, 관계 또는 저장소 간 연결이 누락되거나 잘못
  인식되면 [정적 분석 버그 신고](https://github.com/paradigmshift-labs/platty/issues/new?template=static-analysis-bug.yml)를
  등록해 주세요.

독점 소스 코드, 자격 증명, 비밀 키 또는 개인정보는 포함하지 마세요. 공개 예제
저장소나 익명화한 최소 재현을 제공해 주시면 가장 좋습니다.
