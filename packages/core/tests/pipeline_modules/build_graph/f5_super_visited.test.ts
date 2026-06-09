/**
 * BS-15 — F5 resolveSuperCall 다단계 + visited Set + depth ≤ 20
 *
 * 시나리오:
 *   BS-15-01: 1단계 부모 (A extends B, B에 method) → resolved
 *   BS-15-02: 2단계 (A extends B extends Base, Base에 method) → resolved
 *   BS-15-03: 부모/조부모 모두 메서드 없음 → failed
 *   BS-15-04: 순환 상속 (A extends B, B extends A) → visited Set으로 방지 → failed
 *   BS-15-05: depth > 20 → 방어 fail
 *   BS-15-06: 부모 클래스가 cross-file → 정상 작동
 */
import { describe, it, expect } from 'vitest'
import type { CodeNodeRaw, CodeEdgeRaw } from '@/pipeline_modules/build_graph/types.js'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'

const REPO = 'r1'

function n(id: string, type: CodeNodeRaw['type'], name: string, file = 'src/a.ts'): CodeNodeRaw {
  return {
    id, repo_id: REPO, type, file_path: file, name,
    line_start: 1, line_end: 10, signature: null, exported: true,
    parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null,
  }
}

function e(opts: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return {
    repo_id: REPO,
    source_id: opts.source_id,
    target_id: opts.target_id ?? null,
    relation: opts.relation,
    target_specifier: opts.target_specifier ?? null,
    target_symbol: opts.target_symbol ?? null,
    resolve_status: opts.resolve_status ?? 'pending',
    first_arg: null,
    literal_args: null,
  }
}

describe('BS-15: resolveSuperCall 다단계 + visited Set', () => {
  it('BS-15-01: 1단계 부모에 method → resolved', async () => {
    const nodes: CodeNodeRaw[] = [
      n('r1:src/a.ts:A', 'class', 'A'),
      n('r1:src/a.ts:B', 'class', 'B'),
      n('r1:src/a.ts:A.run', 'method', 'A.run'),
      n('r1:src/a.ts:B.run', 'method', 'B.run'),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:B', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A', relation: 'contains', target_id: 'r1:src/a.ts:A.run', resolve_status: 'resolved', target_symbol: 'run' }),
      e({ source_id: 'r1:src/a.ts:B', relation: 'contains', target_id: 'r1:src/a.ts:B.run', resolve_status: 'resolved', target_symbol: 'run' }),
      // A.run 안에서 super.run() 호출
      e({ source_id: 'r1:src/a.ts:A.run', relation: 'calls', target_specifier: 'super.run', target_symbol: 'run', resolve_status: 'pending' }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const callEdge = result.find((r) => r.relation === 'calls' && r.target_specifier === 'super.run')
    expect(callEdge?.resolve_status).toBe('resolved')
    expect(callEdge?.target_id).toBe('r1:src/a.ts:B.run')
  })

  it('BS-15-02: 2단계 상속 (A → B → Base, Base에 method) → resolved', async () => {
    const nodes: CodeNodeRaw[] = [
      n('r1:src/a.ts:A', 'class', 'A'),
      n('r1:src/a.ts:B', 'class', 'B'),
      n('r1:src/a.ts:Base', 'class', 'Base'),
      n('r1:src/a.ts:A.run', 'method', 'A.run'),
      n('r1:src/a.ts:Base.run', 'method', 'Base.run'),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:B', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:B', relation: 'extends', target_id: 'r1:src/a.ts:Base', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A', relation: 'contains', target_id: 'r1:src/a.ts:A.run', resolve_status: 'resolved', target_symbol: 'run' }),
      e({ source_id: 'r1:src/a.ts:Base', relation: 'contains', target_id: 'r1:src/a.ts:Base.run', resolve_status: 'resolved', target_symbol: 'run' }),
      e({ source_id: 'r1:src/a.ts:A.run', relation: 'calls', target_specifier: 'super.run', target_symbol: 'run', resolve_status: 'pending' }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const callEdge = result.find((r) => r.relation === 'calls' && r.target_specifier === 'super.run')
    expect(callEdge?.resolve_status).toBe('resolved')
    expect(callEdge?.target_id).toBe('r1:src/a.ts:Base.run')
  })

  it('BS-15-03: 부모/조부모 모두 method 없음 → failed', async () => {
    const nodes: CodeNodeRaw[] = [
      n('r1:src/a.ts:A', 'class', 'A'),
      n('r1:src/a.ts:B', 'class', 'B'),
      n('r1:src/a.ts:A.run', 'method', 'A.run'),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:B', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A', relation: 'contains', target_id: 'r1:src/a.ts:A.run', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A.run', relation: 'calls', target_specifier: 'super.run', target_symbol: 'run', resolve_status: 'pending' }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const callEdge = result.find((r) => r.relation === 'calls' && r.target_specifier === 'super.run')
    expect(callEdge?.resolve_status).toBe('failed')
  })

  it('BS-15-04: 순환 상속 (A extends B, B extends A) → visited Set으로 방지 → failed', async () => {
    const nodes: CodeNodeRaw[] = [
      n('r1:src/a.ts:A', 'class', 'A'),
      n('r1:src/a.ts:B', 'class', 'B'),
      n('r1:src/a.ts:A.run', 'method', 'A.run'),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:B', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:B', relation: 'extends', target_id: 'r1:src/a.ts:A', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A', relation: 'contains', target_id: 'r1:src/a.ts:A.run', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A.run', relation: 'calls', target_specifier: 'super.run', target_symbol: 'run', resolve_status: 'pending' }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const callEdge = result.find((r) => r.relation === 'calls' && r.target_specifier === 'super.run')
    // 순환 — visited로 무한 루프 방지하고 fail
    expect(callEdge?.resolve_status).toBe('failed')
  })

  it('BS-15-06: 부모 클래스가 cross-file → 정상 작동', async () => {
    const nodes: CodeNodeRaw[] = [
      n('r1:src/a.ts:A', 'class', 'A', 'src/a.ts'),
      n('r1:src/base.ts:Base', 'class', 'Base', 'src/base.ts'),
      n('r1:src/a.ts:A.run', 'method', 'A.run', 'src/a.ts'),
      n('r1:src/base.ts:Base.run', 'method', 'Base.run', 'src/base.ts'),
    ]
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/base.ts:Base', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A', relation: 'contains', target_id: 'r1:src/a.ts:A.run', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/base.ts:Base', relation: 'contains', target_id: 'r1:src/base.ts:Base.run', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A.run', relation: 'calls', target_specifier: 'super.run', target_symbol: 'run', resolve_status: 'pending' }),
    ]
    const result = await resolveCalls(edges, nodes, new Map(), new Map())
    const callEdge = result.find((r) => r.relation === 'calls' && r.target_specifier === 'super.run')
    expect(callEdge?.resolve_status).toBe('resolved')
    expect(callEdge?.target_id).toBe('r1:src/base.ts:Base.run')
  })
})
