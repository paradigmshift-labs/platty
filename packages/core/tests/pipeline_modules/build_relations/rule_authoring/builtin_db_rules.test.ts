import { describe, it, expect } from 'vitest'
import { PRISMA_EMIT_RULE, BUILTIN_DB_ACCESS_RULES } from '@/pipeline_modules/build_relations/rule_authoring/builtin_db_rules.js'
import { PRISMA_METHODS } from '@/pipeline_modules/build_relations/adapters/db/prisma.js'
import { OPERATION_MAP } from '@/pipeline_modules/build_relations/resolvers/db_access.js'

// The built-in prisma DATA rule must be FAITHFULLY DERIVED from the imperative source so the dual-run
// compares like-for-like: same method surface (PRISMA_METHODS), same operation mapping (OPERATION_MAP).

describe('G2 builtin db data rules — prisma', () => {
  it('covers exactly the imperative PRISMA_METHODS, operations from the shared OPERATION_MAP', () => {
    expect(new Set(Object.keys(PRISMA_EMIT_RULE.operationByMethod))).toEqual(PRISMA_METHODS)
    for (const m of PRISMA_METHODS) {
      expect(PRISMA_EMIT_RULE.operationByMethod[m]).toBe(OPERATION_MAP[m] ?? 'execute')
    }
  })

  it('targets @prisma/client and reads the table off the chain', () => {
    expect(PRISMA_EMIT_RULE.ormLabel).toBe('prisma')
    expect(PRISMA_EMIT_RULE.clientPackages).toContain('@prisma/client')
    expect(PRISMA_EMIT_RULE.tableSource).toBe('chain')
  })

  it('is registered in the built-in set (the migrated-so-far data tier)', () => {
    expect(BUILTIN_DB_ACCESS_RULES).toContain(PRISMA_EMIT_RULE)
  })
})
