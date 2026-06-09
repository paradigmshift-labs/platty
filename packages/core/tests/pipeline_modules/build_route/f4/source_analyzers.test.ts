import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodeNode } from '@/db/schema/code_graph.js'
import { runAnalyzerAdapters } from '@/pipeline_modules/build_route/f4_evaluate_source_analyzers.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type { AnalyzerContext, BuildRouteAnalyzerAdapter } from '@/pipeline_modules/build_route/types.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-route-analyzers-'))
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
    createdAt: '2026-05-13',
  }
}

function ctx(nodes: CodeNode[] = []): AnalyzerContext {
  return {
    repoPath: '/repo',
    repoId: REPO,
    stackInfo: { framework: 'react', routingLibs: [] },
    detections: [],
    graphNodes: nodes,
    graph: createGraphIndex({ nodes, edges: [] }),
  }
}

describe('runAnalyzerAdapters', () => {
  it('does not run analyzers when appliesTo is false', () => {
    const analyzer: BuildRouteAnalyzerAdapter = {
      name: 'skip',
      kind: 'source_route',
      framework: 'react',
      appliesTo: () => false,
      candidateFiles: () => {
        throw new Error('should not ask for candidates')
      },
      analyzeFile: () => {
        throw new Error('should not analyze')
      },
    }

    expect(runAnalyzerAdapters({ ctx: ctx(), analyzers: [analyzer], readFile: () => '' })).toEqual({
      entryPoints: [],
      suspected: [],
      diagnostics: { filesRead: 0 },
    })
  })

  it('does not read files when candidateFiles is empty', () => {
    let reads = 0
    const analyzer: BuildRouteAnalyzerAdapter = {
      name: 'empty',
      kind: 'source_route',
      framework: 'react',
      appliesTo: () => true,
      candidateFiles: () => [],
      analyzeFile: () => ({ entryPoints: [], suspected: [], diagnostics: {} }),
    }

    const result = runAnalyzerAdapters({
      ctx: ctx(),
      analyzers: [analyzer],
      readFile: () => {
        reads += 1
        return ''
      },
    })

    expect(reads).toBe(0)
    expect(result.diagnostics).toEqual({ 'empty.emptyCandidates': 1, filesRead: 0 })
  })

  it('deduplicates candidate file reads and merges analyzer output deterministically', () => {
    const app = fileNode('src/App.tsx')
    const readFiles: string[] = []
    const analyzer: BuildRouteAnalyzerAdapter = {
      name: 'semantic',
      kind: 'semantic_page',
      framework: 'react',
      appliesTo: () => true,
      candidateFiles: () => ['src/App.tsx', 'src/App.tsx'],
      analyzeFile: (file) => ({
        entryPoints: [],
        suspected: [{ nodeId: file.fileNodeId, adapter: 'semantic', reason: 'semantic_navigation_ambiguous' }],
        diagnostics: { analyzedFiles: 1 },
      }),
    }

    const result = runAnalyzerAdapters({
      ctx: ctx([app]),
      analyzers: [analyzer],
      readFile: (filePath) => {
        readFiles.push(filePath)
        return 'source'
      },
    })

    expect(readFiles).toEqual(['src/App.tsx'])
    expect(result.suspected).toEqual([{ nodeId: app.id, adapter: 'semantic', reason: 'semantic_navigation_ambiguous' }])
    expect(result.diagnostics).toEqual({ 'semantic.analyzedFiles': 1, filesRead: 1 })
  })

  it('records analyzer errors without dropping other analyzer results', () => {
    const app = fileNode('src/App.tsx')
    const bad: BuildRouteAnalyzerAdapter = {
      name: 'bad',
      kind: 'source_route',
      framework: 'react',
      appliesTo: () => true,
      candidateFiles: () => ['src/App.tsx'],
      analyzeFile: () => {
        throw new Error('broken')
      },
    }
    const good: BuildRouteAnalyzerAdapter = {
      name: 'good',
      kind: 'semantic_page',
      framework: 'react',
      appliesTo: () => true,
      candidateFiles: () => ['src/App.tsx'],
      analyzeFile: () => ({ entryPoints: [], suspected: [], diagnostics: { analyzedFiles: 1 } }),
    }

    const result = runAnalyzerAdapters({
      ctx: ctx([app]),
      analyzers: [bad, good],
      readFile: () => 'source',
    })

    expect(result.diagnostics).toEqual({ 'bad.errors': 1, 'good.analyzedFiles': 1, filesRead: 1 })
  })

  it('records appliesTo and candidateFiles errors', () => {
    const appliesBad: BuildRouteAnalyzerAdapter = {
      name: 'applies_bad',
      kind: 'source_route',
      framework: 'react',
      appliesTo: () => {
        throw new Error('bad applies')
      },
      candidateFiles: () => ['src/App.tsx'],
      analyzeFile: () => ({ entryPoints: [], suspected: [], diagnostics: {} }),
    }
    const candidatesBad: BuildRouteAnalyzerAdapter = {
      name: 'candidates_bad',
      kind: 'source_route',
      framework: 'react',
      appliesTo: () => true,
      candidateFiles: () => {
        throw new Error('bad candidates')
      },
      analyzeFile: () => ({ entryPoints: [], suspected: [], diagnostics: {} }),
    }

    const result = runAnalyzerAdapters({
      ctx: ctx(),
      analyzers: [appliesBad, candidatesBad],
      readFile: () => 'source',
    })

    expect(result.diagnostics).toEqual({
      'applies_bad.errors': 1,
      'candidates_bad.errors': 1,
      filesRead: 0,
    })
  })

  it('skips unreadable candidate files and caches null reads', () => {
    const app = fileNode('src/App.tsx')
    const reads: string[] = []
    const analyzer: BuildRouteAnalyzerAdapter = {
      name: 'missing',
      kind: 'source_route',
      framework: 'react',
      appliesTo: () => true,
      candidateFiles: () => ['src/App.tsx', 'src/App.tsx'],
      analyzeFile: () => {
        throw new Error('should not analyze missing source')
      },
    }

    const result = runAnalyzerAdapters({
      ctx: ctx([app]),
      analyzers: [analyzer],
      readFile: (filePath) => {
        reads.push(filePath)
        return null
      },
    })

    expect(reads).toEqual(['src/App.tsx'])
    expect(result).toEqual({ entryPoints: [], suspected: [], diagnostics: { filesRead: 0 } })
  })

  it('uses filesystem reader and filePath fallback when graph has no file node', () => {
    const repoPath = tempRepo({ 'src/App.tsx': 'export default function App() {}' })
    const analyzer: BuildRouteAnalyzerAdapter = {
      name: 'fs',
      kind: 'source_route',
      framework: 'react',
      appliesTo: () => true,
      candidateFiles: () => ['src/App.tsx'],
      analyzeFile: (file) => ({
        entryPoints: [],
        suspected: [{ nodeId: file.fileNodeId, adapter: 'fs', reason: 'semantic_navigation_ambiguous' }],
        diagnostics: { sourceLength: file.source.length },
      }),
    }

    const result = runAnalyzerAdapters({
      ctx: { ...ctx(), repoPath },
      analyzers: [analyzer],
    })

    expect(result.suspected).toEqual([
      { nodeId: 'src/App.tsx', adapter: 'fs', reason: 'semantic_navigation_ambiguous' },
    ])
    expect(result.diagnostics).toEqual({ 'fs.sourceLength': 32, filesRead: 1 })
  })

  it('filesystem reader returns null for missing files', () => {
    const analyzer: BuildRouteAnalyzerAdapter = {
      name: 'fs_missing',
      kind: 'source_route',
      framework: 'react',
      appliesTo: () => true,
      candidateFiles: () => ['src/Missing.tsx'],
      analyzeFile: () => {
        throw new Error('should not analyze missing source')
      },
    }

    const result = runAnalyzerAdapters({
      ctx: { ...ctx(), repoPath: tempRepo({}) },
      analyzers: [analyzer],
    })

    expect(result).toEqual({ entryPoints: [], suspected: [], diagnostics: { filesRead: 0 } })
  })
})
