/**
 * a7 annotation — Dart annotation 다양 패턴
 * TS의 typescript_a7_gap_b 1:1 매핑
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('Dart a7 annotation', () => {
  it('AN-1 — class-level annotation `@injectable`', async () => {
    const r = await parse(`
      @injectable
      class Svc {}
    `)
    expect(r.edges.some((e) => e.relation === 'decorates' && e.target_symbol === 'injectable' && e.source_id.endsWith(':Svc'))).toBe(true)
  })

  it('AN-2 — method-level annotation `@override`', async () => {
    const r = await parse(`
      class C {
        @override
        void fn() {}
      }
    `)
    expect(r.edges.some((e) => e.relation === 'decorates' && e.target_symbol === 'override' && e.source_id.endsWith(':C.fn'))).toBe(true)
  })

  it('AN-3 — annotation with positional arg `@Path("/users")`', async () => {
    const r = await parse(`
      class C {
        @Path('/users')
        void list() {}
      }
    `)
    const dec = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'Path' && e.source_id.endsWith(':C.list'))
    expect(dec).toBeDefined()
    expect(dec!.first_arg).toBe('/users')
  })

  it('AN-4 — annotation with multiple args `@Route("/x", method: "GET")`', async () => {
    const r = await parse(`
      class C {
        @Route('/x', method: 'GET')
        void fn() {}
      }
    `)
    const dec = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'Route' && e.source_id.endsWith(':C.fn'))
    expect(dec).toBeDefined()
  })

  it('AN-5 — multiple annotations on same method (no dup)', async () => {
    const r = await parse(`
      class C {
        @override
        @Deprecated('use newOne')
        void old() {}
      }
    `)
    const decs = r.edges.filter((e) => e.relation === 'decorates' && e.source_id.endsWith(':C.old'))
    expect(decs.length).toBe(2)
    expect(decs.some((e) => e.target_symbol === 'override')).toBe(true)
    expect(decs.some((e) => e.target_symbol === 'Deprecated')).toBe(true)
  })

  it('AN-6 — field annotation `@JsonKey(name: "id")`', async () => {
    const r = await parse(`
      class Dto {
        @JsonKey(name: 'user_id')
        final int userId;
        Dto(this.userId);
      }
    `)
    const dec = r.edges.find((e) => e.relation === 'decorates' && e.target_symbol === 'JsonKey' && e.source_id.endsWith(':Dto.userId'))
    expect(dec).toBeDefined()
  })
})
