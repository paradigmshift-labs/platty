/**
 * Transparent value-preserving wrappers at the chain root (TW-01 ~ TW-11)
 *
 * SOT: adversarial probe (calledge-scenario-probe) found 9 dropped-edge gaps that all share one
 *      root cause — a value-identity wrapper at/near the chain root made getRootObject /
 *      findChainRootIdentifier bail before reaching the bound identifier, so NO calls edge was emitted.
 *
 *      Transparent wrappers (a static analyzer can strip with zero ambiguity — runtime value is identical):
 *        - parenthesized_expression   (...)
 *        - await_expression           await x   (only when it is the RECEIVER, not the whole call)
 *        - non_null_expression        x!        (TS-only type assertion)
 *
 *      Intentionally NOT stripped (would require guessing or is a distinct feature):
 *        - nullish/binary receiver   (a ?? b).x()   → two possible objects, no single root
 *        - as / satisfies cast       (x as any).y() → deferred (value-identity but flagged out-of-scope)
 *        - computed / subscript      x[k].y()       → dynamic key
 *
 * Generalized, repo-agnostic. TS only here (Dart already handles its selector chains; spec field is optional).
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string, filePath = 'src/test.ts', repoId = 'repo1') {
  return adapter.parseFile(content, filePath, repoId)
}

function callEdge(r: { edges: readonly any[] }, symbol: string) {
  return r.edges.find((e: any) => e.relation === 'calls' && e.target_symbol === symbol)
}

describe('Transparent value-preserving wrappers at chain root', () => {
  it('TW-01: (getClient()).user.find() → find edge, specifier resolves, chain_path keeps source text', () => {
    const r = parse(`
import { getClient } from './client'
export function f() {
  return (getClient()).user.find({ id: 1 })
}
`)
    const e = callEdge(r, 'find')
    expect(e, 'find edge through parenthesized factory root').toBeDefined()
    expect(e?.target_specifier).toBe('./client')
    expect(e?.chain_path).toBe('(getClient()).user')
  })

  it('TW-02: (await getClient()).user.find() → find edge, specifier resolves', () => {
    const r = parse(`
import { getClient } from './client'
export async function f() {
  return (await getClient()).user.find({ id: 1 })
}
`)
    const e = callEdge(r, 'find')
    expect(e, 'find edge through paren+await factory root').toBeDefined()
    expect(e?.target_specifier).toBe('./client')
  })

  it('TW-03: getClient()!.user.find() → find edge, specifier resolves', () => {
    const r = parse(`
import { getClient } from './client'
export function f() {
  return getClient()!.user.find({ id: 1 })
}
`)
    const e = callEdge(r, 'find')
    expect(e, 'find edge through non-null factory root').toBeDefined()
    expect(e?.target_specifier).toBe('./client')
  })

  it('TW-04: client!.user.find() → find edge, specifier resolves, chain_path=client!.user', () => {
    const r = parse(`
import { client } from './client'
export function f() {
  return client!.user.find({ id: 1 })
}
`)
    const e = callEdge(r, 'find')
    expect(e, 'find edge through non-null identifier root').toBeDefined()
    expect(e?.target_specifier).toBe('./client')
    expect(e?.chain_path).toBe('client!.user')
  })

  it('TW-05: (await getClient())!.user.find() → find edge (stacked wrappers unwrap recursively)', () => {
    const r = parse(`
import { getClient } from './client'
export async function f() {
  return (await getClient())!.user.find({ id: 1 })
}
`)
    const e = callEdge(r, 'find')
    expect(e, 'find edge through stacked non-null+paren+await root').toBeDefined()
    expect(e?.target_specifier).toBe('./client')
  })

  it('TW-06: (getClient()).find() → find edge (single property off parenthesized call)', () => {
    const r = parse(`
import { getClient } from './client'
export function f() {
  return (getClient()).find({ id: 1 })
}
`)
    const e = callEdge(r, 'find')
    expect(e, 'find edge single-property off paren call').toBeDefined()
    expect(e?.target_specifier).toBe('./client')
  })

  it('TW-07: (new Foo()).a.run() → run edge, specifier resolves to ctor import', () => {
    const r = parse(`
import { Foo } from './foo'
export function f() {
  return (new Foo()).a.run()
}
`)
    const e = callEdge(r, 'run')
    expect(e, 'run edge through parenthesized new root').toBeDefined()
    expect(e?.target_specifier).toBe('./foo')
  })

  it('TW-08 (guard): (a ?? b).user.find() → NO find edge (ambiguous receiver, no crash)', () => {
    const r = parse(`
export function f(a: any, b: any) {
  return (a ?? b).user.find({ id: 1 })
}
`)
    // two possible objects → no single unambiguous root → conservative no-emit
    expect(callEdge(r, 'find'), 'nullish receiver must not emit a resolved edge').toBeUndefined()
  })

  it('TW-09 (guard): (getDb(tx) as any).user.update() → NO update edge (as-cast deferred, no crash)', () => {
    const r = parse(`
import { getDb } from './db'
export function f(tx: any) {
  return (getDb(tx) as any).user.update({})
}
`)
    // as/satisfies casts are value-identity but intentionally out of scope for now
    expect(callEdge(r, 'update'), 'as-cast receiver currently does not emit (documented)').toBeUndefined()
  })

  it('TW-10: getDb(tx).user.update!() → update edge (non-null on the callee itself)', () => {
    const r = parse(`
import { getDb } from './db'
export function f(tx: any) {
  return getDb(tx).user.update!({ where: { id: 1 } })
}
`)
    const e = callEdge(r, 'update')
    expect(e, 'update edge with non-null assertion on the callee').toBeDefined()
    expect(e?.target_specifier).toBe('./db')
  })

  it('TW-11 (works-lock): new PrismaClient().user.findMany() → findMany edge, specifier resolves', () => {
    const r = parse(`
import { PrismaClient } from '@prisma/client'
export async function f() {
  return new PrismaClient().user.findMany()
}
`)
    const e = callEdge(r, 'findMany')
    expect(e, 'new-rooted chain still emits').toBeDefined()
    expect(e?.target_specifier).toBe('@prisma/client')
  })
})
