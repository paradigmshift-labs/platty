/*
 * F2b-1: extractStandardSlots — 부스 2 (정적 슬롯 추출 통합).
 *
 * SOT: specs/analyze_repo/specs/f2b_extract_standard_slots/spec.md §3
 *      architecture.md §6.2 (adapter registry + null/other 방어)
 *
 * 흐름:
 *   1. 공통 정적 추출 (framework 무관) — path_aliases / base_url / routing_libs
 *   2. framework adapter 호출 — entrypoint / schema / routing_files / needsLLM*
 *   3. mergeSlots — 공통 + adapter 결과 병합
 *
 * null/other framework — orchestrator가 SKIP 보장. 도달 시 throw.
 */

import type { Framework } from '@/db/schema/enums.js'
import type {
  IdentitySignal,
  ManifestSet,
  StandardSlots,
} from './types.js'
import type { FrameworkAdapter } from './static/frameworks/_base.js'

import { extractPathAliases, extractBaseUrl } from './static/helpers/tsconfig.js'
import { extractRoutingLibs } from './static/helpers/routing_libs.js'

import { nestjsAdapter } from './static/frameworks/nestjs.js'
import { nextjsAdapter } from './static/frameworks/nextjs.js'
import { expressAdapter } from './static/frameworks/express.js'
import { fastifyAdapter } from './static/frameworks/fastify.js'
import { reactAdapter } from './static/frameworks/react.js'
import { flutterAdapter } from './static/frameworks/flutter.js'
import { springAdapter } from './static/frameworks/spring.js'

const ADAPTERS: Map<Framework, FrameworkAdapter> = new Map<Framework, FrameworkAdapter>([
  ['nestjs', nestjsAdapter],
  ['nextjs', nextjsAdapter],
  ['nuxt', reactAdapter],
  ['sveltekit', reactAdapter],
  ['astro', reactAdapter],
  ['express', expressAdapter],
  ['fastify', fastifyAdapter],
  ['hono', expressAdapter],
  ['elysia', expressAdapter],
  ['spring', springAdapter],
  ['react', reactAdapter],
  ['flutter', flutterAdapter],
  // koa/vue/svelte는 v2 MVP 외 — generic으로 떨어짐 (express adapter 재사용)
  ['koa', expressAdapter],
  ['vue', reactAdapter],
  ['svelte', reactAdapter],
])

export async function extractStandardSlots(
  manifests: ManifestSet,
  identity: IdentitySignal,
  repoPath: string,
  opts?: { signal?: AbortSignal },
): Promise<StandardSlots> {
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  // 1. 공통 정적 추출 (framework-독립) — path aliases / base url는 항상 추출
  const path_aliases = extractPathAliases(manifests.tsconfig)
  const base_url = extractBaseUrl(manifests.tsconfig)

  // static-core: framework='other'/null이면 framework adapter 없이 공통 슬롯만 반환.
  // build_graph(import 해석)가 쓰는 path_aliases/base_url은 framework와 무관하므로 보존.
  // (ORM 스키마 탐지가 현재 framework adapter에 묶여 있어 'other'에선 schema_sources 생략 — 후속.)
  if (identity.framework === null || identity.framework === 'other') {
    return {
      path_aliases,
      base_url,
      entrypoint_files: [],
      routing_files: [],
      routing_libs: [],
      schema_sources: [],
      needsLLMRouting: false,
      needsLLMCustomDecorators: false,
    }
  }

  const routing_libs = extractRoutingLibs(identity.framework, manifests)

  // 2. framework adapter
  const adapter = ADAPTERS.get(identity.framework)
  if (!adapter) {
    throw new Error(`No adapter for framework: ${identity.framework}`)
  }
  const adapterSlots = await adapter.extractSlots(manifests, identity, repoPath, opts?.signal)
  const mergedRoutingLibs = Array.from(new Set([
    ...routing_libs,
    ...(adapterSlots.routing_libs ?? []),
  ]))

  // 3. merge — 공통 + adapter 결과
  return {
    path_aliases,
    base_url,
    entrypoint_files: adapterSlots.entrypoint_files ?? [],
    routing_files: adapterSlots.routing_files ?? [],
    routing_libs: mergedRoutingLibs,
    schema_sources: adapterSlots.schema_sources ?? [],
    needsLLMRouting: adapterSlots.needsLLMRouting ?? false,
    needsLLMCustomDecorators: adapterSlots.needsLLMCustomDecorators ?? false,
  }
}

// ────────────────────────────────────────
// shouldCallAmbiguousLLM — 단일 SOT (architecture.md §7.2)
// orchestrator + f2b_extract_ambiguous_slots 모두 이 함수 참조 (DRY)
// ────────────────────────────────────────

const NEEDS_LLM_FLAGS = [
  'needsLLMRouting',
  'needsLLMCustomDecorators',
] as const

export function shouldCallAmbiguousLLM(slots: StandardSlots): boolean {
  return NEEDS_LLM_FLAGS.some((f) => slots[f] === true)
}
