import { describe, expect, it } from 'vitest'

import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'
import { derivePrimitiveAliases } from '@/pipeline_modules/build_route/f3/primitive_aliases.js'

const REPO = 'repo'

function node(name: string, type: CodeNode['type'] = 'function'): CodeNode {
  return {
    id: `${REPO}:src/routes.ts:${name}`,
    repoId: REPO,
    type,
    filePath: 'src/routes.ts',
    name,
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

function call(source: string, targetSymbol: string, chainPath?: string): CodeEdge {
  return {
    id: Math.floor(Math.random() * 1000000),
    repoId: REPO,
    sourceId: `${REPO}:src/routes.ts:${source}`,
    targetId: null,
    relation: 'calls',
    targetSpecifier: null,
    targetSymbol,
    chainPath: chainPath ?? null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'pending',
    confidence: null,
    typeRefSubtype: null,
    source: 'static',
    createdAt: '2026-05-13',
  }
}

function nonCall(source: string, targetSymbol: string): CodeEdge {
  return { ...call(source, targetSymbol), relation: 'imports' }
}

describe('derivePrimitiveAliases', () => {
  it('starts from a primitive and discovers one-hop wrappers', () => {
    const result = derivePrimitiveAliases({
      graphNodes: [node('CustomCron')],
      graphEdges: [call('CustomCron', 'Cron')],
      primitiveSymbols: ['Cron'],
      maxDepth: 3,
    })

    expect(result.aliases.CustomCron).toMatchObject({
      primitive: 'Cron',
      depth: 1,
      chain: ['CustomCron', 'Cron'],
    })
  })

  it('discovers three-hop wrappers from the primitive side', () => {
    const result = derivePrimitiveAliases({
      graphNodes: [node('CustomCron'), node('CompanyCron'), node('BaseCron')],
      graphEdges: [
        call('CustomCron', 'CompanyCron'),
        call('CompanyCron', 'BaseCron'),
        call('BaseCron', 'Cron'),
      ],
      primitiveSymbols: ['Cron'],
      maxDepth: 3,
    })

    expect(result.aliases.CustomCron).toMatchObject({
      primitive: 'Cron',
      depth: 3,
      chain: ['CustomCron', 'CompanyCron', 'BaseCron', 'Cron'],
    })
  })

  it('supports member-chain primitives such as router.get', () => {
    const result = derivePrimitiveAliases({
      graphNodes: [node('authGet')],
      graphEdges: [call('authGet', 'get', 'router.get')],
      primitiveSymbols: ['router.get'],
      maxDepth: 3,
    })

    expect(result.aliases.authGet).toMatchObject({
      primitive: 'router.get',
      depth: 1,
    })
  })

  it('does not infer aliases from names that do not reach a primitive', () => {
    const result = derivePrimitiveAliases({
      graphNodes: [node('CustomCron')],
      graphEdges: [call('CustomCron', 'validateCronExpression')],
      primitiveSymbols: ['Cron'],
      maxDepth: 3,
    })

    expect(result.aliases.CustomCron).toBeUndefined()
  })

  it('ignores file nodes and primitive symbols as wrappers', () => {
    const result = derivePrimitiveAliases({
      graphNodes: [node('routes.ts', 'file'), node('Cron')],
      graphEdges: [
        call('routes.ts', 'Cron'),
        call('Cron', 'Cron'),
      ],
      primitiveSymbols: ['Cron'],
      maxDepth: 3,
    })

    expect(result.aliases).toEqual({})
  })

  it('does not overwrite an alias already resolved at a shallower depth', () => {
    const result = derivePrimitiveAliases({
      graphNodes: [node('CustomCron'), node('OtherCron')],
      graphEdges: [
        call('CustomCron', 'Cron'),
        call('OtherCron', 'Cron'),
        call('CustomCron', 'OtherCron'),
      ],
      primitiveSymbols: ['Cron'],
      maxDepth: 3,
    })

    expect(result.aliases.CustomCron.depth).toBe(1)
    expect(result.aliases.CustomCron.chain).toEqual(['CustomCron', 'Cron'])
  })

  it('counts unresolved calls without source node names as unresolved only', () => {
    const result = derivePrimitiveAliases({
      graphNodes: [],
      graphEdges: [call('MissingWrapper', 'Cron')],
      primitiveSymbols: ['Cron'],
      maxDepth: 3,
    })

    expect(result.aliases).toEqual({})
    expect(result.diagnostics.unresolvedEdges).toBe(0)
  })

  it('ignores non-call edges and call cycle edges without target symbols', () => {
    const noTarget = { ...call('A', 'B'), targetSymbol: null }
    const result = derivePrimitiveAliases({
      graphNodes: [node('A')],
      graphEdges: [nonCall('A', 'Cron'), noTarget],
      primitiveSymbols: ['Cron'],
      maxDepth: 3,
    })

    expect(result.aliases).toEqual({})
    expect(result.diagnostics.cyclesSkipped).toBe(0)
  })

  it('stops cycles without throwing', () => {
    const result = derivePrimitiveAliases({
      graphNodes: [node('A'), node('B')],
      graphEdges: [
        call('A', 'B'),
        call('B', 'A'),
      ],
      primitiveSymbols: ['Cron'],
      maxDepth: 3,
    })

    expect(result.aliases).toEqual({})
    expect(result.diagnostics.cyclesSkipped).toBeGreaterThanOrEqual(1)
  })
})
