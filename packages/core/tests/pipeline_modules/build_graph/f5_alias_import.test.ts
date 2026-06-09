// P6: import as alias 패턴 검증
// import { X as alias } + alias.method() chain → calls resolve
import { describe, it, expect } from 'vitest'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

function mkNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return { repo_id: 'r1', line_start: 1, line_end: 5, signature: null, exported: true, parse_status: 'ok', is_test: false, test_type: null, is_async: false, jsdoc: null, ...o }
}
function mkEdge(o: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return { repo_id: 'r1', target_id: null, target_specifier: null, target_symbol: null, source: 'static', resolve_status: 'pending', ...o }
}

describe('P6: alias import — chain member resolve', () => {
  it('AL-01: import { userRepository as repo } + repo.findById → namespace member resolve', async () => {
    const REPO = 'src/repo.ts'
    const USECASE = 'src/usecase.ts'
    const nodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${REPO}`, type: 'file', name: 'file', file_path: REPO }),
      mkNode({ id: `r1:${REPO}:userRepository`, type: 'namespace', name: 'userRepository', file_path: REPO }),
      mkNode({ id: `r1:${REPO}:userRepository.findById`, type: 'variable', name: 'userRepository.findById', file_path: REPO }),
      mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
      mkNode({ id: `r1:${USECASE}:fn`, type: 'function', name: 'fn', file_path: USECASE }),
    ]
    const edges: CodeEdgeRaw[] = [
      // imports 인 alias — target_symbol='userRepository' (원본), target_local_symbol='repo' (alias)
      mkEdge({
        source_id: `r1:${USECASE}`,
        relation: 'imports',
        target_id: `r1:${REPO}:userRepository`,
        target_specifier: './repo',
        target_symbol: 'userRepository',
        target_local_symbol: 'repo',
        resolve_status: 'resolved',
      }),
      // 단순 호출 — alias chain root
      mkEdge({
        source_id: `r1:${USECASE}:fn`,
        relation: 'calls',
        target_specifier: './repo',
        target_symbol: 'findById',
        chain_path: 'repo',  // alias로 시작
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${REPO}:userRepository.findById`)
  })
})
