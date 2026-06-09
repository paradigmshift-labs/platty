/**
 * advanced_dto — Dart DTO 패턴 (freezed, JsonSerializable)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string) {
  return adapter.parseFile(source, 'lib/x.dart', 'r1')
}

describe('Dart advanced_dto', () => {
  it('DT-1 — @freezed class — annotation + class node', async () => {
    const r = await parse(`
      @freezed
      class User {
        final String name;
        final int age;
        User(this.name, this.age);
      }
    `)
    expect(r.edges.some((e) => e.relation === 'decorates' && e.target_symbol === 'freezed' && e.source_id.endsWith(':User'))).toBe(true)
  })

  it('DT-2 — @JsonSerializable + fromJson factory', async () => {
    const r = await parse(`
      @JsonSerializable()
      class User {
        final String name;
        User(this.name);
        factory User.fromJson(Map<String, dynamic> j) => User(j['name']);
      }
    `)
    expect(r.edges.some((e) => e.relation === 'decorates' && e.target_symbol === 'JsonSerializable' && e.source_id.endsWith(':User'))).toBe(true)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'fromJson')).toBe(true)
  })

  it('DT-3 — @JsonKey field annotation', async () => {
    const r = await parse(`
      class User {
        @JsonKey(name: 'user_id')
        final int id;
        User(this.id);
      }
    `)
    expect(r.edges.some((e) => e.relation === 'decorates' && e.target_symbol === 'JsonKey' && e.source_id.endsWith(':User.id'))).toBe(true)
  })

  it('DT-4 — toJson method body 추적', async () => {
    const r = await parse(`
      class User {
        final String name;
        User(this.name);
        Map<String, dynamic> toJson() => {'name': this.name};
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'toJson')).toBe(true)
  })

  it('DT-5 — copyWith 패턴 (freezed)', async () => {
    const r = await parse(`
      class User {
        final String name;
        User(this.name);
        User copyWith({String? name}) => User(name ?? this.name);
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'copyWith')).toBe(true)
  })
})
