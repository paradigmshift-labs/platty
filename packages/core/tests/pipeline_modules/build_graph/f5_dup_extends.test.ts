/**
 * BS-17 — F5 buildEdgeIndices 중복 childId WARN
 *
 * 한 class가 여러 번 extends 매핑되는 경우 (그래프 정합성 위반) WARN.
 */
import { describe, it, expect, vi } from 'vitest'
import type { CodeNodeRaw, CodeEdgeRaw } from '@/pipeline_modules/build_graph/types.js'
import { buildEdgeIndices } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'

const REPO = 'r1'

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

describe('BS-17: buildEdgeIndices 중복 extends WARN', () => {
  it('단일 extends → WARN 없음', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:B', resolve_status: 'resolved' }),
    ]
    buildEdgeIndices(edges)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('중복 extends (다른 target) → WARN + 첫 매핑 유지', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:B', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:C', resolve_status: 'resolved' }),
    ]
    const result = buildEdgeIndices(edges)
    expect(warnSpy).toHaveBeenCalled()
    expect(result.extendsMap.get('r1:src/a.ts:A')).toBe('r1:src/a.ts:B')  // 첫 매핑
    warnSpy.mockRestore()
  })

  it('중복이지만 같은 target → WARN 없음 (idempotent)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const edges: CodeEdgeRaw[] = [
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:B', resolve_status: 'resolved' }),
      e({ source_id: 'r1:src/a.ts:A', relation: 'extends', target_id: 'r1:src/a.ts:B', resolve_status: 'resolved' }),
    ]
    buildEdgeIndices(edges)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
