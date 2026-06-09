/**
 * build_relations resolver branch tests
 * SOT: specs/build_relations/architecture.md §5.2~§5.5
 */

import { describe, it, expect } from 'vitest'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { resolveApiCallCandidate } from '@/pipeline_modules/build_relations/resolvers/api_call.js'
import { resolveDbAccessCandidate } from '@/pipeline_modules/build_relations/resolvers/db_access.js'
import { resolveNavigationCandidate } from '@/pipeline_modules/build_relations/resolvers/navigation.js'
import { resolveExternalLinkCandidate } from '@/pipeline_modules/build_relations/resolvers/external_link.js'
import { resolveExternalServiceCandidate } from '@/pipeline_modules/build_relations/resolvers/external_service.js'
import { resolveEventCandidate } from '@/pipeline_modules/build_relations/resolvers/event.js'
import { resolveScheduleTriggerCandidate } from '@/pipeline_modules/build_relations/resolvers/schedule_trigger.js'
import type {
  BuildRelationsInputs,
  CodeNodeLike,
  RelationCandidate,
  SourceFallback,
} from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_resolver'

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id,
    filePath: 'src/handler.ts',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

function makeInputs(nodes: CodeNodeLike[] = []): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath: null,
    includeTestSources: false,
    nodes,
    edges: [],
    models: [],
  }
}

function makeCandidate(partial: Partial<RelationCandidate> = {}): RelationCandidate {
  return {
    kind: 'api_call',
    sourceNodeId: 'source',
    evidenceNodeIds: ['edge-1'],
    receiver: null,
    targetSymbol: null,
    chainPath: null,
    firstArg: null,
    argExpressions: null,
    rawTarget: null,
    framework: null,
    payload: {},
    ...partial,
  }
}

function fallback(resolveConstant: SourceFallback['resolveConstant'] = () => null): SourceFallback {
  return { resolveConstant }
}

describe('api_call resolver branch behavior', () => {
  it('does not emit without a target', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveApiCallCandidate(makeCandidate(), index, fallback())

    expect(relation).toBeNull()
  })

  it('emits external URLs as http external_service relations', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveApiCallCandidate(
      makeCandidate({ rawTarget: 'https://api.example.com/orders' }),
      index,
      fallback(),
    )

    expect(relation).toMatchObject({
      kind: 'external_service',
      target: 'http:api.example.com',
      operation: 'fetch',
      canonicalTarget: 'external_service:http:api.example.com',
      payload: {
        protocol: 'http_external',
        service: 'http',
        url: 'https://api.example.com/orders',
      },
      confidence: 'medium',
    })
  })

  it('does not emit dynamic template targets', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveApiCallCandidate(
      makeCandidate({ rawTarget: '`/api/orders/${id}`' }),
      index,
      fallback(),
    )

    expect(relation).toBeNull()
  })

  it('does not emit identifier targets when route fallback cannot resolve them', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveNavigationCandidate(
      makeCandidate({ kind: 'navigation', rawTarget: 'ORDER_ROUTE' }),
      index,
      fallback(),
    )

    expect(relation).toBeNull()
  })

  it('uses source fallback for identifier targets and passes an empty file path for missing nodes', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveApiCallCandidate(
      makeCandidate({ rawTarget: 'ORDER_API', payload: { method: 'GET' } }),
      index,
      fallback((args) => {
        expect(args).toEqual({
          identifier: 'ORDER_API',
          nodeId: 'source',
          filePath: '',
          allowedScopes: ['api', 'external'],
        })
        return '/api/orders'
      }),
    )

    expect(relation).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'GET',
      canonicalTarget: 'GET /api/orders',
      confidence: 'medium',
    })
  })

  it('emits pattern DSL identifier targets even when source fallback cannot resolve them', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveApiCallCandidate(
      makeCandidate({
        rawTarget: 'sendEmail',
        payload: { adapter: 'pattern_dsl', method: 'POST' },
      }),
      index,
      fallback(),
    )

    expect(relation).toMatchObject({
      kind: 'api_call',
      target: 'sendEmail',
      operation: 'POST',
      canonicalTarget: 'POST sendEmail',
      confidence: 'medium',
      payload: {
        adapter: 'pattern_dsl',
      },
    })
  })

  it('keeps non-DSL unresolved identifier targets suppressed', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveApiCallCandidate(
      makeCandidate({ rawTarget: 'sendEmail', payload: { method: 'POST' } }),
      index,
      fallback(),
    )

    expect(relation).toBeNull()
  })

  it('marks global fetch internal paths as medium confidence', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveApiCallCandidate(
      makeCandidate({ rawTarget: '/api/orders', payload: { anchor: 'global_fetch' } }),
      index,
      fallback(),
    )

    expect(relation).toMatchObject({
      target: '/api/orders',
      canonicalTarget: 'UNKNOWN /api/orders',
      confidence: 'medium',
    })
  })
})

describe('db_access resolver branch behavior', () => {
  it('does not emit without method, known ORM, or model evidence', () => {
    const index = buildSemanticIndex(makeInputs())

    expect(resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', payload: { orm: 'prisma' } }),
      index,
      fallback(),
    )).toBeNull()
    expect(resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: 'this.prisma.user', payload: { method: 'findMany' } }),
      index,
      fallback(),
    )).toBeNull()
    expect(resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: 'this.prisma.user', payload: { method: 'findMany', orm: 'unknown' } }),
      index,
      fallback(),
    )).toBeNull()
    expect(resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: '', payload: { method: 'findMany', orm: 'prisma' } }),
      index,
      fallback(),
    )).toBeNull()
    expect(resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: 'tx', payload: { method: 'insert', orm: 'drizzle' } }),
      index,
      fallback(),
    )).toBeNull()
    expect(resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: 'findMany', payload: { method: 'findMany', orm: 'prisma' } }),
      index,
      fallback(),
    )).toBeNull()
    expect(resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: 'this.db', payload: { method: 'findMany', orm: 'prisma' } }),
      index,
      fallback(),
    )).toBeNull()
  })

  it('falls back to execute for unknown DB methods with static model evidence', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: 'this.prisma.user', payload: { method: 'customRaw', orm: 'prisma' } }),
      index,
      fallback(),
    )

    expect(relation).toMatchObject({
      kind: 'db_access',
      target: 'user',
      operation: 'execute',
      canonicalTarget: 'db:user:execute',
    })
  })

  it('uses injected model metadata when chain path is absent', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', payload: { method: 'find', orm: 'mongoose', modelName: 'User' } }),
      index,
      fallback(),
    )

    expect(relation).toMatchObject({
      kind: 'db_access',
      target: 'User',
      operation: 'select',
    })
  })

  it('uses Redis key fallbacks for cache targets', () => {
    const index = buildSemanticIndex(makeInputs())

    const exactKey = resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: 'this.redis', firstArg: 'session', payload: { method: 'set', orm: 'redis' } }),
      index,
      fallback(),
    )
    const defaultKey = resolveDbAccessCandidate(
      makeCandidate({ kind: 'db_access', chainPath: 'this.redis', payload: { method: 'set', orm: 'redis' } }),
      index,
      fallback(),
    )

    expect(exactKey?.target).toBe('session')
    expect(defaultKey?.target).toBe('cache')
  })
})

describe('navigation resolver branch behavior', () => {
  it('does not emit without a target', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveNavigationCandidate(
      makeCandidate({ kind: 'navigation' }),
      index,
      fallback(),
    )

    expect(relation).toBeNull()
  })

  it('does not emit dynamic template targets', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveNavigationCandidate(
      makeCandidate({ kind: 'navigation', rawTarget: '`/orders/${id}`' }),
      index,
      fallback(),
    )

    expect(relation).toBeNull()
  })

  it('uses source fallback for identifier route targets and includes source file evidence', () => {
    const source = makeNode('source', { filePath: 'src/routes.ts' })
    const index = buildSemanticIndex(makeInputs([source]))

    const relation = resolveNavigationCandidate(
      makeCandidate({
        kind: 'navigation',
        rawTarget: 'ORDER_ROUTE',
        payload: { method: 'replace', router: 'go_router', surface: 'button' },
      }),
      index,
      fallback((args) => {
        expect(args.filePath).toBe('src/routes.ts')
        expect(args.allowedScopes).toEqual(['route'])
        return '/orders'
      }),
    )

    expect(relation).toMatchObject({
      kind: 'navigation',
      target: '/orders',
      operation: 'replace',
      canonicalTarget: 'screen:/orders',
      payload: { router: 'go_router', target_path: '/orders', surface: 'button' },
      confidence: 'medium',
    })
  })

  it('keeps named route literals without source fallback', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveNavigationCandidate(
      makeCandidate({
        kind: 'navigation',
        rawTarget: 'family',
        payload: { method: 'goNamed', router: 'flutter_gorouter' },
      }),
      index,
      fallback(),
    )

    expect(relation).toMatchObject({
      kind: 'navigation',
      target: 'family',
      operation: 'goNamed',
      canonicalTarget: 'screen:family',
      payload: { router: 'flutter_gorouter', target_path: 'family' },
      confidence: 'high',
    })
  })
})

describe('external_link resolver branch behavior', () => {
  it('does not emit without a URL', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveExternalLinkCandidate(
      makeCandidate({ kind: 'external_link' }),
      index,
      fallback(),
    )

    expect(relation).toBeNull()
  })

  it('does not emit non-URL targets when source fallback cannot resolve them', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveExternalLinkCandidate(
      makeCandidate({ kind: 'external_link', rawTarget: 'www.example.com/orders' }),
      index,
      fallback(),
    )

    expect(relation).toBeNull()
  })

  it('uses source fallback for external URL constants', () => {
    const source = makeNode('source', { filePath: 'src/links.ts' })
    const index = buildSemanticIndex(makeInputs([source]))

    const relation = resolveExternalLinkCandidate(
      makeCandidate({ kind: 'external_link', sourceNodeId: 'source', rawTarget: 'EXTERNAL_LINKS.docs' }),
      index,
      fallback((args) => {
        expect(args).toEqual({
          identifier: 'EXTERNAL_LINKS.docs',
          nodeId: 'source',
          filePath: 'src/links.ts',
          allowedScopes: ['external'],
        })
        return 'https://docs.example.com/start'
      }),
    )

    expect(relation).toMatchObject({
      kind: 'external_link',
      target: 'https://docs.example.com/start',
      operation: 'open',
      canonicalTarget: 'external:https://docs.example.com/start',
      payload: { scheme: 'https' },
    })
  })

  it('keeps link operation when the candidate method is link', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveExternalLinkCandidate(
      makeCandidate({
        kind: 'external_link',
        rawTarget: 'mailto:support@example.com',
        payload: { method: 'link' },
      }),
      index,
      fallback(),
    )

    expect(relation).toMatchObject({
      operation: 'link',
      payload: { scheme: 'mailto' },
    })
  })
})

describe('schedule_trigger resolver branch behavior', () => {
  it('does not emit unsupported symbols', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveScheduleTriggerCandidate(
      makeCandidate({ kind: 'schedule_trigger', targetSymbol: 'Every' }),
      index,
    )

    expect(relation).toBeNull()
  })

  it('emits interval triggers without interval_ms when interval is not numeric', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveScheduleTriggerCandidate(
      makeCandidate({ kind: 'schedule_trigger', targetSymbol: 'Interval', firstArg: 'ONE_SECOND' }),
      index,
    )

    expect(relation).toMatchObject({
      kind: 'schedule_trigger',
      operation: 'trigger',
      payload: { schedule_type: 'interval' },
    })
    expect(relation?.payload).not.toHaveProperty('interval_ms')
  })

  it('emits timeout triggers without timeout_ms when timeout is missing', () => {
    const index = buildSemanticIndex(makeInputs())

    const relation = resolveScheduleTriggerCandidate(
      makeCandidate({ kind: 'schedule_trigger', targetSymbol: 'Timeout' }),
      index,
    )

    expect(relation).toMatchObject({
      kind: 'schedule_trigger',
      operation: 'trigger',
      payload: { schedule_type: 'timeout' },
    })
    expect(relation?.payload).not.toHaveProperty('timeout_ms')
  })
})

describe('event resolver branch behavior', () => {
  it('does not emit without broker or static target evidence', () => {
    const index = buildSemanticIndex(makeInputs())

    expect(resolveEventCandidate(makeCandidate({ kind: 'event', firstArg: 'order.created' }), index, fallback())).toBeNull()
    expect(resolveEventCandidate(
      makeCandidate({ kind: 'event', firstArg: null, payload: { broker: 'node_event' } }),
      index,
      fallback(),
    )).toBeNull()
    expect(resolveEventCandidate(
      makeCandidate({ kind: 'event', firstArg: '`order.${id}`', payload: { broker: 'node_event' } }),
      index,
      fallback(),
    )).toBeNull()
  })

  it('requires queue evidence for bull events and maps listener operations', () => {
    const index = buildSemanticIndex(makeInputs())

    expect(resolveEventCandidate(
      makeCandidate({ kind: 'event', firstArg: 'completed', payload: { broker: 'bull' } }),
      index,
      fallback(),
    )).toBeNull()

    const relation = resolveEventCandidate(
      makeCandidate({
        kind: 'event',
        firstArg: 'completed',
        payload: { broker: 'bull', queue: 'orders', direction: 'listen' },
      }),
      index,
      fallback(),
    )

    expect(relation).toMatchObject({
      kind: 'event_listen',
      target: 'orders/completed',
      operation: 'process',
      canonicalTarget: 'bull:orders/completed',
    })
  })

  it('maps SQS publish and GraphQL PubSub listen operations', () => {
    const index = buildSemanticIndex(makeInputs())

    const sqs = resolveEventCandidate(
      makeCandidate({ kind: 'event', firstArg: 'ORDER_CREATED', payload: { broker: 'sqs' } }),
      index,
      fallback(),
    )
    const graphql = resolveEventCandidate(
      makeCandidate({
        kind: 'event',
        firstArg: 'ORDER_CREATED',
        payload: { broker: 'graphql_pubsub', direction: 'listen' },
      }),
      index,
      fallback(),
    )

    expect(sqs?.operation).toBe('send')
    expect(graphql?.operation).toBe('subscribe')
  })
})

describe('external_service resolver branch behavior', () => {
  it('does not emit without service or resolvable target', () => {
    const index = buildSemanticIndex(makeInputs())

    expect(resolveExternalServiceCandidate(makeCandidate({ kind: 'external_service' }), index)).toBeNull()
    expect(resolveExternalServiceCandidate(
      makeCandidate({ kind: 'external_service', payload: { service: 's3' } }),
      index,
    )).toBeNull()
    expect(resolveExternalServiceCandidate(
      makeCandidate({ kind: 'external_service', targetSymbol: 'unknown', payload: { service: 'firebase' } }),
      index,
    )).toBeNull()
    expect(resolveExternalServiceCandidate(
      makeCandidate({
        kind: 'external_service',
        chainPath: 'supabase.storage.from(bucketName)',
        targetSymbol: 'upload',
        payload: { service: 'supabase_storage' },
      }),
      index,
    )).toBeNull()
    expect(resolveExternalServiceCandidate(
      makeCandidate({ kind: 'external_service', targetSymbol: 'send', payload: { service: 'unknown_service' } }),
      index,
    )).toBeNull()
  })

  it('maps service-specific targets and operations', () => {
    const index = buildSemanticIndex(makeInputs())

    expect(resolveExternalServiceCandidate(
      makeCandidate({ kind: 'external_service', firstArg: 'avatars', targetSymbol: 'getObject', payload: { service: 's3' } }),
      index,
    )).toMatchObject({ target: 's3:avatars', operation: 'download' })

    expect(resolveExternalServiceCandidate(
      makeCandidate({
        kind: 'external_service',
        chainPath: "supabase.storage.from('avatars')",
        targetSymbol: 'remove',
        payload: { service: 'supabase_storage' },
      }),
      index,
    )).toMatchObject({ target: 'supabase_storage:avatars', operation: 'delete' })

    expect(resolveExternalServiceCandidate(
      makeCandidate({ kind: 'external_service', targetSymbol: 'auth', payload: { service: 'firebase' } }),
      index,
    )).toMatchObject({
      target: 'firebase:auth',
      operation: 'unknown',
      payload: { service: 'firebase', firebase_product: 'auth' },
    })
  })
})
