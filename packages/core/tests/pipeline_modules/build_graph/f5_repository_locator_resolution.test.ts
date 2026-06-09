import { describe, expect, it } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript'
import { resolveCalls } from '@/pipeline_modules/build_graph/f5_resolve_calls'
import { pickTargetInFile } from '@/pipeline_modules/build_graph/f3a_resolve_import_edges'
import { resolveTypeRefs } from '@/pipeline_modules/build_graph/f4_resolve_type_refs'
import type {
  CodeEdgeRaw,
  CodeNodeRaw,
  ConstructorDIMap,
  FieldOriginsMap,
} from '@/pipeline_modules/build_graph/types'

interface FileSpec {
  filePath: string
  source: string
}

async function runGraph(files: FileSpec[]) {
  const adapter = new TypeScriptParserAdapter()
  const nodes: CodeNodeRaw[] = []
  const edges: CodeEdgeRaw[] = []
  const diMap: ConstructorDIMap = new Map()
  const fieldOrigins: FieldOriginsMap = new Map()

  for (const file of files) {
    const parsed = await adapter.parseFile(file.source, file.filePath, 'repo')
    nodes.push({
      id: `repo:${file.filePath}`,
      repo_id: 'repo',
      type: 'file',
      file_path: file.filePath,
      name: 'file',
      line_start: null,
      line_end: null,
      signature: null,
      exported: false,
      parse_status: 'ok',
      is_test: false,
      test_type: null,
      is_async: false,
      jsdoc: null,
    })
    nodes.push(...parsed.nodes)
    edges.push(...parsed.edges)

    for (const param of parsed.constructorParams) {
      const cls = parsed.nodes.find((node) => node.type === 'class' && node.name === param.className)
      if (cls) diMap.set(cls.id, param.params)
    }
    if (parsed.fieldOrigins) {
      for (const [key, value] of parsed.fieldOrigins) fieldOrigins.set(key, value)
    }
  }

  const nodesByFile = new Map<string, CodeNodeRaw[]>()
  for (const node of nodes) {
    const existing = nodesByFile.get(node.file_path) ?? []
    existing.push(node)
    nodesByFile.set(node.file_path, existing)
  }

  for (const edge of edges) {
    if (edge.relation !== 'imports' || edge.target_id) continue
    const spec = edge.target_specifier
    if (!spec || !spec.startsWith('src/')) continue
    const candidates = [`${spec}.ts`, `${spec}/index.ts`]
    for (const candidate of candidates) {
      const picked = pickTargetInFile(candidate, 'imports', edge.target_symbol, nodesByFile)
      if (picked.status !== 'resolved' || !picked.targetId) continue
      edge.target_id = picked.targetId
      edge.resolve_status = 'resolved'
      break
    }
  }

  const sourceFiles = files.map((file) => ({ path: file.filePath, content: file.source, isTest: false }))
  const typeResolvedEdges = await resolveTypeRefs(edges, nodes, sourceFiles)
  const resolvedEdges = await resolveCalls(typeResolvedEdges, nodes, diMap, new Map(), fieldOrigins)
  return { nodes, edges: resolvedEdges }
}

function findCall(edges: CodeEdgeRaw[], targetSymbol: string, sourceSuffix: string) {
  const edge = edges.find(
    (candidate) =>
      candidate.relation === 'calls' &&
      candidate.target_symbol === targetSymbol &&
      candidate.source_id.endsWith(sourceSuffix),
  )
  expect(edge, `Expected call ${targetSymbol} from ${sourceSuffix}`).toBeTruthy()
  return edge!
}

function expectResolvedToMethod(edge: CodeEdgeRaw, methodSuffix: string) {
  expect(edge.resolve_status).toBe('resolved')
  expect(edge.target_id).toBeTruthy()
  expect(edge.target_id!.endsWith(methodSuffix)).toBe(true)
}

function findCallByChain(edges: CodeEdgeRaw[], chainPath: string, targetSymbol: string, sourceSuffix: string) {
  const edge = edges.find(
    (candidate) =>
      candidate.relation === 'calls' &&
      candidate.chain_path === chainPath &&
      candidate.target_symbol === targetSymbol &&
      candidate.source_id.endsWith(sourceSuffix),
  )
  expect(edge, `Expected call ${chainPath}.${targetSymbol} from ${sourceSuffix}`).toBeTruthy()
  return edge!
}

describe('F5 repository locator call resolution', () => {
  it('resolves imported registry member calls to repository class methods', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/infra/repository.ts',
        source: `
          export class AdRepository {
            getUnits() { return fetch('/api/ad-units') }
          }
          export class AuthRepository {
            getUnits() { return fetch('/api/auth-units') }
          }
          const Repositories = {
            ad: new AdRepository(),
            auth: new AuthRepository(),
          }
          export default Repositories
        `,
      },
      {
        filePath: 'src/features/useAdUnits.ts',
        source: `
          import Repositories from 'src/infra/repository'
          export function useAdUnits() {
            return Repositories.ad.getUnits()
          }
        `,
      },
    ])

    const call = findCall(edges, 'getUnits', ':useAdUnits')
    expectResolvedToMethod(call, ':AdRepository.getUnits')
  })

  it('resolves destructured registry properties', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/infra/repository.ts',
        source: `
          export class AuthRepository {
            getMyProfile() { return fetch('/api/me') }
          }
          export class AdRepository {
            getMyProfile() { return fetch('/api/ad-profile') }
          }
          export const Repositories = {
            auth: new AuthRepository(),
            ad: new AdRepository(),
          }
        `,
      },
      {
        filePath: 'src/features/useMyProfile.ts',
        source: `
          import { Repositories } from 'src/infra/repository'
          export function useMyProfile() {
            const { auth } = Repositories
            return auth.getMyProfile()
          }
        `,
      },
    ])

    const call = findCall(edges, 'getMyProfile', ':useMyProfile')
    expectResolvedToMethod(call, ':AuthRepository.getMyProfile')
  })

  it('resolves aliased destructured registry properties through the original property key', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/infra/repository.ts',
        source: `
          export class AuthRepository {
            getMyProfile() { return fetch('/api/me') }
          }
          export class RepoRepository {
            getMyProfile() { return fetch('/api/repo-profile') }
          }
          export const Repositories = {
            auth: new AuthRepository(),
            repo: new RepoRepository(),
          }
        `,
      },
      {
        filePath: 'src/features/useMyProfile.ts',
        source: `
          import { Repositories } from 'src/infra/repository'
          export function useMyProfile() {
            const { auth: repo } = Repositories
            return repo.getMyProfile()
          }
        `,
      },
    ])

    const call = findCall(edges, 'getMyProfile', ':useMyProfile')
    expectResolvedToMethod(call, ':AuthRepository.getMyProfile')
  })

  it('does not resolve nested destructured bindings as registry properties', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/infra/repository.ts',
        source: `
          export class AuthRepository {
            get() { return fetch('/api/auth') }
          }
          export const Repositories = {
            auth: new AuthRepository(),
          }
        `,
      },
      {
        filePath: 'src/features/useNestedClient.ts',
        source: `
          import { Repositories } from 'src/infra/repository'
          export function useNestedClient() {
            const { auth: { client } } = Repositories
            return client.get()
          }
        `,
      },
    ])

    const call = findCallByChain(edges, 'client', 'get', ':useNestedClient')
    expect(call.resolve_status).not.toBe('resolved')
    expect(call.target_id).toBeNull()
  })

  it('does not guess unknown registry properties', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/infra/repository.ts',
        source: `
          export class AuthRepository {
            getMyProfile() { return fetch('/api/me') }
            get() { return fetch('/api/auth') }
          }
          export const Repositories = {
            auth: new AuthRepository(),
          }
        `,
      },
      {
        filePath: 'src/features/useUnknown.ts',
        source: `
          import { Repositories } from 'src/infra/repository'
          export function useUnknown() {
            return Repositories.unknown.get()
          }
        `,
      },
    ])

    const call = findCall(edges, 'get', ':useUnknown')
    expect(call.resolve_status).not.toBe('resolved')
    expect(call.target_id).toBeNull()
  })

  it('does not resolve registry properties through the wrong imported root', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/infra/repository.ts',
        source: `
          export class AdRepository {
            getUnits() { return fetch('/api/ad-units') }
          }
          export const Repositories = {
            ad: new AdRepository(),
          }
          export const Other = {}
        `,
      },
      {
        filePath: 'src/features/useAdUnits.ts',
        source: `
          import { Repositories, Other } from 'src/infra/repository'
          export function useAdUnits() {
            Repositories.ad.getUnits()
            Other.ad.getUnits()
          }
        `,
      },
    ])

    const repositoriesCall = findCallByChain(edges, 'Repositories.ad', 'getUnits', ':useAdUnits')
    expectResolvedToMethod(repositoriesCall, ':AdRepository.getUnits')

    const otherCall = findCallByChain(edges, 'Other.ad', 'getUnits', ':useAdUnits')
    expect(otherCall.resolve_status).not.toBe('resolved')
    expect(otherCall.target_id).toBeNull()
  })

  it('does not resolve destructured aliases through a sibling import from the same module', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/infra/repository.ts',
        source: `
          export class AdRepository {
            getUnits() { return fetch('/api/ad-units') }
          }
          export const Repositories = {
            ad: new AdRepository(),
          }
          export const Empty = {}
        `,
      },
      {
        filePath: 'src/features/useEmptyAd.ts',
        source: `
          import { Repositories, Empty } from 'src/infra/repository'
          export function useEmptyAd() {
            console.log(Repositories)
            const { ad } = Empty
            ad.getUnits()
          }
        `,
      },
    ])

    const call = findCallByChain(edges, 'ad', 'getUnits', ':useEmptyAd')
    expect(call.resolve_status).not.toBe('resolved')
    expect(call.target_id).toBeNull()
  })

  it('resolves imported module-level singleton instance method calls to the class method', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/queries/project.query.ts',
        source: `
          export class ProjectQuery {
            getProjects() { return fetch('/api/projects') }
            createProject() { return fetch('/api/projects', { method: 'POST' }) }
          }
          export const projectQuery = new ProjectQuery()
        `,
      },
      {
        filePath: 'src/controllers/project.controller.ts',
        source: `
          import { projectQuery } from 'src/queries/project.query'
          export function getProjects() {
            return projectQuery.getProjects()
          }
          export function createProject() {
            return projectQuery.createProject()
          }
        `,
      },
    ])

    const getCall = findCall(edges, 'getProjects', ':getProjects')
    expectResolvedToMethod(getCall, ':ProjectQuery.getProjects')
    const createCall = findCall(edges, 'createProject', ':createProject')
    expectResolvedToMethod(createCall, ':ProjectQuery.createProject')
  })

  it('marks an imported singleton class with a missing method as an explicit gap', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/queries/project.query.ts',
        source: `
          export class ProjectQuery {
            getProjects() { return fetch('/api/projects') }
          }
          export const projectQuery = new ProjectQuery()
        `,
      },
      {
        filePath: 'src/controllers/project.controller.ts',
        source: `
          import { projectQuery } from 'src/queries/project.query'
          export function deleteProject() {
            return projectQuery.deleteProject()
          }
        `,
      },
    ])

    const call = findCall(edges, 'deleteProject', ':deleteProject')
    expect(call.resolve_status).toBe('failed')
    expect(call.target_id).toBeNull()
    expect((call as CodeEdgeRaw & { explicit_gap?: boolean }).explicit_gap).toBe(true)
  })

  it('does not resolve a singleton method when a sibling import from the same module is the chain root', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/queries/project.query.ts',
        source: `
          export class ProjectQuery {
            getProjects() { return fetch('/api/projects') }
          }
          export const projectQuery = new ProjectQuery()
          export const config = { timeout: 1000 }
        `,
      },
      {
        filePath: 'src/controllers/project.controller.ts',
        source: `
          import { projectQuery, config } from 'src/queries/project.query'
          export function getProjects() {
            console.log(projectQuery)
            return config.getProjects()
          }
        `,
      },
    ])

    const call = findCallByChain(edges, 'config', 'getProjects', ':getProjects')
    expect(call.resolve_status).not.toBe('resolved')
    expect(call.target_id).toBeNull()
  })

  it('marks known registry classes with missing methods as explicit gaps', async () => {
    const { edges } = await runGraph([
      {
        filePath: 'src/infra/repository.ts',
        source: `
          export class AdRepository {
            getUnits() { return fetch('/api/ad-units') }
          }
          const Repositories = {
            ad: new AdRepository(),
          }
          export default Repositories
        `,
      },
      {
        filePath: 'src/features/useMissing.ts',
        source: `
          import Repositories from 'src/infra/repository'
          export function useMissing() {
            return Repositories.ad.get()
          }
        `,
      },
    ])

    const call = findCall(edges, 'get', ':useMissing')
    expect(call.resolve_status).toBe('failed')
    expect(call.target_id).toBeNull()
    expect((call as CodeEdgeRaw & { explicit_gap?: boolean }).explicit_gap).toBe(true)
  })
})
