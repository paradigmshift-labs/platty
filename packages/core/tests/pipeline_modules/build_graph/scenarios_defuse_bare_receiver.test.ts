/**
 * def-use across languages — BARE field receivers (Kotlin/Dart write `repo.find()`, not `this.repo.find()`).
 * SOT: docs/build_graph/def-use-symbol-edge.md.
 *
 * The field property node already exists for Kotlin (primary-ctor val) and Dart (class field + this.x ctor),
 * but v1 Pass C only matched explicit `this.<field>`. chain_path is the uniform receiver across langs
 * (TS 'this.repo' / Kotlin 'repo' / Dart 'repo'), so Pass C keys off chain_path → bare receivers covered.
 */
import { describe, it, expect } from 'vitest'
import { JvmAstParserAdapter } from '@/pipeline_modules/build_graph/adapters/jvm_ast'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'

describe('def-use: bare field receiver (Kotlin/Dart) → resolves_to', () => {
  it('Kotlin primary-ctor DI: repo.findById() → resolves_to S.get → S.repo', async () => {
    const kt = await JvmAstParserAdapter.create()
    const r = kt.parseFile(
      `package x\nclass S(private val repo: OrderRepository) {\n  fun get(id: Long): Any = repo.findById(id)\n}`,
      'src/main/kotlin/x/S.kt', 'r1',
    )
    const repoNode = r.nodes.find((n) => n.type === 'property' && n.name === 'S.repo')
    expect(repoNode, 'Kotlin primary-ctor property node').toBeTruthy()
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const du = out.find((e) => e.relation === 'resolves_to' && e.target_id === repoNode!.id)
    expect(du, 'bare receiver resolves_to (no explicit this.)').toBeTruthy()
    expect(du!.source_id.endsWith('S.get')).toBe(true)
  })

  it('BG-4 Kotlin LOCAL var: val repo = makeRepo(); repo.findById() → resolves_to the local var', async () => {
    const kt = await JvmAstParserAdapter.create()
    const r = kt.parseFile(
      `package x\nclass S {\n  fun m() {\n    val repo = makeRepo()\n    repo.findById(1)\n  }\n}`,
      'src/main/kotlin/x/S.kt', 'r1',
    )
    const varNode = r.nodes.find((n) => n.type === 'variable' && n.id.endsWith('S.m.repo'))
    expect(varNode, 'Kotlin local var node').toBeTruthy()
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    expect(out.some((e) => e.relation === 'resolves_to' && e.target_id === varNode?.id), 'Kotlin local var resolves_to').toBe(true)
  })

  it('BG-4 Dart LOCAL var: final repo = makeRepo(); repo.findById() → resolves_to the local var', async () => {
    const da = await DartParserAdapter.create()
    const r = da.parseFile(
      `class S {\n  void m() {\n    final repo = makeRepo();\n    repo.findById(1);\n  }\n}`,
      'lib/s.dart', 'r1',
    )
    const varNode = r.nodes.find((n) => n.type === 'variable' && n.id.endsWith('S.m.repo'))
    expect(varNode, 'Dart local var node').toBeTruthy()
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    expect(out.some((e) => e.relation === 'resolves_to' && e.target_id === varNode?.id), 'Dart local var resolves_to').toBe(true)
  })

  it('Dart ctor field-init DI: repo.findById() → resolves_to S.fetch → S.repo', async () => {
    const da = await DartParserAdapter.create()
    const r = da.parseFile(
      `class S {\n  final OrderRepo repo;\n  S(this.repo);\n  fetch(id) => repo.findById(id);\n}`,
      'lib/s.dart', 'r1',
    )
    const repoNode = r.nodes.find((n) => n.type === 'property' && n.name === 'S.repo')
    expect(repoNode, 'Dart field property node').toBeTruthy()
    const out = await resolveCalls(r.edges, r.nodes, new Map(), new Map(), r.fieldOrigins)
    const du = out.find((e) => e.relation === 'resolves_to' && e.target_id === repoNode!.id)
    expect(du, 'bare receiver resolves_to (no explicit this.)').toBeTruthy()
  })
})
