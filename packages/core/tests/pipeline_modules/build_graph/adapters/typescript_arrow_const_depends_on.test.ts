/**
 * build_graph TS adapter — callable-valued bindings (arrow/function-expression assigned to const)
 * must emit the same body `depends_on` edges as function declarations (P19-B parity).
 *
 * Spec: specs/build_graph/callable-valued-binding-depends-on.md
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'

const adapter = new TypeScriptParserAdapter()

function dependsOn(edges: readonly any[], symbol: string, sourceSuffix: string): boolean {
  return edges.some(
    (e) =>
      e.relation === 'depends_on' &&
      e.target_symbol === symbol &&
      String(e.source_id).endsWith(sourceSuffix),
  )
}

describe('arrow-const callable binding → depends_on (P19-B parity)', () => {
  it('AC-01: expr-body arrow `const getDb = () => prisma` emits depends_on(getDb→prisma)', () => {
    const r = adapter.parseFile(
      `import { prisma } from './client'
export const getDb = () => prisma`,
      'src/db.ts',
      'r1',
    ) as { edges: any[] }
    expect(dependsOn(r.edges, 'prisma', ':getDb'), 'depends_on getDb→prisma').toBe(true)
  })

  it('AC-02: block-body arrow `const getDb = (tx) => { return tx ?? prisma }` emits depends_on', () => {
    const r = adapter.parseFile(
      `import { prisma } from './client'
export const getDb = (tx?: any) => { return tx ?? prisma }`,
      'src/db.ts',
      'r1',
    ) as { edges: any[] }
    expect(dependsOn(r.edges, 'prisma', ':getDb'), 'depends_on getDb→prisma').toBe(true)
  })

  it('AC-03 (negative): arrow referencing only a local (not import-bound) emits no depends_on for it', () => {
    const r = adapter.parseFile(
      `const local = 1
export const getX = () => local`,
      'src/x.ts',
      'r1',
    ) as { edges: any[] }
    expect(dependsOn(r.edges, 'local', ':getX'), 'no depends_on to a local binding').toBe(false)
  })
})
