/**
 * BG-3 — surface a template-literal endpoint's staticPattern into call.first_arg.
 * SOT: docs/build_graph/def-use-symbol-edge.md (BG-3).
 *
 * build_graph already computes `arg_expressions[0] = { kind:'template', staticPattern:'/api/orders/:id' }`
 * but leaves first_arg=null, so the downstream api_call referee (which reads first_arg) drops dynamic
 * endpoints. BG-3 moves the already-computed staticPattern into first_arg. Universal (F5, all adapters).
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'

describe('BG-3: template-literal endpoint → first_arg', () => {
  it('fetch(`/api/orders/${id}`) surfaces staticPattern into first_arg', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      'async function f(id: string){ return fetch(`/api/orders/${id}`) }',
      'f.ts', 'r1',
    )
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const call = out.find((e) => e.relation === 'calls' && e.target_symbol === 'fetch')
    expect(call?.first_arg, 'template staticPattern surfaced').toBe('/api/orders/:id')
  })

  it('does NOT overwrite an existing static-string first_arg', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      `async function f(){ return fetch('/api/orders') }`,
      'f.ts', 'r1',
    )
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const call = out.find((e) => e.relation === 'calls' && e.target_symbol === 'fetch')
    expect(call?.first_arg).toBe('/api/orders')
  })

  it('does NOT surface a non-endpoint template (log/UI string) into first_arg', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      'function f(e){ logger.error(`failed: ${e}`) }',
      'f.ts', 'r1',
    )
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const call = out.find((e) => e.relation === 'calls' && e.target_symbol === 'error')
    // `failed: :e` is not endpoint-like (no leading / or http) → first_arg stays null
    expect(call?.first_arg ?? null).toBe(null)
  })

  it('leaves first_arg null when the first arg is a plain non-template (no staticPattern)', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      `async function f(u){ return fetch(u) }`,
      'f.ts', 'r1',
    )
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const call = out.find((e) => e.relation === 'calls' && e.target_symbol === 'fetch')
    // a bare identifier arg has no staticPattern → first_arg stays null (unchanged)
    expect(call?.first_arg ?? null).toBe(null)
  })
})
