import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import { createSourceFallback } from '@/pipeline_modules/build_relations/source_fallback.js'
import type {
  BuildRelationsInputs,
  CodeEdgeLike,
  CodeNodeLike,
} from '@/pipeline_modules/build_relations/types.js'

const REPO_ID = 'repo_source_fallback'

function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id,
    filePath: 'src/app.ts',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

let edgeId = 80_000
function makeEdge(sourceId: string, relation: string, opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return {
    id: edgeId++,
    repoId: REPO_ID,
    sourceId,
    targetId: null,
    relation,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
    ...opts,
  }
}

function makeInputs(repoPath: string, nodes: CodeNodeLike[], edges: CodeEdgeLike[]): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath,
    includeTestSources: false,
    nodes,
    edges,
    models: [],
  }
}

function runPipeline(inputs: BuildRelationsInputs) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(candidates, index, createSourceFallback(inputs.repoPath))
  return normalizeRelations(extracted)
}

describe('source fallback constant resolution', () => {
  it('resolves object route constants for API calls from repo source', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    writeFileSync(join(repoPath, 'src_app.ts'), `
      import axios from 'axios'
      export const API_ROUTES = {
        orders: '/api/orders',
      }
    `)
    const handler = makeNode(`${REPO_ID}:src_app.ts:createOrder`, { filePath: 'src_app.ts' })
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'axios', targetSymbol: 'axios' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'axios',
        firstArg: 'API_ROUTES.orders',
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [handler], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/orders',
      operation: 'POST',
      confidence: 'medium',
    })
  })

  it('recovers missing build_graph firstArg for template global fetch from repo source', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    mkdirSync(join(repoPath, 'src/services'), { recursive: true })
    writeFileSync(join(repoPath, 'src/services/athenaService.ts'), `
      export async function getAdReports(searchParams: string) {
        return fetch(\`/api/athena/reports?\${searchParams}\`)
      }
    `)
    const handler = makeNode(`${REPO_ID}:src/services/athenaService.ts:getAdReports`, {
      filePath: 'src/services/athenaService.ts',
      lineStart: 2,
      lineEnd: 4,
    })
    const edges = [
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'fetch',
        chainPath: null,
        firstArg: null,
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [handler], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/athena/reports',
      operation: 'GET',
      canonicalTarget: 'GET /api/athena/reports',
      confidence: 'medium',
    })
  })

  it('uses per-edge graph template argExpressions before source regex fallback for API calls', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    const handler = makeNode(`${REPO_ID}:src/login.ts:login`, {
      filePath: 'src/login.ts',
      lineStart: 1,
      lineEnd: 8,
    })
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'axios', targetSymbol: 'axios' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'axios',
        firstArg: null,
        argExpressions: [{ index: 0, kind: 'template', raw: '`/api/auth/kakao`', staticPattern: '/api/auth/kakao', identifiers: [] }],
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [handler], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'api_call',
      target: '/api/auth/kakao',
      operation: 'POST',
      confidence: 'high',
    })
  })

  it('resolves direct route constants for navigation from repo source', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    writeFileSync(join(repoPath, 'shell.dart'), `
      const homeRoute = '/home';
    `)
    const widget = makeNode(`${REPO_ID}:shell.dart:Shell`, { filePath: 'shell.dart' })
    const edges = [
      makeEdge(widget.id, 'imports', { targetSpecifier: 'go_router', targetSymbol: 'GoRouter' }),
      makeEdge(widget.id, 'calls', {
        targetSymbol: 'go',
        chainPath: 'context',
        firstArg: 'homeRoute',
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [widget], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/home',
      canonicalTarget: 'screen:/home',
      confidence: 'medium',
    })
  })

  it('resolves imported object route constants for navigation from repo source', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/routes.ts'), `
      export const Routes = { profile: '/profile' } as const
    `)
    writeFileSync(join(repoPath, 'src/nav.tsx'), `
      import { Routes } from './routes'
    `)
    const comp = makeNode(`${REPO_ID}:src/nav.tsx:goProfile`, { filePath: 'src/nav.tsx' })
    const edges = [
      makeEdge(comp.id, 'imports', { targetSpecifier: 'next/router', targetSymbol: 'useRouter' }),
      makeEdge(comp.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: 'Routes.profile',
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [comp], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/profile',
      canonicalTarget: 'screen:/profile',
      confidence: 'medium',
    })
  })

  it('resolves Dart static route constants through local imports', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/app_routes.dart'), `
      class AppRoutes {
        static const settings = '/settings';
      }
    `)
    writeFileSync(join(repoPath, 'lib/shell.dart'), `
      import './app_routes.dart';
    `)
    const widget = makeNode(`${REPO_ID}:lib/shell.dart:goSettings`, { filePath: 'lib/shell.dart' })
    const edges = [
      makeEdge(widget.id, 'imports', { targetSpecifier: 'get', targetSymbol: 'Get' }),
      makeEdge(widget.id, 'calls', {
        targetSymbol: 'toNamed',
        chainPath: 'Get',
        firstArg: 'AppRoutes.settings',
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [widget], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/settings',
      operation: 'toNamed',
      canonicalTarget: 'screen:/settings',
      confidence: 'medium',
    })
  })

  it('recovers missing build_graph firstArg for Flutter Navigator calls from repo source', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    mkdirSync(join(repoPath, 'lib'), { recursive: true })
    writeFileSync(join(repoPath, 'lib/app_routes.dart'), `
      class AppRoutes {
        static const friendListPage = '/friend-list';
      }
    `)
    writeFileSync(join(repoPath, 'lib/profile.dart'), `
      import './app_routes.dart';
      class Profile {
        void open(context) {
          Navigator.of(context).pushNamed(AppRoutes.friendListPage);
        }
      }
    `)
    const widget = makeNode(`${REPO_ID}:lib/profile.dart:Profile.open`, {
      filePath: 'lib/profile.dart',
      lineStart: 4,
      lineEnd: 6,
    })
    const edges = [
      makeEdge(widget.id, 'calls', {
        targetSymbol: 'pushNamed',
        chainPath: 'Navigator.of()',
        firstArg: null,
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [widget], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/friend-list',
      operation: 'pushNamed',
      canonicalTarget: 'screen:/friend-list',
      confidence: 'medium',
    })
  })

  it('uses per-edge graph template argExpressions for multiple router calls in one source node', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    const comp = makeNode(`${REPO_ID}:src/nav.tsx:useActions`, {
      filePath: 'src/nav.tsx',
      lineStart: 1,
      lineEnd: 12,
    })
    const edges = [
      makeEdge(comp.id, 'imports', { targetSpecifier: 'next/navigation', targetSymbol: 'useRouter' }),
      makeEdge(comp.id, 'calls', { targetSymbol: 'useRouter', chainPath: null }),
      makeEdge(comp.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: null,
        argExpressions: [{ index: 0, kind: 'template', raw: '`/review/${id}`', staticPattern: '/review/:id', identifiers: ['id'] }],
      }),
      makeEdge(comp.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: null,
        argExpressions: [{ index: 0, kind: 'template', raw: '`/diary/${id}`', staticPattern: '/diary/:id', identifiers: ['id'] }],
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [comp], edges))

    expect(result.map((relation) => relation.target).sort()).toEqual(['/diary/${id}', '/review/${id}'])
  })

  it('extracts every static router target from a collapsed graph call edge', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/nav.tsx'), `
      import { useRouter } from 'next/navigation'
      export function useActions(router = useRouter()) {
        const review = (id: string) => router.push(\`/review/\${id}\`)
        const diary = (id: string) => router.push(\`/diary/\${id}\`)
        return { review, diary }
      }
    `)
    const comp = makeNode(`${REPO_ID}:src/nav.tsx:useActions`, {
      filePath: 'src/nav.tsx',
      lineStart: 2,
      lineEnd: 7,
    })
    const edges = [
      makeEdge(comp.id, 'imports', { targetSpecifier: 'next/navigation', targetSymbol: 'useRouter' }),
      makeEdge(comp.id, 'calls', { targetSymbol: 'useRouter', chainPath: null }),
      makeEdge(comp.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: null,
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [comp], edges))

    expect(result.map((relation) => relation.target).sort()).toEqual(['/diary/${id}', '/review/${id}'])
  })

  it('extracts every static API target from a collapsed graph call edge', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    mkdirSync(join(repoPath, 'src'), { recursive: true })
    writeFileSync(join(repoPath, 'src/login.ts'), `
      import axios from 'axios'
      export async function login(code: string) {
        await axios.post(\`/api/login/kakao?code=\${code}\`)
        await axios.post('/api/fbevent')
      }
    `)
    const handler = makeNode(`${REPO_ID}:src/login.ts:login`, {
      filePath: 'src/login.ts',
      lineStart: 2,
      lineEnd: 6,
    })
    const edges = [
      makeEdge(handler.id, 'imports', { targetSpecifier: 'axios', targetSymbol: 'axios' }),
      makeEdge(handler.id, 'calls', {
        targetSymbol: 'post',
        chainPath: 'axios',
        firstArg: null,
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [handler], edges))

    expect(result.map((relation) => relation.target).sort()).toEqual(['/api/fbevent', '/api/login/kakao'])
  })

  it('follows re-exported route constants within the five hop import bound', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    mkdirSync(join(repoPath, 'src/routes'), { recursive: true })
    writeFileSync(join(repoPath, 'src/routes/constants.ts'), `
      export const Routes = { dashboard: '/dashboard' }
    `)
    writeFileSync(join(repoPath, 'src/routes/index.ts'), `
      export { Routes } from './constants'
    `)
    writeFileSync(join(repoPath, 'src/nav.tsx'), `
      import { Routes } from './routes'
    `)
    const comp = makeNode(`${REPO_ID}:src/nav.tsx:goDashboard`, { filePath: 'src/nav.tsx' })
    const edges = [
      makeEdge(comp.id, 'imports', { targetSpecifier: 'react-router-dom', targetSymbol: 'useNavigate' }),
      makeEdge(comp.id, 'calls', {
        targetSymbol: 'navigate',
        chainPath: 'navigate',
        firstArg: 'Routes.dashboard',
      }),
    ]

    const result = runPipeline(makeInputs(repoPath, [comp], edges))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/dashboard',
      canonicalTarget: 'screen:/dashboard',
      confidence: 'medium',
    })
  })

  it('rejects constants outside the repository root', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-rel-source-'))
    const fallback = createSourceFallback(repoPath)

    const resolved = fallback.resolveConstant({
      filePath: '../outside.ts',
      nodeId: 'node',
      identifier: 'API_ROUTES.orders',
      allowedScopes: ['api'],
    })

    expect(resolved).toBeNull()
  })
})
