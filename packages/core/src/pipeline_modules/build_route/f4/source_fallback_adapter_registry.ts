import type {
  EntryPointDraft,
  SourceFallbackMergePolicy,
  SourceRouteAdapter,
  SourceRouteContext,
} from '../types.js'
import { buildExpressFallbackEntries } from './express_source_extractors.js'
import {
  buildFlutterAutoRouteFallbackEntries,
  buildFlutterBeamerFallbackEntries,
  buildFlutterGetxFallbackEntries,
  buildFlutterGoRouterFallbackEntries,
  buildFlutterNavigatorFallbackEntries,
} from './flutter_source_extractors.js'
import {
  buildNestFallbackEntriesWithExtractors,
  buildNestScheduleAliasEntries,
  extractNestBullProcessorEntries,
  extractNestCqrsEntries,
  extractNestEventEmitterEntries,
  extractNestGraphqlEntries,
  extractNestGraphqlSdlEntries,
  extractNestGrpcEntries,
  extractNestMicroserviceEntries,
  extractNestRestControllerEntries,
  extractNestWebSocketEntries,
  extractNestiaControllerEntries,
} from './nestjs_source_extractors.js'
import {
  buildNextConfigRewriteFallbackEntries,
  buildNextMiddlewareFallbackEntries,
  buildNextRouteHandlerFallbackEntries,
  buildNextServerActionFallbackEntries,
} from './nextjs_source_extractors.js'
import {
  buildOrpcFallbackEntries,
  hasOrpcServerSignal,
} from './orpc_source_extractors.js'
import {
  buildReactRouterFallbackEntries,
  buildReactRouterInteractionEntries,
  buildReactTanStackRouterFallbackEntries,
} from './react_router_source_extractors.js'
import {
  buildNodeCronFallbackEntries,
  hasNodeCronScheduleSignal,
} from './scheduled_source_extractors.js'
import type { LegacyFallbackInput } from './source_fallback_types.js'
import { buildTrpcFallbackEntries } from './trpc_source_extractors.js'

// NestJS source 어댑터들은 controller file fallback과 method-level entry가 같은 file에서 emit되어
// path overlap dedup이 필요함 → fileFallbackPathOverlap: true로 opt-in.
const NEST_API_OPTS = { fileFallbackPathOverlap: true } as const

export const SOURCE_FALLBACK_ADAPTERS: SourceRouteAdapter[] = [
  sourceAdapter('nestjs_nestia', 'nestjs', 'nestia', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestiaControllerEntries]),
    NEST_API_OPTS,
  ),
  sourceAdapter('nestjs_controller', 'nestjs', 'controller', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestRestControllerEntries]),
    NEST_API_OPTS,
  ),
  {
    id: 'nestjs_schedule',
    family: 'nestjs',
    capability: 'schedule',
    additive: true,
    mergePolicy: 'additive',
    detect(ctx) {
      const active = isNestActive(ctx)
      return {
        adapterId: 'nestjs_schedule',
        active,
        confidence: active ? 'high' : 'low',
        evidence: active ? ['framework:nestjs'] : [],
        reason: active ? undefined : 'inactive:nestjs',
      }
    },
    extract(ctx) {
      return buildNestScheduleAliasEntries(ctx)
        .map((entry) => withAdapterEvidence(entry, 'nestjs_schedule'))
        .map((entry) => withMergePolicy(entry, 'additive'))
    },
  },
  sourceAdapter('nestjs_graphql', 'nestjs', 'graphql', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestGraphqlEntries, extractNestGraphqlSdlEntries]),
    NEST_API_OPTS,
  ),
  sourceAdapter('nestjs_bull', 'nestjs', 'bull', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestBullProcessorEntries]),
    NEST_API_OPTS,
  ),
  sourceAdapter('nestjs_event_emitter', 'nestjs', 'event_emitter', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestEventEmitterEntries]),
    NEST_API_OPTS,
  ),
  sourceAdapter('nestjs_cqrs', 'nestjs', 'cqrs', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestCqrsEntries]),
    NEST_API_OPTS,
  ),
  sourceAdapter('nestjs_websocket', 'nestjs', 'websocket', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestWebSocketEntries]),
    NEST_API_OPTS,
  ),
  sourceAdapter('nestjs_microservice', 'nestjs', 'microservice', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestMicroserviceEntries]),
    NEST_API_OPTS,
  ),
  sourceAdapter('nestjs_grpc', 'nestjs', 'grpc', isNestActive, (input) =>
    buildNestFallbackEntriesWithExtractors(input, [extractNestGrpcEntries]),
    NEST_API_OPTS,
  ),
  sourceAdapter('nextjs_app_router', 'nextjs', 'app_router', isNextActive, buildNextRouteHandlerFallbackEntries),
  sourceAdapter('nextjs_config_rewrite', 'nextjs', 'config_rewrite', isNextActive, buildNextConfigRewriteFallbackEntries),
  sourceAdapter('nextjs_middleware', 'nextjs', 'middleware', isNextActive, buildNextMiddlewareFallbackEntries),
  sourceAdapter('nextjs_server_action', 'nextjs', 'server_action', isNextActive, buildNextServerActionFallbackEntries),
  sourceAdapter('nextjs_trpc', 'nextjs', 'trpc', isNextActive, buildTrpcFallbackEntries),
  sourceAdapter('orpc_server', 'node', 'orpc', hasOrpcServerSignal, buildOrpcFallbackEntries),
  sourceAdapter('react_router_object', 'react_router_v6', 'route_object', isReactRouterActive, buildReactRouterFallbackEntries),
  sourceAdapter('react_tanstack_router', 'react_router_v6', 'tanstack_router', isReactRouterActive, buildReactTanStackRouterFallbackEntries),
  sourceAdapter('react_router_interaction', 'react_router_v6', 'interaction', isReactRouterActive, buildReactRouterInteractionEntries),
  sourceAdapter('flutter_gorouter', 'flutter', 'gorouter', isFlutterActive, buildFlutterGoRouterFallbackEntries,
    { mergePolicy: 'supersede_framework' }),
  sourceAdapter('flutter_navigator', 'flutter', 'navigator', isFlutterActive, buildFlutterNavigatorFallbackEntries),
  sourceAdapter('flutter_getx', 'flutter', 'getx', isFlutterActive, buildFlutterGetxFallbackEntries),
  sourceAdapter('flutter_auto_route', 'flutter', 'auto_route', isFlutterActive, buildFlutterAutoRouteFallbackEntries),
  sourceAdapter('flutter_beamer', 'flutter', 'beamer', isFlutterActive, buildFlutterBeamerFallbackEntries),
  // express 분리:
  //   express_direct = string literal / template / require mount 등 일반 routes (additive)
  //   express_variable_mount = cross-file sub-router mount (supersede_handler — 더 정확한 prefix)
  sourceAdapter('express_direct', 'express', 'direct', isExpressActive,
    (input) => buildExpressFallbackEntries(input).filter((e) => e.metadata?.sourceFallback !== 'express_variable_mount')),
  sourceAdapter('express_variable_mount', 'express', 'variable_mount', isExpressActive,
    (input) => buildExpressFallbackEntries(input).filter((e) => e.metadata?.sourceFallback === 'express_variable_mount'),
    { mergePolicy: 'supersede_handler' }),
  {
    id: 'node_cron_schedule',
    family: 'node',
    capability: 'schedule',
    additive: true,
    mergePolicy: 'additive',
    detect(ctx) {
      const active = hasNodeCronScheduleSignal(ctx)
      return {
        adapterId: 'node_cron_schedule',
        active,
        confidence: active ? 'high' : 'low',
        evidence: active ? ['import:node-cron', 'call:cron.schedule'] : [],
        reason: active ? undefined : 'missing:node-cron schedule signal',
      }
    },
    extract(ctx) {
      return buildNodeCronFallbackEntries(ctx)
        .map((entry) => withAdapterEvidence(entry, 'node_cron_schedule'))
        .map((entry) => withMergePolicy(entry, 'additive'))
    },
  },
]

interface SourceAdapterOpts {
  mergePolicy?: SourceFallbackMergePolicy
  /**
   * f6 dedupeFileFallbackEntries에서 같은 file/handler의 entry간 path-overlap dedup 적용 여부.
   * NestJS controller 패턴(file fallback + method-level)에 필요 — true이면 emit하는 모든
   * entry에 metadata.fileFallbackPathOverlap: true 태깅.
   */
  fileFallbackPathOverlap?: boolean
}

function sourceAdapter(
  id: string,
  family: string,
  capability: string,
  isActive: (ctx: SourceRouteContext) => boolean,
  build: (input: LegacyFallbackInput) => EntryPointDraft[],
  opts: SourceAdapterOpts = {},
): SourceRouteAdapter {
  const mergePolicy: SourceFallbackMergePolicy = opts.mergePolicy ?? 'additive'
  const fileFallbackPathOverlap = opts.fileFallbackPathOverlap === true
  return {
    id,
    family,
    capability,
    additive: true,
    mergePolicy,
    detect(ctx) {
      const active = isActive(ctx)
      return {
        adapterId: id,
        active,
        confidence: active ? 'high' : 'low',
        evidence: active ? [`framework:${family}`] : [],
        reason: active ? undefined : `inactive:${family}`,
      }
    },
    extract(ctx) {
      return build(toLegacyFallbackInput(ctx))
        .map((entry) => withAdapterEvidence(entry, id))
        .map((entry) => withMergePolicy(entry, mergePolicy))
        .map((entry) => fileFallbackPathOverlap ? withFileFallbackPathOverlap(entry) : entry)
    },
  }
}

function withMergePolicy(entry: EntryPointDraft, mergePolicy: SourceFallbackMergePolicy): EntryPointDraft {
  return {
    ...entry,
    metadata: {
      ...entry.metadata,
      mergePolicy,
    },
  }
}

function withFileFallbackPathOverlap(entry: EntryPointDraft): EntryPointDraft {
  return {
    ...entry,
    metadata: {
      ...entry.metadata,
      fileFallbackPathOverlap: true,
    },
  }
}

function toLegacyFallbackInput(ctx: SourceRouteContext): LegacyFallbackInput {
  return {
    repoPath: ctx.repoPath,
    repoId: ctx.repoId,
    stackInfo: ctx.stackInfo,
    detections: ctx.detections,
    graphNodes: ctx.graphNodes,
  }
}

function withAdapterEvidence(entry: EntryPointDraft, adapterId: string): EntryPointDraft {
  return {
    ...entry,
    metadata: {
      ...entry.metadata,
      adapterId,
      evidence: [
        ...metadataEvidence(entry.metadata),
        {
          adapterId,
          detectionSource: entry.detectionSource,
          matchedRuleId: entry.detectionEvidence.matchedRuleId,
        },
      ],
    },
  }
}

function metadataEvidence(metadata: Record<string, unknown>): unknown[] {
  /* v8 ignore next -- current source fallback extractors do not pre-populate metadata.evidence. */
  return Array.isArray(metadata.evidence) ? metadata.evidence : []
}

function isNestActive(ctx: SourceRouteContext): boolean {
  return ctx.detections.some((d) => d.framework === 'nestjs' && d.active)
}

function isNextActive(ctx: SourceRouteContext): boolean {
  return ctx.detections.some((d) => d.framework === 'nextjs' && d.active)
}

function isReactRouterActive(ctx: SourceRouteContext): boolean {
  return ctx.detections.some((d) => d.framework === 'react_router_v6' && d.active)
}

function isFlutterActive(ctx: SourceRouteContext): boolean {
  return ctx.detections.some((d) => d.framework.startsWith('flutter') && d.active)
}

function isExpressActive(ctx: SourceRouteContext): boolean {
  return ctx.detections.some((d) => d.framework === 'express' && d.active)
}
