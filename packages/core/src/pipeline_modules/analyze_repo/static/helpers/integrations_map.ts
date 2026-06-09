/**
 * integrations 매핑 — deps key → integration 이름.
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §4.3
 *
 * 룰:
 * - deps 키가 매핑 테이블에 있으면 integration 추가
 * - URI/key/token 값 거름망 (looksSensitive)
 * - dedupe
 */

import type { ManifestSet } from '../../types.js'

/**
 * npm + pubspec 통합 매핑 테이블.
 */
const INTEGRATIONS_MAP: Record<string, string> = {
  // ── npm: 외부 서비스 ──
  firebase: 'firebase',
  'firebase-admin': 'firebase',
  '@firebase/app': 'firebase',
  stripe: 'stripe',
  '@stripe/stripe-js': 'stripe',
  '@sentry/node': 'sentry',
  '@sentry/nestjs': 'sentry',
  '@sentry/react': 'sentry',
  '@sentry/nextjs': 'sentry',

  // ── npm: 큐 / 워커 ──
  bullmq: 'bullmq',
  bull: 'bullmq',
  '@nestjs/bullmq': 'bullmq',
  '@nestjs/bull': 'bullmq',
  agenda: 'agenda',

  // ── npm: 메시징 ──
  '@nestjs/microservices': 'microservices',
  '@grpc/grpc-js': 'grpc',
  kafkajs: 'kafka',
  amqplib: 'rabbitmq',

  // ── npm: cache / pubsub ──
  ioredis: 'redis',
  redis: 'redis',

  // ── npm: realtime ──
  'socket.io': 'websocket',
  '@nestjs/websockets': 'websocket',
  '@nestjs/platform-socket.io': 'websocket',

  // ── npm: graphql ──
  '@apollo/server': 'graphql',
  '@nestjs/graphql': 'graphql',
  'graphql-yoga': 'graphql',
  '@apollo/client': 'graphql',

  // ── npm: scheduling ──
  '@nestjs/schedule': 'schedule',
  'node-cron': 'cron',

  // ── pubspec ──
  firebase_core: 'firebase',
  bloc: 'bloc',
  flutter_bloc: 'bloc',
  riverpod: 'riverpod',
  flutter_riverpod: 'riverpod',
  provider: 'provider',
  get: 'getx',
  mobx: 'mobx',
  redux: 'redux',
  dio: 'http',
  http: 'http',
}

/**
 * 민감해 보이는 값 거름망.
 * dep 값이 "https://..."나 "sk_live_..."나 "Bearer ..." 같은 토큰이면 그 값을 integration에 포함하면 안 됨.
 * (애초에 dep 키만 사용하므로 보통 안전하지만, 마지막 방어)
 */
function looksSensitive(value: string): boolean {
  return /(?:https?:\/\/|postgresql:\/\/|mysql:\/\/|mongodb:\/\/|sk_live_|sk_test_|Bearer\s+|-----BEGIN|ghp_)/i.test(
    value,
  )
}

export function extractIntegrations(manifests: ManifestSet): string[] {
  const found = new Set<string>()

  // npm deps
  if (manifests.packageJson !== null) {
    const deps = {
      ...(manifests.packageJson.dependencies ?? {}),
      ...(manifests.packageJson.devDependencies ?? {}),
    }
    for (const [key] of Object.entries(deps)) {
      if (looksSensitive(key)) continue
      const mapped = INTEGRATIONS_MAP[key]
      if (mapped) found.add(mapped)
    }
  }

  // pubspec deps
  if (manifests.pubspecYaml !== null) {
    const deps = manifests.pubspecYaml.dependencies ?? {}
    for (const key of Object.keys(deps)) {
      if (looksSensitive(key)) continue
      const mapped = INTEGRATIONS_MAP[key]
      if (mapped) found.add(mapped)
    }
  }

  return [...found].sort()
}
