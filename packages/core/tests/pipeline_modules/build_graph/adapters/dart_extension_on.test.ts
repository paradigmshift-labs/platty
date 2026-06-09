/**
 * D5: Dart extension declaration의 'on Type' → type_ref edge
 *
 * 패턴: extension StringExt on String { ... } → StringExt extension 노드가 String을 type_ref
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function typeRef(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.filter(
    (e) => e.relation === 'type_ref' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('D5: extension on Type → type_ref', () => {
  it('E1 — extension StringExt on String → StringExt → String type_ref (단, String은 primitive 제외)', async () => {
    const r = await parse(`
      extension StringExt on String {
        String greet() => 'hi';
      }
    `)
    // String은 Dart primitive로 분류 — type_ref 발화 안 함이 합리적 (noise 방지)
    // 우리 구현은 String을 DART_PRIMITIVE_TYPES에 포함시켰으므로 type_ref 안 발화
    expect(typeRef(r.edges, 'String', ':StringExt').length).toBe(0)
  })

  it('E2 — extension UserExt on User (User=우리 class) → UserExt → User type_ref', async () => {
    const r = await parse(`
      class User {}
      extension UserExt on User {
        String label() => 'user';
      }
    `)
    expect(typeRef(r.edges, 'User', ':UserExt').length).toBeGreaterThan(0)
  })

  it('E3 — extension UserExt on User (User=import) → User type_ref + specifier', async () => {
    const r = await parse(`
      import 'src/user.dart' show User;
      extension UserExt on User {
        String label() => 'user';
      }
    `)
    const refs = typeRef(r.edges, 'User', ':UserExt')
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0].target_specifier).toBe('src/user.dart')
  })

  it('E4 — extension MapExt<K, V> on Map<K, V> → Map type_ref (generic root만)', async () => {
    const r = await parse(`
      extension MapExt<K, V> on Map<K, V> {
        bool isEmpty2() => isEmpty;
      }
    `)
    // Map은 builtin이라 발화. K, V는 type parameter라 발화 안 함이 이상적
    expect(typeRef(r.edges, 'Map', ':MapExt').length).toBeGreaterThan(0)
  })
})
