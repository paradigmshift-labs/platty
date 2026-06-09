import { describe, expect, it } from 'vitest'
import { validatePatternDslRules } from '@/pipeline_modules/shared/static_config/validate_rules.js'
import type { StaticAnalysisPatternRule } from '@/pipeline_modules/shared/static_config/types.js'

function rule(partial: Partial<StaticAnalysisPatternRule> & { id: string }): StaticAnalysisPatternRule {
  return {
    state: 'active',
    source: 'user',
    target: 'relation.db_access',
    match: {
      relation: 'calls',
      targetSymbolIn: ['findMany'],
      chainPathPattern: '{client}.{model}',
    },
    emit: {
      targetFrom: 'chainPathSegment:model',
      operationFrom: 'targetSymbol',
    },
    ...partial,
  }
}

describe('validatePatternDslRules', () => {
  it('accepts a clean rule set with no diagnostics', () => {
    const result = validatePatternDslRules([
      rule({ id: 'db.prisma.direct' }),
      rule({
        id: 'route.jsx.wrapper',
        target: 'route.entrypoint',
        match: { relation: 'renders', targetSymbolIn: ['AppRoute'], literalArgKey: 'path' },
        emit: { targetFrom: 'literalArg:path', operationValue: 'GET' },
      }),
    ])

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.conflicts).toEqual([])
  })

  it('flags duplicate rule ids on each occurrence', () => {
    const result = validatePatternDslRules([
      rule({ id: 'dup' }),
      rule({ id: 'dup', emit: { targetFrom: 'chainPathSegment:model', operationFrom: 'targetSymbol' } }),
      rule({ id: 'unique' }),
    ])

    const dup = result.errors.filter((e) => e.code === 'duplicate_rule_id')
    expect(dup).toHaveLength(2)
    expect(dup.every((e) => e.ruleId === 'dup')).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('rejects blank rule ids', () => {
    const result = validatePatternDslRules([rule({ id: '   ' })])

    expect(result.errors.some((e) => e.code === 'invalid_rule_id')).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('rejects an unknown state', () => {
    const result = validatePatternDslRules([
      rule({ id: 'r', state: 'enabled' as StaticAnalysisPatternRule['state'] }),
    ])

    expect(result.errors).toEqual([
      expect.objectContaining({ ruleId: 'r', code: 'invalid_state', severity: 'error' }),
    ])
    expect(result.valid).toBe(false)
  })

  it('rejects an unknown source', () => {
    const result = validatePatternDslRules([
      rule({ id: 'r', source: 'rogue' as StaticAnalysisPatternRule['source'] }),
    ])

    expect(result.errors.some((e) => e.code === 'invalid_source' && e.ruleId === 'r')).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('rejects an unknown target', () => {
    const result = validatePatternDslRules([
      rule({ id: 'r', target: 'relation.unknown' as StaticAnalysisPatternRule['target'] }),
    ])

    expect(result.errors.some((e) => e.code === 'invalid_target' && e.ruleId === 'r')).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('rejects a blank match.relation', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'r',
        match: { relation: '  ', targetSymbolIn: ['get'] },
        emit: { targetFrom: 'firstArg', operationValue: 'GET' },
      }),
    ])

    expect(result.errors.some((e) => e.code === 'missing_relation' && e.ruleId === 'r')).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('warns when a match has only a relation and no discriminating predicate', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'broad',
        match: { relation: 'calls' },
        emit: { targetFrom: 'firstArg', operationValue: 'GET' },
      }),
    ])

    expect(result.warnings).toEqual([
      expect.objectContaining({ ruleId: 'broad', code: 'broad_match', severity: 'warning' }),
    ])
    // a broad_match warning alone does not make the set invalid
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('does not warn broad_match when any discriminating predicate is present', () => {
    const predicates = [
      { targetSymbolIn: ['get'] },
      { chainPathEquals: 'apiClient' },
      { chainPathPrefix: 'this.prisma' },
      { chainPathPattern: '{client}.{model}' },
      { decoratorName: 'AdminGet' },
      { literalArgKey: 'path' },
      { fileGlob: 'src/routes/**' },
      { importsContain: { packageName: 'axios' } },
    ]
    for (const predicate of predicates) {
      const result = validatePatternDslRules([
        rule({
          id: 'r',
          match: { relation: 'calls', ...predicate },
          emit: { targetFrom: 'firstArg', operationValue: 'GET' },
        }),
      ])
      expect(result.warnings.some((w) => w.code === 'broad_match')).toBe(false)
    }
  })

  it('rejects targetFrom captures not bound by chainPathPattern', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'r',
        match: { relation: 'calls', chainPathPattern: 'foo.{client}' },
        emit: { targetFrom: 'chainPathSegment:model', operationFrom: 'targetSymbol' },
      }),
    ])

    expect(result.errors.some((e) => e.code === 'unbound_capture' && e.ruleId === 'r')).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('rejects operationFrom captures not bound by chainPathPattern', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'r',
        match: { relation: 'calls', chainPathPattern: 'foo.{client}' },
        emit: { targetFrom: 'chainPathSegment:client', operationFrom: 'chainPathCallArg:entity' },
      }),
    ])

    expect(result.errors.some((e) => e.code === 'unbound_capture' && e.ruleId === 'r')).toBe(true)
    expect(result.valid).toBe(false)
  })

  it('accepts captures that are bound by chainPathPattern', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'r',
        match: { relation: 'calls', chainPathPattern: 'prismaRepository({model})', targetSymbolIn: ['find'] },
        emit: { targetFrom: 'chainPathCallArg:model', operationFrom: 'targetSymbol' },
      }),
    ])

    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('rejects a capture when chainPathPattern is absent entirely', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'r',
        match: { relation: 'calls', targetSymbolIn: ['find'] },
        emit: { targetFrom: 'chainPathSegment:model', operationFrom: 'targetSymbol' },
      }),
    ])

    expect(result.errors.some((e) => e.code === 'unbound_capture')).toBe(true)
  })

  it('does NOT flag literalArg emit without a matching literalArgKey (engine reads literalArgs independently)', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'r',
        target: 'route.entrypoint',
        match: { relation: 'renders', targetSymbolIn: ['AppRoute'] },
        emit: { targetFrom: 'literalArg:path', operationValue: 'GET' },
      }),
    ])

    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('reports an emit_conflict between two active overlapping rules with different emit', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'a',
        target: 'relation.db_access',
        match: { relation: 'calls', targetSymbolIn: ['find'], chainPathPattern: 'repo({model})' },
        emit: { targetFrom: 'chainPathCallArg:model', operationValue: 'select' },
      }),
      rule({
        id: 'b',
        target: 'relation.db_access',
        match: { relation: 'calls', targetSymbolIn: ['find'], chainPathPattern: 'repo({model})' },
        emit: { targetFrom: 'chainPathCallArg:model', operationValue: 'read' },
      }),
    ])

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        code: 'emit_conflict',
        ruleIds: expect.arrayContaining(['a', 'b']),
      }),
    ])
  })

  it('does not flag a conflict for non-overlapping rules', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'a',
        target: 'relation.db_access',
        match: { relation: 'calls', targetSymbolIn: ['find'], chainPathPattern: 'repo({model})' },
        emit: { targetFrom: 'chainPathCallArg:model', operationValue: 'select' },
      }),
      rule({
        id: 'b',
        target: 'relation.db_access',
        match: { relation: 'calls', targetSymbolIn: ['save'], chainPathPattern: 'repo({model})' },
        emit: { targetFrom: 'chainPathCallArg:model', operationValue: 'write' },
      }),
    ])

    expect(result.conflicts).toEqual([])
  })

  it('does not flag a conflict when the emit is identical', () => {
    const shared = {
      target: 'relation.db_access' as const,
      match: { relation: 'calls', targetSymbolIn: ['find'], chainPathPattern: 'repo({model})' },
      emit: { targetFrom: 'chainPathCallArg:model' as const, operationValue: 'select' },
    }
    const result = validatePatternDslRules([rule({ id: 'a', ...shared }), rule({ id: 'b', ...shared })])

    expect(result.conflicts).toEqual([])
  })

  it('does not flag a conflict when the targets differ', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'a',
        target: 'relation.db_access',
        match: { relation: 'calls', targetSymbolIn: ['find'], chainPathPattern: 'repo({model})' },
        emit: { targetFrom: 'chainPathCallArg:model', operationValue: 'select' },
      }),
      rule({
        id: 'b',
        target: 'relation.api_call',
        match: { relation: 'calls', targetSymbolIn: ['find'], chainPathPattern: 'repo({model})' },
        emit: { targetFrom: 'chainPathCallArg:model', operationValue: 'read' },
      }),
    ])

    expect(result.conflicts).toEqual([])
  })

  it('does not flag conflicts for non-active overlapping rules', () => {
    const result = validatePatternDslRules([
      rule({
        id: 'a',
        state: 'candidate',
        target: 'relation.db_access',
        match: { relation: 'calls', targetSymbolIn: ['find'], chainPathPattern: 'repo({model})' },
        emit: { targetFrom: 'chainPathCallArg:model', operationValue: 'select' },
      }),
      rule({
        id: 'b',
        state: 'candidate',
        target: 'relation.db_access',
        match: { relation: 'calls', targetSymbolIn: ['find'], chainPathPattern: 'repo({model})' },
        emit: { targetFrom: 'chainPathCallArg:model', operationValue: 'read' },
      }),
    ])

    expect(result.conflicts).toEqual([])
  })

  it('returns valid:true on an empty rule set', () => {
    expect(validatePatternDslRules([])).toEqual({
      errors: [],
      warnings: [],
      conflicts: [],
      valid: true,
    })
  })
})
