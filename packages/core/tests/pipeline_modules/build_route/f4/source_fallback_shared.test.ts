import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodeNode } from '@/db/schema/code_graph.js'
import {
  findMatchingBrace,
  findMatchingBracket,
  findMatchingParen,
  joinUrlPath,
  normalizeReactRoutePath,
  resolveRelativeSourceFile,
  safeReadSource,
  stripJsLikeComments,
} from '@/pipeline_modules/build_route/f4/source_fallback_shared.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-route-shared-'))
  tempDirs.push(dir)
  for (const [filePath, source] of Object.entries(files)) {
    const fullPath = join(dir, filePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, source)
  }
  return dir
}

function fileNode(filePath: string): CodeNode {
  return {
    id: `${REPO}:${filePath}`,
    repoId: REPO,
    type: 'file',
    filePath,
    name: filePath,
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
    createdAt: '2026-05-14',
  }
}

describe('source fallback shared parsing helpers', () => {
  it('stripJsLikeComments removes line/block comments but preserves quoted markers', () => {
    const source = [
      'const url = "http://example.com"',
      "const marker = '/* not comment */'",
      '`// still string`',
      '// remove me',
      'const kept = 1 /* remove block */ + 2',
    ].join('\n')

    const out = stripJsLikeComments(source)

    expect(out).toContain('"http://example.com"')
    expect(out).toContain("'/* not comment */'")
    expect(out).toContain('`// still string`')
    expect(out).not.toContain('remove me')
    expect(out).not.toContain('remove block')
  })

  it('matching helpers handle nesting and unmatched inputs', () => {
    expect(findMatchingBrace('{ a: { b: 1 } }', 0)).toBe(14)
    expect(findMatchingBrace('{ missing', 0)).toBe(-1)
    expect(findMatchingBracket('[one, ["ignored ]"], two]', 0)).toBe(24)
    expect(findMatchingBracket('[missing', 0)).toBe(-1)
    expect(findMatchingParen('(call(")"))', 0)).toBe(10)
    expect(findMatchingParen('(missing', 0)).toBe(-1)
  })
})

describe('source fallback shared path helpers', () => {
  it('normalizes and joins route paths without duplicate slash suffixes', () => {
    expect(normalizeReactRoutePath('')).toBe('/')
    expect(normalizeReactRoutePath('/')).toBe('/')
    expect(normalizeReactRoutePath('admin/users')).toBe('/admin/users')
    expect(normalizeReactRoutePath('///admin//users')).toBe('/admin/users')
    expect(joinUrlPath('/', '')).toBe('/')
    expect(joinUrlPath('/', '/users/')).toBe('/users')
    expect(joinUrlPath('/admin/', 'users/list/')).toBe('/admin/users/list')
  })

  it('resolveRelativeSourceFile resolves relative, bare src, extensionless, and index files', () => {
    const repoPath = tempRepo({
      'src/pages/Dashboard.tsx': 'export default function Dashboard() {}',
      'src/routes/index.ts': 'export const routes = []',
    })
    const graphNodes = [
      fileNode('src/pages/Dashboard.tsx'),
      fileNode('src/routes/index.ts'),
    ]

    expect(resolveRelativeSourceFile('src/App.tsx', './pages/Dashboard', repoPath, graphNodes))
      .toEqual({ id: `${REPO}:src/pages/Dashboard.tsx`, filePath: 'src/pages/Dashboard.tsx' })
    expect(resolveRelativeSourceFile('src/App.tsx', 'routes', repoPath, graphNodes))
      .toEqual({ id: `${REPO}:src/routes/index.ts`, filePath: 'src/routes/index.ts' })
    expect(resolveRelativeSourceFile('src/App.tsx', './missing', repoPath, graphNodes)).toBeNull()
  })

  it('safeReadSource returns file contents or null for missing paths', () => {
    const repoPath = tempRepo({ 'src/app.ts': 'app.get("/health")' })

    expect(safeReadSource(repoPath, 'src/app.ts')).toBe('app.get("/health")')
    expect(safeReadSource(repoPath, 'src/missing.ts')).toBeNull()
  })
})
