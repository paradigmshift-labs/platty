/**
 * def-use edge (resolves_to) — F5 persists the receiver→field-declaration link.
 * SOT: docs/build_graph/def-use-symbol-edge.md
 *
 * v1 scope: `this.<field>.<method>()` receiver → the field DECLARATION node (the property node in
 * the calling method's owner class). Structural + language-uniform (no fieldOrigins dependency):
 * any adapter that emits `this.field` call specifiers + property nodes gets the edge.
 */
import { describe, it, expect } from 'vitest'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type { CodeNodeRaw, CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

function makeNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return { repo_id: 'r1', line_start: 1, line_end: 1, signature: null, exported: true, parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null, ...o }
}
function makeCall(o: Partial<CodeEdgeRaw> & { source_id: string; target_specifier: string }): CodeEdgeRaw {
  // real call edges carry chain_path (the receiver) — derive it from the specifier (TS form here)
  const spec = o.target_specifier
  const chain_path = spec.includes('.') ? spec.slice(0, spec.lastIndexOf('.')) : null
  return { repo_id: 'r1', relation: 'calls', target_id: null, target_symbol: null, resolve_status: 'pending', chain_path, ...o }
}

const owner = makeNode({ id: 'r1:src/x.ts:Owner', type: 'class', name: 'Owner', file_path: 'src/x.ts' })
const fn = makeNode({ id: 'r1:src/x.ts:Owner.fn', type: 'method', name: 'Owner.fn', file_path: 'src/x.ts' })
const repo = makeNode({ id: 'r1:src/x.ts:Owner.repo', type: 'property', name: 'Owner.repo', file_path: 'src/x.ts' })

describe('def-use: resolves_to edge (this.<field> → field declaration)', () => {
  it('emits resolves_to from the calling method to the field declaration node', async () => {
    const call = makeCall({ source_id: fn.id, target_specifier: 'this.repo.findMany', target_symbol: 'findMany' })
    const out = await resolveCalls([call], [owner, fn, repo], new Map(), new Map())

    const du = out.find((e) => e.relation === 'resolves_to')
    expect(du, 'a resolves_to edge is emitted').toBeTruthy()
    expect(du!.source_id).toBe(fn.id)            // the calling executable (use site)
    expect(du!.target_id).toBe(repo.id)          // the field DECLARATION (property node)
    expect(du!.resolve_status).toBe('resolved')

    // additive: the original calls edge is still present (def-use is pure insert)
    expect(out.some((e) => e.relation === 'calls' && e.source_id === fn.id), 'calls edge preserved').toBe(true)
  })

  it('works for an external-typed field too (no fieldOrigins needed) — the DSL needs this.http etc.', async () => {
    const http = makeNode({ id: 'r1:src/x.ts:Owner.http', type: 'property', name: 'Owner.http', file_path: 'src/x.ts' })
    const call = makeCall({ source_id: fn.id, target_specifier: 'this.http.get', target_symbol: 'get' })
    const out = await resolveCalls([call], [owner, fn, http], new Map(), new Map())
    const du = out.find((e) => e.relation === 'resolves_to')
    expect(du?.target_id).toBe(http.id)
  })

  it('dedups to ONE resolves_to per (method, field) even with multiple calls through the field', async () => {
    const c1 = makeCall({ source_id: fn.id, target_specifier: 'this.repo.findMany', target_symbol: 'findMany' })
    const c2 = makeCall({ source_id: fn.id, target_specifier: 'this.repo.create', target_symbol: 'create' })
    const out = await resolveCalls([c1, c2], [owner, fn, repo], new Map(), new Map())
    const dus = out.filter((e) => e.relation === 'resolves_to' && e.target_id === repo.id)
    expect(dus).toHaveLength(1)
  })

  it('nested field chain (this.prisma.user.findMany) → resolves_to the FIELD (prisma) — DB-anchor DSL needs this', async () => {
    const prisma = makeNode({ id: 'r1:src/x.ts:Owner.prisma', type: 'property', name: 'Owner.prisma', file_path: 'src/x.ts' })
    const call = makeCall({ source_id: fn.id, target_specifier: 'this.prisma.user.findMany', target_symbol: 'findMany' })
    const out = await resolveCalls([call], [owner, fn, prisma], new Map(), new Map())
    const du = out.find((e) => e.relation === 'resolves_to')
    expect(du?.target_id).toBe(prisma.id)
  })

  it('cross-chain dedup: findById (chain this.repo) + its chained .orElse (chain this.repo.findById) → ONE resolves_to → repo', async () => {
    const findById = makeCall({ source_id: fn.id, target_specifier: 'this.repo.findById', target_symbol: 'findById' })
    const orElse = makeCall({ source_id: fn.id, target_specifier: 'this.repo.findById.orElse', target_symbol: 'orElse' })
    const out = await resolveCalls([findById, orElse], [owner, fn, repo], new Map(), new Map())
    const dus = out.filter((e) => e.relation === 'resolves_to' && e.target_id === repo.id)
    expect(dus).toHaveLength(1)
  })

  it('cross-file imported module-const receiver → resolves_to its declaration (import { http } from "./http"; http.get())', async () => {
    // 래퍼가 다른 파일에서 import된 변수(`http`)일 때, 수신자 http를 그 선언 노드로 잇는다.
    // 이게 있어야 build_route가 imports 안전망 없이 calls/resolves_to로 래퍼에 닿는다(과수집 제거의 선결).
    const file = makeNode({ id: 'r1:src/repo.ts', type: 'file', name: 'repo.ts', file_path: 'src/repo.ts' })
    const loadOrders = makeNode({ id: 'r1:src/repo.ts:loadOrders', type: 'function', name: 'loadOrders', file_path: 'src/repo.ts' })
    const httpDecl = makeNode({ id: 'r1:src/http.ts:http', type: 'variable', name: 'http', file_path: 'src/http.ts' })
    const call = makeCall({ source_id: loadOrders.id, target_specifier: 'http.get', target_symbol: 'get' })
    const importEdge = {
      repo_id: 'r1', relation: 'imports' as const, source_id: file.id, target_id: httpDecl.id,
      target_specifier: './http', target_symbol: 'http', resolve_status: 'resolved' as const, chain_path: null,
    } as CodeEdgeRaw
    const out = await resolveCalls([call, importEdge], [file, loadOrders, httpDecl], new Map(), new Map())

    const du = out.find((e) => e.relation === 'resolves_to' && e.target_id === httpDecl.id)
    expect(du, 'resolves_to from call site to the imported http wrapper declaration').toBeTruthy()
    expect(du!.source_id).toBe(loadOrders.id)
  })

  it('NEGATIVE: no field declaration node in graph → no resolves_to (no dangling edge)', async () => {
    const call = makeCall({ source_id: fn.id, target_specifier: 'this.repo.findMany', target_symbol: 'findMany' })
    const out = await resolveCalls([call], [owner, fn], new Map(), new Map())   // no repo property node
    expect(out.some((e) => e.relation === 'resolves_to')).toBe(false)
  })

  it('NEGATIVE: target node is a method (not a property) → no resolves_to (v1 = field declarations only)', async () => {
    const repoMethod = makeNode({ id: 'r1:src/x.ts:Owner.repo', type: 'method', name: 'Owner.repo', file_path: 'src/x.ts' })
    const call = makeCall({ source_id: fn.id, target_specifier: 'this.repo.findMany', target_symbol: 'findMany' })
    const out = await resolveCalls([call], [owner, fn, repoMethod], new Map(), new Map())
    expect(out.some((e) => e.relation === 'resolves_to')).toBe(false)
  })

  it('NEGATIVE: call source is a top-level function (no owner class) → no resolves_to', async () => {
    const looseFn = makeNode({ id: 'r1:src/x.ts:looseFn', type: 'function', name: 'looseFn', file_path: 'src/x.ts' })
    const call = makeCall({ source_id: looseFn.id, target_specifier: 'this.repo.find', target_symbol: 'find' })
    const out = await resolveCalls([call], [looseFn], new Map(), new Map())
    expect(out.some((e) => e.relation === 'resolves_to')).toBe(false)
  })
})
