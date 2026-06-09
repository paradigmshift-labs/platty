// F5: namespace member chain resolve
// SOT: spec scenarios-heroines.md HB-02-A6/A7 (BS-신규 후보 — namespace member chain)
//
// 패턴: usecase가 import-bound namespace의 member fn 호출
//   import { userRepository } from '...'
//   userRepository.other.findUserById(...)        ← chain_path='userRepository.other', target_symbol='findUserById'
//   userRepository.json.transform(...)            ← chain_path='userRepository.json', target_symbol='transform'
//   userService.convertOtherUserBirthyearBlind(...) ← chain_path='userService', target_symbol='...'
//
// 어댑터: namespace fn을 full-path 이름(`userRepository.other.findUserById`)으로 발화
// F5: chain_path + target_symbol = full name → 같은 파일 안 노드 lookup
import { describe, it, expect } from 'vitest'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls.js'
import type { CodeNodeRaw, CodeEdgeRaw, ConstructorDIMap } from '@/pipeline_modules/build_graph/types.js'

function mkNode(o: Partial<CodeNodeRaw> & { id: string; type: CodeNodeRaw['type']; name: string; file_path: string }): CodeNodeRaw {
  return {
    repo_id: 'r1',
    line_start: 1,
    line_end: 5,
    signature: null,
    exported: true,
    parse_status: 'ok',
    is_test: false,
    test_type: null,
    is_async: false,
    jsdoc: null,
    ...o,
  }
}

function mkEdge(o: Partial<CodeEdgeRaw> & { source_id: string; relation: CodeEdgeRaw['relation'] }): CodeEdgeRaw {
  return {
    repo_id: 'r1',
    target_id: null,
    target_specifier: null,
    target_symbol: null,
    source: 'static',
    resolve_status: 'pending',
    ...o,
  }
}

describe('F5: namespace member chain resolve (BS-신규 — userRepository.other.findUserById)', () => {
  const REPO = 'src/apiv1.1/repositories/user/user.repository.ts'
  const USECASE = 'src/apiv1.1/usecases/user/user.usecase.ts'

  const nodes: CodeNodeRaw[] = [
    // repository 파일 — userRepository namespace + nested
    mkNode({ id: `r1:${REPO}`, type: 'file', name: 'file', file_path: REPO }),
    mkNode({ id: `r1:${REPO}:userRepository`, type: 'namespace', name: 'userRepository', file_path: REPO }),
    mkNode({ id: `r1:${REPO}:userRepository.other`, type: 'namespace', name: 'userRepository.other', file_path: REPO }),
    mkNode({ id: `r1:${REPO}:userRepository.other.findUserById`, type: 'variable', name: 'userRepository.other.findUserById', file_path: REPO }),
    mkNode({ id: `r1:${REPO}:userRepository.json`, type: 'namespace', name: 'userRepository.json', file_path: REPO }),
    mkNode({ id: `r1:${REPO}:userRepository.json.transform`, type: 'variable', name: 'userRepository.json.transform', file_path: REPO }),
    // usecase 파일
    mkNode({ id: `r1:${USECASE}`, type: 'file', name: 'file', file_path: USECASE }),
    mkNode({
      id: `r1:${USECASE}:UserUsecase`,
      type: 'class',
      name: 'UserUsecase',
      file_path: USECASE,
    }),
    mkNode({
      id: `r1:${USECASE}:UserUsecase.getOtehrUserProfile`,
      type: 'method',
      name: 'UserUsecase.getOtehrUserProfile',
      file_path: USECASE,
    }),
  ]

  it('NM-01: chain_path="userRepository.other" + sym="findUserById" → namespace fn 노드 resolved', async () => {
    const edges: CodeEdgeRaw[] = [
      // F3a 통과 — userRepository import resolved
      mkEdge({
        source_id: `r1:${USECASE}`,
        relation: 'imports',
        target_id: `r1:${REPO}:userRepository`,
        target_specifier: `src/apiv1.1/repositories/user/user.repository`,
        target_symbol: 'userRepository',
        resolve_status: 'resolved',
      }),
      // 어댑터가 발화한 calls (pending)
      mkEdge({
        source_id: `r1:${USECASE}:UserUsecase.getOtehrUserProfile`,
        relation: 'calls',
        target_specifier: `src/apiv1.1/repositories/user/user.repository`,
        target_symbol: 'findUserById',
        chain_path: 'userRepository.other',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${REPO}:userRepository.other.findUserById`)
  })

  it('NM-02: chain_path="userRepository.json" + sym="transform" → nested namespace fn resolved', async () => {
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}`,
        relation: 'imports',
        target_id: `r1:${REPO}:userRepository`,
        target_specifier: `src/apiv1.1/repositories/user/user.repository`,
        target_symbol: 'userRepository',
        resolve_status: 'resolved',
      }),
      mkEdge({
        source_id: `r1:${USECASE}:UserUsecase.getOtehrUserProfile`,
        relation: 'calls',
        target_specifier: `src/apiv1.1/repositories/user/user.repository`,
        target_symbol: 'transform',
        chain_path: 'userRepository.json',
      }),
    ]
    const result = await resolveCalls(edges, nodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${REPO}:userRepository.json.transform`)
  })

  it('NM-03: chain_path="userService" (single-level) + sym="fn" → namespace fn resolved', async () => {
    const SVC = 'src/services/user.service.ts'
    const localNodes: CodeNodeRaw[] = [
      mkNode({ id: `r1:${SVC}`, type: 'file', name: 'file', file_path: SVC }),
      mkNode({ id: `r1:${SVC}:userService`, type: 'namespace', name: 'userService', file_path: SVC }),
      mkNode({
        id: `r1:${SVC}:userService.convertOtherUserBirthyearBlind`,
        type: 'variable',
        name: 'userService.convertOtherUserBirthyearBlind',
        file_path: SVC,
      }),
      ...nodes,
    ]
    const edges: CodeEdgeRaw[] = [
      mkEdge({
        source_id: `r1:${USECASE}`,
        relation: 'imports',
        target_id: `r1:${SVC}:userService`,
        target_specifier: `src/services/user.service`,
        target_symbol: 'userService',
        resolve_status: 'resolved',
      }),
      mkEdge({
        source_id: `r1:${USECASE}:UserUsecase.getOtehrUserProfile`,
        relation: 'calls',
        target_specifier: `src/services/user.service`,
        target_symbol: 'convertOtherUserBirthyearBlind',
        chain_path: 'userService',
      }),
    ]
    const result = await resolveCalls(edges, localNodes, new Map() as ConstructorDIMap, new Map())
    const callEdge = result.find((e) => e.relation === 'calls')
    expect(callEdge!.resolve_status).toBe('resolved')
    expect(callEdge!.target_id).toBe(`r1:${SVC}:userService.convertOtherUserBirthyearBlind`)
  })
})
