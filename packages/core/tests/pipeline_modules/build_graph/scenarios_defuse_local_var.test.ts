/**
 * def-use v2-2 — LOCAL VARIABLE receivers (Express mount-prefix pattern).
 * SOT: docs/build_graph/def-use-symbol-edge.md §v2 (v2-2).
 *
 * `const router = Router(); router.get('/x')` — `router` is a local variable, not a field. v2-2 emits a
 * `variable` node for receiver-used locals (id = `{enclosingScopeId}.{name}`) so v1 Pass C resolves the
 * bare receiver → that declaration. Enables build_route mount-prefix (app.use('/api', router)) downstream.
 * Scope (user-decided): receiver-used locals only; TS first.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'

describe('def-use v2-2: local variable receiver → resolves_to', () => {
  it('const router = Router(); router.get() → variable node + resolves_to from the enclosing fn', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      `import { Router } from 'express'\nexport function setup(app) {\n  const router = Router()\n  router.get('/orders', h)\n  app.use('/api', router)\n}`,
      'src/routes.ts', 'r1',
    )
    const VAR_ID = 'r1:src/routes.ts:setup.router'
    const FN_ID = 'r1:src/routes.ts:setup'

    const varNode = r.nodes.find((n) => n.type === 'variable' && n.id === VAR_ID)
    expect(varNode, 'receiver-used local var node').toBeTruthy()

    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const du = out.find((e) => e.relation === 'resolves_to' && e.target_id === VAR_ID)
    expect(du, 'resolves_to setup → router (local var)').toBeTruthy()
    expect(du!.source_id).toBe(FN_ID)
  })

  it('BG-1: MODULE-scope const router = Router(); router.get() → resolves_to the module variable node', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      `import { Router } from 'express'\nconst router = Router()\nrouter.get('/users', h)\napp.use('/api', router)`,
      'app.ts', 'r1',
    )
    const VAR_ID = 'r1:app.ts:router'
    expect(r.nodes.some((n) => n.type === 'variable' && n.id === VAR_ID), 'module const var node exists').toBe(true)
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const du = out.find((e) => e.relation === 'resolves_to' && e.target_id === VAR_ID)
    expect(du, 'router.get → module const router (mount-prefix receiver half)').toBeTruthy()
    expect(du!.source_id).toBe('r1:app.ts')   // call sits at module scope (file node)
  })

  it('BG-1: a function referencing a module-scope const resolves to it', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      `const db = makeDb()\nexport function q() { return db.query('x') }`,
      'app.ts', 'r1',
    )
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const du = out.find((e) => e.relation === 'resolves_to' && e.target_id === 'r1:app.ts:db')
    expect(du, 'db.query in q() → module const db').toBeTruthy()
    expect(du!.source_id).toBe('r1:app.ts:q')
  })

  it('BG-2: a variable passed as a CALL ARGUMENT resolves to its declaration (mount-prefix arg half)', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      `import { Router } from 'express'\nconst router = Router()\nexport function mount(app) {\n  app.use('/api', router)\n}`,
      'app.ts', 'r1',
    )
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    // the `router` ARGUMENT of app.use(...) resolves to the module const declaration
    const du = out.find((e) => e.relation === 'resolves_to' && e.target_id === 'r1:app.ts:router' && e.source_id === 'r1:app.ts:mount')
    expect(du, 'arg router → module const router').toBeTruthy()
  })

  it('BG-2 NEGATIVE: a string/literal argument (not an identifier) produces no resolves_to', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      `export function mount(app) {\n  app.use('/api', '/static')\n}`,
      'app.ts', 'r1',
    )
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    expect(out.some((e) => e.relation === 'resolves_to')).toBe(false)
  })

  it('NEGATIVE: a local var that is NOT used as a receiver gets no variable node (receiver-used only)', async () => {
    const adapter = new TypeScriptParserAdapter()
    const r = await adapter.parseFile(
      `export function f() {\n  const total = 5\n  return total + 1\n}`,
      'src/x.ts', 'r1',
    )
    expect(r.nodes.some((n) => n.type === 'variable' && n.id === 'r1:src/x.ts:f.total')).toBe(false)
  })
})
