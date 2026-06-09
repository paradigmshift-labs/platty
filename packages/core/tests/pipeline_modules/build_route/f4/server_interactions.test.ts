import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodeNode } from '@/db/schema/code_graph.js'
import { evaluateSourceAnalyzers } from '@/pipeline_modules/build_route/index.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-route-interactions-'))
  tempDirs.push(dir)
  for (const [filePath, source] of Object.entries(files)) {
    const fullPath = join(dir, filePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, source)
  }
  return dir
}

function node(filePath: string, name: string, type: CodeNode['type'] = 'file'): CodeNode {
  return {
    id: `${REPO}:${filePath}:${name}`,
    repoId: REPO,
    type,
    filePath,
    name,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: false,
    isDefaultExport: false,
    isAsync: false,
    isTest: false,
    testType: null,
    docComment: null,
    parseStatus: 'ok',
    createdAt: '2026-05-13',
  }
}

describe('server interaction source fallback', () => {
  it('discovers a Next inline server action used by a form', () => {
    const repoPath = tempRepo({
      'app/dashboard/page.tsx': `
export default function Page() {
  async function createPost() {
    'use server'
  }
  return <form action={createPost} />
}`,
    })
    const page = node('app/dashboard/page.tsx', 'page.tsx')
    const action = node('app/dashboard/page.tsx', 'createPost', 'function')

    const result = evaluateSourceAnalyzers({
      repoPath,
      repoId: REPO,
      stackInfo: { framework: 'nextjs', routingLibs: [], routingFiles: ['app/dashboard/page.tsx'] },
      detections: [{ framework: 'nextjs', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [page, action],
    })

    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        framework: 'nextjs',
        kind: 'api',
        httpMethod: 'POST',
        fullPath: '/dashboard#action:createPost',
        handlerNodeId: action.id,
        metadata: expect.objectContaining({
          interactionKind: 'next_server_action',
          parentRoute: '/dashboard',
          actionName: 'createPost',
          stablePublicUrl: false,
        }),
      }),
    ]))
  })

  it('discovers React Router loader and action exports as server interaction entries', () => {
    const repoPath = tempRepo({
      'app/routes/posts.tsx': `
export async function loader() { return null }
export const action = async () => null
export default function Posts() { return null }
`,
    })
    const file = node('app/routes/posts.tsx', 'posts.tsx')
    const loader = node('app/routes/posts.tsx', 'loader', 'function')
    const action = node('app/routes/posts.tsx', 'action', 'function')

    const result = evaluateSourceAnalyzers({
      repoPath,
      repoId: REPO,
      stackInfo: { framework: 'react', routingLibs: ['react-router-dom@^6'], routingFiles: ['app/routes/posts.tsx'] },
      detections: [{ framework: 'react_router_v6', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file, loader, action],
    })

    expect(result.entryPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        framework: 'react_router_v6',
        kind: 'api',
        httpMethod: 'GET',
        fullPath: '/posts#loader',
        handlerNodeId: loader.id,
        metadata: expect.objectContaining({ interactionKind: 'react_router_loader' }),
      }),
      expect.objectContaining({
        framework: 'react_router_v6',
        kind: 'api',
        httpMethod: 'POST',
        fullPath: '/posts#action',
        handlerNodeId: action.id,
        metadata: expect.objectContaining({ interactionKind: 'react_router_action' }),
      }),
    ]))
  })

  it('does not treat a helper actions.ts file as a React Router route module', () => {
    const repoPath = tempRepo({
      'app/routes/actions.ts': `export const action = async () => null`,
    })
    const file = node('app/routes/actions.ts', 'actions.ts')
    const action = node('app/routes/actions.ts', 'action', 'function')

    const result = evaluateSourceAnalyzers({
      repoPath,
      repoId: REPO,
      stackInfo: { framework: 'react', routingLibs: ['react-router-dom@^6'], routingFiles: ['app/routes/actions.ts'] },
      detections: [{ framework: 'react_router_v6', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file, action],
    })

    expect(result.entryPoints.some((entry) => entry.metadata.interactionKind === 'react_router_action')).toBe(false)
  })
})
