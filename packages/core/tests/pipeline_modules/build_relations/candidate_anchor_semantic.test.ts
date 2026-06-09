/**
 * build_relations candidate anchor tests
 * SOT: specs/build_relations/architecture.md §5
 */

import { describe, it, expect } from 'vitest'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type {
  BuildRelationsInputs,
  CodeEdgeLike,
  CodeNodeLike,
  SourceFallback,
} from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_anchor'

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id,
    filePath: 'src/page.tsx',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

let edgeId = 1
function makeEdge(sourceId: string, relation: string, opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return {
    id: edgeId++,
    repoId: REPO_ID,
    sourceId,
    targetId: null,
    relation,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
    ...opts,
  }
}

function makeInputs(nodes: CodeNodeLike[], edges: CodeEdgeLike[]): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath: null,
    includeTestSources: false,
    nodes,
    edges,
    models: [],
  }
}

function runPipeline(inputs: BuildRelationsInputs, sourceFallback?: Partial<SourceFallback>) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const relations = resolveCandidates(
    candidates,
    index,
    { resolveConstant: () => null, ...sourceFallback },
  )
  return normalizeRelations(relations)
}

describe('file-level and wrapper anchors', () => {
  it('uses same-file API imports as anchors for axios calls in another node', () => {
    const importNode = makeNode('imports', { type: 'file', name: 'page.tsx' })
    const handler = makeNode('loadOrders')
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSpecifier: 'axios', targetSymbol: 'axios' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'get',
        chainPath: 'axios',
        firstArg: '/api/orders',
      }),
    ]

    const result = runPipeline(makeInputs([importNode, handler], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'GET',
      payload: { protocol: 'rest' },
    })
  })

  it('uses api_client wrapper summaries when calls go through a local client object', () => {
    const wrapper = makeNode('apiClient', { name: 'apiClient', type: 'function', filePath: 'src/api.ts' })
    const handler = makeNode('loadOrders', { filePath: 'src/page.tsx' })
    const edges = [
      makeEdge(wrapper.id, 'imports', { targetSpecifier: 'axios', targetSymbol: 'axios' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'apiClient',
        firstArg: '/api/orders',
      }),
    ]

    const result = runPipeline(makeInputs([wrapper, handler], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'POST',
      canonicalTarget: 'POST /api/orders',
    })
  })

  it('uses same-file navigation imports as anchors for router calls in another node', () => {
    const importNode = makeNode('imports', { type: 'file', name: 'page.tsx' })
    const handler = makeNode('openOrders')
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSpecifier: 'next/navigation', targetSymbol: 'useRouter' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: '/orders',
      }),
    ]

    const result = runPipeline(makeInputs([importNode, handler], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/orders',
      operation: 'push',
      payload: { router: 'nextjs', target_path: '/orders' },
    })
  })

  it('uses same-file url_launcher imports as anchors for external link calls in another node', () => {
    const importNode = makeNode('imports', { type: 'file', name: 'links.dart', filePath: 'lib/links.dart' })
    const handler = makeNode('openSupport', { filePath: 'lib/links.dart' })
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSpecifier: 'url_launcher', targetSymbol: 'launchUrl' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'launchUrl',
        chainPath: null,
        firstArg: 'tel:+15551234567',
      }),
    ]

    const result = runPipeline(makeInputs([importNode, handler], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'tel:+15551234567',
      operation: 'open',
      payload: { scheme: 'tel' },
    })
  })

  it('uses same-file schedule imports as anchors for decorated jobs in another node', () => {
    const importNode = makeNode('imports', { type: 'file', name: 'jobs.ts', filePath: 'src/jobs.ts' })
    const job = makeNode('syncJob', { filePath: 'src/jobs.ts' })
    const edges = [
      makeEdge(importNode.id, 'imports', { targetSpecifier: '@nestjs/schedule', targetSymbol: 'Cron' }),
      makeEdge(job.id, 'decorates', { targetSymbol: 'Cron', firstArg: '0 * * * *' }),
    ]

    const result = runPipeline(makeInputs([importNode, job], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'schedule_trigger',
      operation: 'trigger',
      payload: { schedule_type: 'cron', cron: '0 * * * *' },
    })
  })
})
