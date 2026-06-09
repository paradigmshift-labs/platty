/**
 * D6: Dart this.X.Y.Z 깊은 chain 처리 보강
 *
 * Dart selector chain: `this . svc . method (1)`
 *   AST: this + selector(.svc) + selector(.method) + selector(args)
 *
 * 현재 scanCallsEdges는 root이 identifier일 때만 처리. root='this'인 경우 누락.
 * → F5 resolveDICall이 사용할 chain_path/target_specifier를 정확히 발화 필요.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { DartParserAdapter } from '@/pipeline_modules/build_graph/adapters/dart'
import type { CodeEdgeRaw } from '@/pipeline_modules/build_graph/types'

let adapter: DartParserAdapter
beforeAll(async () => { adapter = await DartParserAdapter.create() })

async function parse(source: string, filePath = 'lib/x.dart') {
  return adapter.parseFile(source, filePath, 'r1')
}

function findCall(edges: CodeEdgeRaw[], symbol: string, sourceEnds: string) {
  return edges.find(
    (e) => e.relation === 'calls' && e.target_symbol === symbol && e.source_id.endsWith(sourceEnds),
  )
}

describe('D6: this.X.Y deep chain → calls edge with chain_path', () => {
  it('CD-1 — this.svc.method() (depth 2) → calls edge + chain_path="this.svc"', async () => {
    const r = await parse(`
      class Owner {
        void fn() {
          this.svc.method(1);
        }
      }
    `)
    const e = findCall(r.edges, 'method', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('this.svc.method')
    expect(e!.chain_path).toBe('this.svc')
  })

  it('CD-2 — this.svc.user.deleteMany() (depth 3+) → chain_path="this.svc.user"', async () => {
    const r = await parse(`
      class Owner {
        void fn() {
          this.svc.user.deleteMany();
        }
      }
    `)
    const e = findCall(r.edges, 'deleteMany', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('this.svc.user.deleteMany')
    expect(e!.chain_path).toBe('this.svc.user')
  })

  it('CD-3 — this.method() (depth 1, self call) → chain_path="this"', async () => {
    const r = await parse(`
      class Owner {
        void fn() {
          this.helper(1);
        }
      }
    `)
    const e = findCall(r.edges, 'helper', ':Owner.fn')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('this.helper')
    expect(e!.chain_path).toBe('this')
  })
})
