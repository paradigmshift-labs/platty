/**
 * D-4: Dart `late` modifier 처리
 *
 * `late String name;` `late final Cache cache = ...` —
 * declaration의 'late' keyword가 anonymous로 들어가 type_identifier + initialized_identifier_list는 정상 위치.
 * processClassField가 처리하는지 검증.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('D-4: late modifier field', () => {
  it('LM-1 — `late String name` — property node 발화 + type_ref(String=primitive skip)', async () => {
    const r = await parse(`
      class Repo {
        late String name;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'property' && n.name === 'Repo.name')).toBe(true)
  })

  it('LM-2 — `late final Cache cache` — type_ref Cache 발화', async () => {
    const r = await parse(`
      class Cache {}
      class Repo {
        late final Cache cache;
      }
    `)
    const tr = r.edges.find(
      (e) => e.relation === 'type_ref' && e.target_symbol === 'Cache' && e.source_id.endsWith(':Repo.cache'),
    )
    expect(tr).toBeDefined()
  })

  it('LM-3 — `late final Cache cache = Cache()` — fieldOrigins internal(Cache)', async () => {
    const r = await parse(`
      class Cache {}
      class Repo {
        late final Cache cache = Cache();
      }
    `)
    const fo = r.fieldOrigins as Map<string, Map<string, any>> | undefined
    let origin: any
    for (const [k, m] of fo ?? []) if (k.endsWith(':Repo')) origin = m.get('cache')
    expect(origin).toEqual({ kind: 'internal', typeName: 'Cache' })
  })
})
