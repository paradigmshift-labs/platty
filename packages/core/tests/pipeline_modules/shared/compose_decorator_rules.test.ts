import { describe, expect, it } from 'vitest'
import { composeCustomDecoratorRules } from '@/pipeline_modules/shared/static_config/compose_decorator_rules.js'
import { matchPatternDslRules } from '@/pipeline_modules/shared/static_config/pattern_dsl.js'
import type { ConfiguredCustomDecorator } from '@/pipeline_modules/shared/static_config/types.js'
import type { CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'

const evidence = {
  confidence: 'high' as const,
  source: 'manual' as const,
  evidenceNodeIds: [],
  filePaths: [],
  builtFromCommit: null,
  reason: 'configured',
}

function decorator(resolvesTo: string, source = '@my-org/decorators'): ConfiguredCustomDecorator {
  return { resolvesTo, source, evidence, configSource: 'user' }
}

const baseEdge: CodeEdgeLike = {
  id: 1,
  repoId: 'r1',
  sourceId: 'r1:src/file.ts:handler',
  targetId: null,
  relation: 'decorates',
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
}

function edge(partial: Partial<CodeEdgeLike>): CodeEdgeLike {
  return { ...baseEdge, ...partial }
}

describe('composeCustomDecoratorRules', () => {
  it('produces a route.entrypoint rule mapping the resolved verb to an operation', () => {
    const rules = composeCustomDecoratorRules({ AdminPost: decorator('Post') })

    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      id: 'route.custom.AdminPost',
      target: 'route.entrypoint',
      state: 'active',
      source: 'user',
      match: {
        relation: 'decorates',
        decoratorName: 'AdminPost',
        importsContain: { packageName: '@my-org/decorators' },
      },
      emit: {
        targetFrom: 'firstArg',
        operationValue: 'POST',
      },
    })
  })

  it('matches a decorates edge and emits a route.entrypoint fact through the engine', () => {
    const rules = composeCustomDecoratorRules({ AdminPost: decorator('Post') })

    const facts = matchPatternDslRules({
      rules,
      nodes: [{
        id: baseEdge.sourceId,
        repoId: 'r1',
        type: 'function',
        name: 'handler',
        filePath: 'src/file.ts',
        lineStart: 1,
        lineEnd: 5,
        isTest: false,
        parseStatus: 'ok',
      }],
      edges: [
        edge({
          id: 2,
          relation: 'imports',
          targetSpecifier: '@my-org/decorators',
        }),
        edge({ targetSymbol: 'AdminPost', firstArg: '/admin/users' }),
      ],
    })

    expect(facts[0]).toMatchObject({
      ruleId: 'route.custom.AdminPost',
      factKind: 'route.entrypoint',
      target: '/admin/users',
      operation: 'POST',
    })
  })

  it('defaults non-HTTP-verb decorators to GET while keeping firstArg target', () => {
    const rules = composeCustomDecoratorRules({ Cached: decorator('Memoize') })

    expect(rules[0]).toMatchObject({
      id: 'route.custom.Cached',
      emit: { targetFrom: 'firstArg', operationValue: 'GET' },
    })
  })

  it('omits the import anchor when the decorator carries no source', () => {
    const noSource: ConfiguredCustomDecorator = { resolvesTo: 'Get', source: '', evidence, configSource: 'user' }
    const rules = composeCustomDecoratorRules({ BareGet: noSource })

    expect(rules[0].match.importsContain).toBeUndefined()
    expect(rules[0].emit.operationValue).toBe('GET')
  })

  it('passes the configured rule source through and produces one rule per decorator', () => {
    const rules = composeCustomDecoratorRules(
      { AdminGet: decorator('Get'), AdminDelete: decorator('Delete') },
      'approved',
    )

    expect(rules.map((rule) => rule.id)).toEqual(['route.custom.AdminGet', 'route.custom.AdminDelete'])
    expect(rules.map((rule) => rule.source)).toEqual(['approved', 'approved'])
    expect(rules.map((rule) => rule.emit.operationValue)).toEqual(['GET', 'DELETE'])
  })

  it('returns an empty array for empty input', () => {
    expect(composeCustomDecoratorRules({})).toEqual([])
  })
})
