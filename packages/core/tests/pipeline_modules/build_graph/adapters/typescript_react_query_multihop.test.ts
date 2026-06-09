/**
 * React Query multi-hop 체인 검증
 *
 * 목적: build_graph가 아래 체인에서 어떤 edges를 생성하는지 문서화.
 *   Page → useQuery(queryFn) → repository.method() → apiClient.get('/path')
 *
 * 이 테스트는 build_relations SemanticIndex가 graph에서 얼마나 추적 가능한지 판단 근거.
 * 각 케이스마다 "현재 동작"을 assert — 구현 변경 시 이 테스트가 먼저 깨져야 한다.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/p.tsx') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('React Query multi-hop chain', () => {
  it('RQ-01: useQuery + inline arrow queryFn → calls edges 둘 다 발화되는가', () => {
    // Page가 useQuery를 호출하면서 queryFn 안에서 repository 호출
    // build_graph가 inner arrow function body의 calls도 발화하는지 확인
    const r = parse(`
      import { useQuery } from '@tanstack/react-query'
      import { userRepository } from './user.repository'

      export function UserListPage() {
        const { data } = useQuery({
          queryKey: ['users'],
          queryFn: () => userRepository.getUsers()
        })
        return null
      }
    `)

    const useQueryEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'useQuery',
    )
    const getUsersEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'getUsers',
    )

    // useQuery 호출 엣지는 반드시 있어야 함
    expect(useQueryEdge).toBeDefined()
    expect(useQueryEdge!.target_specifier).toBe('@tanstack/react-query')

    // getUsers 호출 엣지 — arrow function body 안에 있어 발화되는지 확인
    // 현재 동작 문서화: 발화되면 source_id 확인, 안 되면 undefined
    if (getUsersEdge) {
      // arrow function이 같은 노드(UserListPage) scope → source_id가 UserListPage
      expect(getUsersEdge.source_id).toContain('UserListPage')
      expect(getUsersEdge.chain_path).toContain('userRepository')
    } else {
      // arrow function body의 inner calls가 발화 안 됨 → build_relations가 직접 추적 불가
      console.warn('[RQ-01] getUsers call NOT captured — inner arrow fn body not traversed')
    }
  })

  it('RQ-02: custom hook wrapping useQuery → hook 내부 repository call 추적', () => {
    const r = parse(`
      import { useQuery } from '@tanstack/react-query'
      import { userRepository } from './user.repository'

      export function useUsers() {
        return useQuery({
          queryKey: ['users'],
          queryFn: () => userRepository.getUsers()
        })
      }
    `)

    const useQueryEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'useQuery',
    )
    const getUsersEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'getUsers',
    )

    expect(useQueryEdge).toBeDefined()
    expect(useQueryEdge!.source_id).toContain('useUsers')

    if (getUsersEdge) {
      expect(getUsersEdge.source_id).toContain('useUsers')
      expect(getUsersEdge.chain_path).toContain('userRepository')
    } else {
      console.warn('[RQ-02] getUsers call NOT captured in custom hook body')
    }
  })

  it('RQ-03: queryFn이 함수 참조(식별자)일 때 → synthetic calls edge로 bundle reachability 보존', () => {
    // queryFn: fetchUsers — arrow fn 아니라 함수 참조 직접 전달
    const r = parse(`
      import { useQuery } from '@tanstack/react-query'
      import { fetchUsers } from './api'

      export function Page() {
        return useQuery({ queryKey: ['users'], queryFn: fetchUsers })
      }
    `)

    const useQueryEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'useQuery',
    )
    expect(useQueryEdge).toBeDefined()

    // argExpressions로 queryFn: identifier 캡처 확인
    const argExprs = useQueryEdge!.arg_expressions
    const objArg = argExprs?.find((a) => a.kind === 'object')
    expect(objArg?.properties).toMatchObject({
      queryKey: {
        kind: 'array',
        elements: [{ index: 0, kind: 'string', value: 'users' }],
        resolution: 'static',
      },
      queryFn: {
        kind: 'identifier',
        raw: 'fetchUsers',
        resolution: 'dynamic',
      },
    })

    const fetchUsersCallEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'fetchUsers',
    )
    expect(fetchUsersCallEdge).toMatchObject({
      source_id: 'r1:src/p.tsx:Page',
      target_specifier: './api',
      target_symbol: 'fetchUsers',
      resolve_status: 'pending',
    })
  })

  it('RQ-03b: queryFn이 멤버 참조일 때 → repository method calls edge로 bundle reachability 보존', () => {
    const r = parse(`
      import { useQuery } from '@tanstack/react-query'
      import { userRepository } from './user.repository'

      export function Page() {
        return useQuery({ queryKey: ['users'], queryFn: userRepository.fetchUsers })
      }
    `)

    const fetchUsersCallEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'fetchUsers',
    )
    expect(fetchUsersCallEdge).toMatchObject({
      source_id: 'r1:src/p.tsx:Page',
      target_specifier: './user.repository',
      target_symbol: 'fetchUsers',
      chain_path: 'userRepository',
      resolve_status: 'pending',
    })
  })

  it('RQ-07c: useSWR fetcher 멤버 참조도 synthetic calls edge로 보존', () => {
    const r = parse(`
      import useSWR from 'swr'
      import { userRepository } from './user.repository'

      export function useUsers() {
        return useSWR('/api/users', userRepository.fetchUsers)
      }
    `)

    const fetchUsersCallEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'fetchUsers',
    )
    expect(fetchUsersCallEdge).toMatchObject({
      source_id: 'r1:src/p.tsx:useUsers',
      target_specifier: './user.repository',
      target_symbol: 'fetchUsers',
      chain_path: 'userRepository',
      resolve_status: 'pending',
    })
  })

  it('RQ-04a: object literal repository — object method body calls are emitted', () => {
    const r = parse(
      `
      import { apiClient } from './api.client'

      export const userRepository = {
        async getUsers() {
          return apiClient.get('/api/users')
        },
        async createUser(data: any) {
          return apiClient.post('/api/users', data)
        }
      }
    `,
      'src/user.repository.ts',
    )

    // object literal repository itself stays a variable node, while calls inside methods are still emitted.
    expect(r.nodes.map((n) => n.type)).toEqual(['variable'])
    expect(r.nodes[0].name).toBe('userRepository')

    const callEdges = r.edges.filter((e) => e.relation === 'calls')
    expect(callEdges).toHaveLength(2)
    expect(callEdges.map((e) => ({
      targetSymbol: e.target_symbol,
      chainPath: e.chain_path,
      firstArg: e.first_arg,
    }))).toEqual([
      { targetSymbol: 'get', chainPath: 'apiClient', firstArg: '/api/users' },
      { targetSymbol: 'post', chainPath: 'apiClient', firstArg: '/api/users' },
    ])
  })

  it('RQ-04b: class-based repository — calls edges 정상 발화됨', () => {
    // class 방식이면 method가 function 노드로 생성되어 body traverse 됨
    const r = parse(
      `
      import { apiClient } from './api.client'

      export class UserRepository {
        async getUsers() {
          return apiClient.get('/api/users')
        }
        async createUser(data: any) {
          return apiClient.post('/api/users', data)
        }
      }
    `,
      'src/user.repository.ts',
    )

    const getEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'get',
    )
    const postEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'post',
    )

    expect(getEdge).toBeDefined()
    const getPath = getEdge!.first_arg ?? getEdge!.arg_expressions?.find((a) => a.kind === 'string')?.value
    expect(getPath).toBe('/api/users')

    expect(postEdge).toBeDefined()
    const postPath = postEdge!.first_arg ?? postEdge!.arg_expressions?.find((a) => a.kind === 'string')?.value
    expect(postPath).toBe('/api/users')
  })

  it('RQ-04c: repository registry object preserves property key on constructor calls', () => {
    const r = parse(
      `
      import { UserRepository } from './UserRepository'

      const Repositories = {
        user: new UserRepository()
      }

      export default Repositories
    `,
      'src/repositories/index.ts',
    )

    const ctorEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'UserRepository',
    )
    expect(ctorEdge).toMatchObject({
      source_id: 'r1:src/repositories/index.ts:Repositories',
      target_specifier: './UserRepository',
      target_symbol: 'UserRepository',
      chain_path: 'user',
      resolve_status: 'pending',
    })
  })

  it('RQ-05: axios.create instance → get/post calls에 chain_path=instanceName', () => {
    // axios.create로 만든 인스턴스를 통한 API 호출
    const r = parse(
      `
      import axios from 'axios'

      const apiClient = axios.create({ baseURL: process.env.API_URL })

      export async function fetchUsers() {
        return apiClient.get('/users')
      }
      export async function createOrder(data: any) {
        return apiClient.post('/orders', data)
      }
    `,
      'src/api.client.ts',
    )

    const getEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'get',
    )
    const postEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'post',
    )

    expect(getEdge).toBeDefined()
    // chain_path는 로컬 alias(apiClient), target_specifier는 원본 패키지(axios)
    expect(getEdge!.chain_path).toContain('apiClient')
    expect(getEdge!.target_specifier).toBe('axios')
    expect(getEdge!.first_arg).toBe('/users')

    expect(postEdge).toBeDefined()
    expect(postEdge!.first_arg).toBe('/orders')
  })

  it('RQ-07: useSWR array key → array elements 파싱 (string + identifier)', () => {
    // useSWR(['/api/user', userId], fetcher) — 첫 번째 arg가 array literal
    // array elements가 CallArgExpression[]로 파싱되어야 build_relations에서 첫 string 요소 추출 가능
    const r = parse(`
      import useSWR from 'swr'

      export function useUser(userId: string) {
        const { data } = useSWR(['/api/user', userId], fetcher)
        return data
      }
    `)

    const swrEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'useSWR',
    )
    expect(swrEdge).toBeDefined()
    expect(swrEdge!.target_specifier).toBe('swr')

    const firstArg = swrEdge!.arg_expressions?.[0]
    expect(firstArg?.kind).toBe('array')

    // array elements가 파싱되어야 함
    const elements = (firstArg as any)?.elements
    expect(elements).toBeDefined()
    expect(elements).toHaveLength(2)
    expect(elements[0].kind).toBe('string')
    expect(elements[0].value).toBe('/api/user')
    expect(elements[1].kind).toBe('identifier')
  })

  it('RQ-07b: useSWR string key baseline — 기존 동작 유지', () => {
    const r = parse(`
      import useSWR from 'swr'

      export function useUsers() {
        const { data } = useSWR('/api/users', fetcher)
        return data
      }
    `)
    const swrEdge = r.edges.find(
      (e) => e.relation === 'calls' && e.target_symbol === 'useSWR',
    )
    expect(swrEdge).toBeDefined()
    const firstArg = swrEdge!.first_arg ?? swrEdge!.arg_expressions?.find((a) => a.kind === 'string')?.value
    expect(firstArg).toBe('/api/users')
  })

  it('RQ-06: template literal path → argExpressions.staticPattern으로 정규화', () => {
    const r = parse(
      `
      import axios from 'axios'

      const apiClient = axios.create({ baseURL: process.env.API_URL })

      export async function fetchUser(id: string) {
        return apiClient.get(\`/api/users/\${id}\`)
      }
      export async function fetchUserPosts(userId: string, postId: number) {
        return apiClient.get(\`/api/users/\${userId}/posts/\${postId}\`)
      }
    `,
      'src/api.client.ts',
    )

    const edges = r.edges.filter(
      (e) => e.relation === 'calls' && e.target_symbol === 'get',
    )
    expect(edges.length).toBeGreaterThanOrEqual(1)

    const edge = edges.find((e) => e.arg_expressions?.some((a) => a.kind === 'template'))
    expect(edge).toBeDefined()

    const templateArg = edge!.arg_expressions?.find((a) => a.kind === 'template')
    expect(templateArg).toBeDefined()
    expect(templateArg!.staticPattern).toBe('/api/users/:id')

    // 두 번째 호출 — 복수 params
    const edge2 = edges.find((e) =>
      e.arg_expressions?.some(
        (a) => a.kind === 'template' && a.staticPattern === '/api/users/:userId/posts/:postId',
      ),
    )
    expect(edge2).toBeDefined()
  })
})
