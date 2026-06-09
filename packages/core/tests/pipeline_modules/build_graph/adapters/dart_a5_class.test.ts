/**
 * a5 class — Dart class processing 다양 시나리오
 * TS의 typescript_a5_gap_b 1:1 매핑
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

describe('Dart a5 class processing', () => {
  it('CL-1 — abstract class — class node + 자식 extends 정상', async () => {
    const r = await parse(`
      abstract class Animal { void sound(); }
      class Dog extends Animal { void sound() { print('woof'); } }
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Animal')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Dog')).toBe(true)
    expect(r.edges.some((e) => e.relation === 'extends' && e.target_symbol === 'Animal' && e.source_id.endsWith(':Dog'))).toBe(true)
  })

  it('CL-2 — implements 다중 (`implements I1, I2`)', async () => {
    const r = await parse(`
      abstract class I1 {}
      abstract class I2 {}
      class C implements I1, I2 {}
    `)
    expect(r.edges.some((e) => e.relation === 'implements' && e.target_symbol === 'I1' && e.source_id.endsWith(':C'))).toBe(true)
    expect(r.edges.some((e) => e.relation === 'implements' && e.target_symbol === 'I2' && e.source_id.endsWith(':C'))).toBe(true)
  })

  it('CL-3 — static method — method 노드 발화', async () => {
    const r = await parse(`
      class Math {
        static int square(int x) => x * x;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'square')).toBe(true)
  })

  it('CL-4 — getter / setter — get:/set: prefix method', async () => {
    const r = await parse(`
      class C {
        int _x = 0;
        int get value => _x;
        set value(int v) { _x = v; }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'get:value')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'set:value')).toBe(true)
  })

  it('CL-5 — multiple constructors (default + named)', async () => {
    const r = await parse(`
      class C {
        C();
        C.named();
        C.fromInt(int x);
      }
    `)
    // default + 2 named
    const ctors = r.nodes.filter((n) => n.type === 'method' && n.name.startsWith('C') && n.id.includes(':C.'))
    expect(ctors.length).toBeGreaterThanOrEqual(3)
  })

  it('CL-6 — nested class (Dart는 inner class 없음 — class만 top-level)', async () => {
    // Dart는 class 안에 다른 class 선언 불가. private class는 _ prefix.
    const r = await parse(`
      class Outer {
        void fn() {}
      }
      class _Inner {}
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Outer')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === '_Inner')).toBe(true)
  })

  it('CL-7 — class field with annotation — decorates edge', async () => {
    const r = await parse(`
      class C {
        @override
        String name = 'foo';
      }
    `)
    expect(r.edges.some((e) => e.relation === 'decorates' && e.target_symbol === 'override' && e.source_id.endsWith(':C.name'))).toBe(true)
  })

  it('CL-7b — comma-separated class fields emit all properties', async () => {
    const r = await parse(`
      class Rating {
        final int currentRating, maxRating;
      }
    `)
    expect(r.nodes.some((n) => n.type === 'property' && n.name === 'Rating.currentRating')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'property' && n.name === 'Rating.maxRating')).toBe(true)
  })

  it('CL-7c — operator overload emits method node', async () => {
    const r = await parse(`
      class C {
        bool operator ==(Object other) => identical(this, other);
      }
    `)
    expect(r.nodes.some((n) => n.type === 'method' && n.name === 'operator')).toBe(true)
  })

  it('CL-8 — class with empty body', async () => {
    const r = await parse(`class Empty {}`)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Empty')).toBe(true)
  })

  it('CL-9 — multiline class header keeps State class and build method', async () => {
    const r = await parse(`
      class PurchaseSelectStepWidget extends ConsumerStatefulWidget {
        @override
        ConsumerState<PurchaseSelectStepWidget> createState() =>
            _PurchaseSelectStepWidgetState();
      }

      class _PurchaseSelectStepWidgetState
          extends ConsumerState<PurchaseSelectStepWidget> {
        String? _selectedId;

        @override
        Widget build(BuildContext context) {
          final title = switch ((true, false)) {
            (true, true) => 'both',
            _ => 'fallback',
          };
          return _buildBody();
        }

        Widget _buildBody() {
          return Text(_selectedId ?? '');
        }
      }
    `)

    expect(r.nodes.some((n) => n.type === 'class' && n.name === '_PurchaseSelectStepWidgetState')).toBe(true)
    expect(r.nodes.some((n) => n.type === 'method' && n.id.endsWith(':_PurchaseSelectStepWidgetState.build'))).toBe(true)
    expect(r.nodes.some((n) => n.type === 'method' && n.id.endsWith(':_PurchaseSelectStepWidgetState._buildBody'))).toBe(true)
    expect(r.edges.some((e) =>
      e.relation === 'extends' &&
      e.source_id.endsWith(':_PurchaseSelectStepWidgetState') &&
      e.target_symbol === 'ConsumerState',
    )).toBe(true)
  })
})
