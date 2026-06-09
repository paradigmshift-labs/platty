import { describe, expect, it } from 'vitest'

import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'
import { resolveReachability } from '@/pipeline_modules/build_route/f5_resolve_reachability.js'
import { resolveEntryPointReachability } from '@/pipeline_modules/build_route/f7_resolve_entry_reachability.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type { EntryPointDraft } from '@/pipeline_modules/build_route/types.js'

const REPO = 'repo'
let edgeId = 1

function node(id: string, type: CodeNode['type']): CodeNode {
  return {
    id,
    repoId: REPO,
    type,
    filePath: `${id}.tsx`,
    name: id,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: false,
    isDefaultExport: false,
    isAsync: false,
    isTest: false,
    testType: null,
    docComment: null,
    parseStatus: 'ok',
    createdAt: '2026-05-13',
  }
}

function edge(sourceId: string, targetId: string, relation: CodeEdge['relation']): CodeEdge {
  return {
    id: edgeId++,
    repoId: REPO,
    sourceId,
    targetId,
    relation,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    resolveStatus: 'pending',
    confidence: null,
    source: 'static',
    createdAt: '2026-05-13',
  }
}

describe('semantic reachability', () => {
  it('starts semantic code bundle from the child screen component at depth 0', () => {
    const shell = node('DashboardPage', 'function')
    const billing = node('BillingPanel', 'function')
    const billingService = node('loadBilling', 'function')
    const profile = node('ProfilePanel', 'function')
    const graph = createGraphIndex({
      nodes: [shell, billing, billingService, profile],
      edges: [
        edge(shell.id, billing.id, 'renders'),
        edge(shell.id, profile.id, 'renders'),
        edge(billing.id, billingService.id, 'calls'),
      ],
    })

    const result = resolveReachability({
      entryPointId: 'repo:react:page::internal://dashboard/billing:BillingPanel',
      startNodeId: billing.id,
      graph,
    })

    expect(result.bundle.map((entry) => [entry.nodeId, entry.depth])).toEqual([
      [billing.id, 0],
      [billingService.id, 1],
    ])
    expect(result.bundle.some((entry) => entry.nodeId === shell.id)).toBe(false)
    expect(result.bundle.some((entry) => entry.nodeId === profile.id)).toBe(false)
  })

  it('builds stable entrypoint ids when method and path are absent', () => {
    const handler = node('runJob', 'function')
    const graph = createGraphIndex({ nodes: [handler], edges: [] })
    const entryPoint: EntryPointDraft = {
      framework: 'nestjs',
      kind: 'job',
      handlerNodeId: handler.id,
      metadata: {},
      detectionSource: 'rule:nestjs',
      confidence: 'high',
      detectionEvidence: {
        matchedRuleId: 'schedule',
        matchedNodeIds: [handler.id],
        matchedEdgeIds: [],
      },
    }

    const result = resolveEntryPointReachability({
      repoId: REPO,
      entryPoints: [entryPoint],
      graph,
    })

    expect(result).toEqual([
      expect.objectContaining({
        entryPointId: `${REPO}:nestjs:job:::${handler.id}`,
        nodeId: handler.id,
      }),
    ])
  })
})
