// RED SPEC (describe.skip) — absorbed from pre-refactor build_graph resolution WIP.
// Un-skip + make GREEN when re-implementing resolution on the refactored engine.
// Reference impl: ~/main-wip-backup/source.patch ; design: specs/static_analysis_strategy/ideal_architecture_reverse_design.md
/**
 * F5 regression: cross-file class-field initializer receiver resolution.
 *
 * Pattern (generic, no fixture/repo names):
 *   // validator.ts
 *   export class Validator { validateBody(schema) { return () => {} } }
 *   // routes.ts
 *   import { Validator } from './validator'
 *   class Routes {
 *     validator = new Validator()        // class field initializer, no type annotation,
 *                                        // NOT a constructor DI param
 *     init() { this.validator.validateBody(schema) }
 *   }
 *
 * Expectation: the `calls` edge `Routes.init -> Validator.validateBody`
 * must resolve to the method node on the initialized class (target_id set),
 * NOT stay unresolved (target_id=null). This is the load-bearing fact for
 * build_docs reachability (codeEdges.targetId IS NOT NULL traversal).
 *
 * Receiver-type inference for field-initializer `new ClassName()` is provided by
 * the adapter's field-origin pass ({ kind:'internal', typeName }) + F5
 * tryFieldOriginDispatch, generalizing the same `new ClassName()` semantics used
 * for constructor-DI params and local `new Repo()` handling.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import type {
  CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap, FieldOriginsMap,
} from '@/pipeline_modules/build_graph/types'

interface FileSpec { filePath: string; source: string }

async function runE2E(files: FileSpec[]) {
  const adapter = new TypeScriptParserAdapter()
  const allNodes: CodeNodeRaw[] = []
  const allEdges: CodeEdgeRaw[] = []
  const diMap: ConstructorDIMap = new Map()
  const allOrigins: FieldOriginsMap = new Map()
  const constructorParams: { className: string; params: any[] }[] = []
  const classesByName = new Map<string, CodeNodeRaw>()

  for (const f of files) {
    const r = await adapter.parseFile(f.source, f.filePath, 'r1')
    allNodes.push(
      {
        id: `r1:${f.filePath}`, repo_id: 'r1', type: 'file', file_path: f.filePath, name: 'file',
        line_start: null, line_end: null, signature: null, exported: false, parse_status: 'ok',
        is_test: false, test_type: null, is_async: false, jsdoc: null,
      },
      ...r.nodes,
    )
    allEdges.push(...r.edges)
    constructorParams.push(...r.constructorParams)
    for (const n of r.nodes) if (n.type === 'class') classesByName.set(n.name, n)
    if (r.fieldOrigins) for (const [k, v] of r.fieldOrigins) allOrigins.set(k, v)
  }
  for (const cp of constructorParams) {
    const cls = classesByName.get(cp.className)
    if (cls) diMap.set(cls.id, cp.params)
  }
  const resolved = await resolveCalls(allEdges, allNodes, diMap, new Map(), allOrigins)
  return resolved
}

describe('F5: cross-file class-field initializer receiver resolution', () => {
  it('field = new Class() (no annotation, no DI param) → this.field.method() resolves to that class method', async () => {
    const edges = await runE2E([
      {
        filePath: 'src/validators/validator.ts',
        source: `
          export class Validator {
            constructor() {}
            validateBody(schema) {
              return async (req: any, res: any, next: any) => { next() }
            }
          }
        `,
      },
      {
        filePath: 'src/routes/routes.ts',
        source: `
          import { Validator } from '../validators/validator';
          class Routes {
            validator = new Validator();
            init() {
              this.validator.validateBody({});
            }
          }
        `,
      },
    ])

    const edge = edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'validateBody',
    )
    expect(edge).toBeTruthy()
    expect(edge!.resolve_status).toBe('resolved')
    expect(edge!.target_id).toBe('r1:src/validators/validator.ts:Validator.validateBody')
  })
})
