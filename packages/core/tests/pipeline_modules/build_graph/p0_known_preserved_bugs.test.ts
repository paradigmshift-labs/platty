// P0 known-preserved-bug pins — Phase P0 (item f)
//
// SOT: specs/build_graph/codegraph-unification-plan.md §3 (P0 item f) + seam-map §3 global
// invariant "INV-children-vs-namedChildren (comment→null, literal_args 버그 보존)" +
// memory [[build-graph-literal-args-comment-bug]].
//
// These pin CURRENT (intentionally-preserved) quirks so the codegraph-unification refactor
// (P1-P5) cannot SILENTLY change them. A refactor that "fixes" one of these must do so
// deliberately — flipping this test RED and forcing a conscious decision + golden re-baseline,
// not an accidental behavior drift hidden among many id changes.

import { describe, it, expect, beforeAll } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

let adapter: TypeScriptParserAdapter
beforeAll(async () => {
  adapter = await TypeScriptParserAdapter.create()
})

describe('P0 known-preserved bugs (must fail RED if a refactor changes them)', () => {
  it('literal_args: a comment between array-literal elements becomes a null element (preserved quirk)', () => {
    // web-tree-sitter `children` includes comment nodes; literal-arg extraction maps each child
    // positionally, so the `/* keep me */` comment slot serializes to null rather than being skipped.
    const src = `function f(){ g(['a', /* keep me */ 'b']); }\nfunction g(x: unknown){}`
    const result = adapter.parseFile(src, 'src/known_bug.ts', 'r1')
    const callEdge = result.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'g' && e.literal_args)
    expect(callEdge, 'expected a resolved calls edge to g with literal_args').toBeTruthy()
    const args = JSON.parse(callEdge!.literal_args as string)
    // args[0] is the array-literal argument. The preserved bug: the comment slot is present as
    // null (NOT skipped → a "fixed" extractor would yield ['a','b']).
    expect(args[0]).toEqual(['a', null, 'b'])
  })
})
