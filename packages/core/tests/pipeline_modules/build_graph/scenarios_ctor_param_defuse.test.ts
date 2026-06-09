/**
 * Scenario integration test — NestJS constructor-injection def-use (v2-1).
 * SOT: docs/build_graph/def-use-symbol-edge.md §v2.
 *
 * The DSL graph-query needs: receiver `this.userModel` → its declaration → @InjectModel('user') → model.
 * For NestJS the field is a CONSTRUCTOR PARAMETER PROPERTY (`constructor(@InjectModel('user') private
 * userModel: Model<User>)`), which build_graph v1 did NOT emit as a node (param decorator + type were
 * dropped). v2-1 emits it as a property node so v1's resolves_to (Pass C) + the decorates/type_ref
 * traversal light up. This test is the end-to-end answer key.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'

const NEST_SRC = `
import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'

@Injectable()
export class UsersService {
  constructor(@InjectModel('user') private readonly userModel: Model<any>) {}
  findUser(id: string) { return this.userModel.findOne({ id }) }
}
`
const FILE = 'src/users.service.ts'
const FIELD_ID = 'r1:src/users.service.ts:UsersService.userModel'
const METHOD_ID = 'r1:src/users.service.ts:UsersService.findUser'

describe('v2-1: NestJS constructor-injection def-use (scenario integration)', () => {
  it('emits the ctor-parameter-property as a graph node + decorates/type_ref + def-use, traversable to the model', async () => {
    const adapter = new TypeScriptParserAdapter()
    const parsed = await adapter.parseFile(NEST_SRC, FILE, 'r1')
    const finalEdges = await resolveCalls(parsed.edges, parsed.nodes, new Map(), new Map(), parsed.fieldOrigins)

    // (1) the constructor-parameter-property is now a real property node (marked as ctor injection)
    const fieldNode = parsed.nodes.find((n) => n.type === 'property' && n.name === 'UsersService.userModel')
    expect(fieldNode, 'ctor-param-property node exists').toBeTruthy()
    expect(fieldNode!.id).toBe(FIELD_ID)
    expect(fieldNode!.role, 'marked as a constructor-injected field').toBe('ctor_param_property')

    // (2) class → field contains edge
    expect(parsed.edges.some((e) => e.relation === 'contains' && e.target_symbol === 'userModel'),
      'class→field contains').toBe(true)

    // (3) the @InjectModel('user') decorator now lands ON the field node (was dropped before)
    const dec = parsed.edges.find((e) => e.relation === 'decorates' && e.source_id === FIELD_ID && e.target_symbol === 'InjectModel')
    expect(dec, 'decorates @InjectModel on the field').toBeTruthy()
    expect(dec!.first_arg, 'the injected model name is captured').toBe('user')

    // (4) the field type (Model) type_ref lands on the field node
    expect(parsed.edges.some((e) => e.relation === 'type_ref' && e.source_id === FIELD_ID && e.target_symbol === 'Model'),
      'type_ref Model on the field').toBe(true)

    // (5) def-use: the method references the field declaration (v1 Pass C, now unblocked)
    const du = finalEdges.find((e) => e.relation === 'resolves_to' && e.source_id === METHOD_ID && e.target_id === FIELD_ID)
    expect(du, 'resolves_to findUser → userModel').toBeTruthy()

    // (6) the full DSL traversal: method --resolves_to--> field --decorates--> @InjectModel('user')
    const fieldDecorator = parsed.edges.find((e) => e.relation === 'decorates' && e.source_id === du!.target_id && e.target_symbol === 'InjectModel')
    expect(fieldDecorator?.first_arg, 'traversal reaches the model name from the call site').toBe('user')
  })

  it('does NOT create a param-property for a plain (non-property) constructor parameter', async () => {
    const adapter = new TypeScriptParserAdapter()
    const src = `export class C { constructor(plain: string) {} m() { return 1 } }`
    const parsed = await adapter.parseFile(src, 'src/c.ts', 'r1')
    // `plain` has no accessibility modifier → not a field → no property node
    expect(parsed.nodes.some((n) => n.type === 'property' && n.name === 'C.plain')).toBe(false)
  })
})
