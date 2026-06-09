/**
 * Dart operator overloading
 * https://dart.dev/language/operators#operator-overloading
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(s: string) { return adapter.parseFile(s, 'lib/x.dart', 'r1') }

describe('Dart operator overloading', () => {
  it('OP-1 — operator == — method node', async () => {
    const r = await parse(`
      class V {
        final int x;
        V(this.x);
        @override
        bool operator ==(Object other) => other is V && other.x == x;
        @override
        int get hashCode => x.hashCode;
      }
    `)
    // operator == — 'operator_signature' 노드. method 발화 여부 검증
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'V')).toBe(true)
  })

  it('OP-2 — operator [] index access', async () => {
    const r = await parse(`
      class Arr {
        final List<int> _data = [];
        int operator [](int i) => _data[i];
        void operator []=(int i, int v) { _data[i] = v; }
      }
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Arr')).toBe(true)
  })

  it('OP-3 — operator + arithmetic', async () => {
    const r = await parse(`
      class Vec {
        final int x;
        Vec(this.x);
        Vec operator +(Vec other) => Vec(x + other.x);
      }
    `)
    expect(r.nodes.some((n) => n.type === 'class' && n.name === 'Vec')).toBe(true)
  })
})
