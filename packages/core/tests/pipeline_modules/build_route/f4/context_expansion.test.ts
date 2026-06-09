import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'
import { buildAnalyzerContextBundle } from '@/pipeline_modules/build_route/analyzers/shared/context_expansion.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'

const REPO = 'repo'
let edgeId = 1
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-route-context-'))
  tempDirs.push(dir)
  for (const [filePath, source] of Object.entries(files)) {
    const fullPath = join(dir, filePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, source, { flag: 'w' })
  }
  return dir
}

function n(filePath: string, name = filePath): CodeNode {
  return {
    id: `${REPO}:${filePath}`,
    repoId: REPO,
    type: 'file',
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

function e(source: CodeNode, target: CodeNode | null, relation: CodeEdge['relation'] = 'imports'): CodeEdge {
  return {
    id: edgeId++,
    repoId: REPO,
    sourceId: source.id,
    targetId: target?.id ?? null,
    relation,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    resolveStatus: target ? 'resolved' : 'failed',
    confidence: null,
    source: 'static',
    createdAt: '2026-05-13',
  }
}

describe('buildAnalyzerContextBundle', () => {
  it('includes direct import targets once', () => {
    const app = n('src/app.ts')
    const feed = n('src/feed.ts')
    const repoPath = tempRepo({
      'src/app.ts': 'import { Feed } from "./feed"',
      'src/feed.ts': 'export function Feed() {}',
    })
    const graph = createGraphIndex({ nodes: [app, feed], edges: [e(app, feed), e(app, feed)] })

    const result = buildAnalyzerContextBundle({ repoPath, graph, rootFilePath: app.filePath, reason: 'import_export' })

    expect(result.bundle.rootFile.source).toContain('Feed')
    expect(result.bundle.relatedFiles.map((file) => file.filePath)).toEqual(['src/feed.ts'])
    expect(result.bundle.relatedNodeIds).toEqual([feed.id])
    expect(result.diagnostics).toMatchObject({ relatedFiles: 1, relatedNodeIds: 1, suspected: 0 })
  })

  it('respects related-file and source-byte limits', () => {
    const root = n('src/root.ts')
    const a = n('src/a.ts')
    const b = n('src/b.ts')
    const repoPath = tempRepo({
      'src/root.ts': 'root',
      'src/a.ts': '1234567890',
      'src/b.ts': 'abcdefghij',
    })
    const graph = createGraphIndex({ nodes: [root, a, b], edges: [e(root, a), e(root, b)] })

    const result = buildAnalyzerContextBundle({
      repoPath,
      graph,
      rootFilePath: root.filePath,
      reason: 'import_export',
      limits: { maxRelatedFiles: 1, maxSourceBytesPerFile: 4 },
    })

    expect(result.bundle.relatedFiles).toHaveLength(1)
    expect(result.bundle.relatedFiles[0].source).toBe('1234')
  })

  it('follows re-exports only within maxReExportDepth', () => {
    const root = n('src/root.ts')
    const barrel1 = n('src/barrel1.ts')
    const barrel2 = n('src/barrel2.ts')
    const leaf = n('src/leaf.ts')
    const repoPath = tempRepo({
      'src/root.ts': 'export * from "./barrel1"',
      'src/barrel1.ts': 'export * from "./barrel2"',
      'src/barrel2.ts': 'export * from "./leaf"',
      'src/leaf.ts': 'export const leaf = true',
    })
    const graph = createGraphIndex({
      nodes: [root, barrel1, barrel2, leaf],
      edges: [e(root, barrel1, 're_exports'), e(barrel1, barrel2, 're_exports'), e(barrel2, leaf, 're_exports')],
    })

    const result = buildAnalyzerContextBundle({
      repoPath,
      graph,
      rootFilePath: root.filePath,
      reason: 're_export',
      limits: { maxReExportDepth: 2 },
    })

    expect(result.bundle.relatedFiles.map((file) => file.filePath)).toEqual(['src/barrel1.ts', 'src/barrel2.ts'])
  })

  it('ignores generated, vendor, build, and secret-like files', () => {
    const root = n('src/root.ts')
    const generated = n('src/generated/routes.ts')
    const env = n('.env')
    const secret = n('src/api_secret.ts')
    const nodeModules = n('node_modules/pkg/index.ts')
    const iosPods = n('ios/Pods/App.swift')
    const androidBuild = n('android/build/generated.kt')
    const repoPath = tempRepo({
      'src/root.ts': 'root',
      'src/generated/routes.ts': 'generated',
      '.env': 'TOKEN=secret',
      'src/api_secret.ts': 'secret',
      'node_modules/pkg/index.ts': 'vendor',
      'ios/Pods/App.swift': 'pod',
      'android/build/generated.kt': 'android build',
    })
    const graph = createGraphIndex({
      nodes: [root, generated, env, secret, nodeModules, iosPods, androidBuild],
      edges: [
        e(root, generated),
        e(root, env),
        e(root, secret),
        e(root, nodeModules),
        e(root, iosPods),
        e(root, androidBuild),
      ],
    })

    const result = buildAnalyzerContextBundle({ repoPath, graph, rootFilePath: root.filePath, reason: 'import_export' })

    expect(result.bundle.relatedFiles).toEqual([])
  })

  it('returns empty root source when root file is missing or ignored', () => {
    const graph = createGraphIndex({ nodes: [], edges: [] })
    const repoPath = tempRepo({})

    const missing = buildAnalyzerContextBundle({ repoPath, graph, rootFilePath: 'src/missing.ts', reason: 'import_export' })
    const ignored = buildAnalyzerContextBundle({ repoPath, graph, rootFilePath: '.env', reason: 'import_export' })

    expect(missing.bundle.rootFile).toEqual({ filePath: 'src/missing.ts', source: '', fileNodeId: 'src/missing.ts' })
    expect(ignored.bundle.rootFile).toEqual({ filePath: '.env', source: '', fileNodeId: '.env' })
  })

  it('returns empty root source when filesystem read fails after open', () => {
    const repoPath = tempRepo({ 'src/file.ts': 'file' })
    mkdirSync(join(repoPath, 'src/dir'), { recursive: true })
    const graph = createGraphIndex({ nodes: [], edges: [] })

    const result = buildAnalyzerContextBundle({ repoPath, graph, rootFilePath: 'src/dir', reason: 'import_export' })

    expect(result.bundle.rootFile).toEqual({ filePath: 'src/dir', source: '', fileNodeId: 'src/dir' })
  })

  it('ignores non-import edges, missing targets, unreadable targets, and duplicate node ids', () => {
    const root = n('src/root.ts')
    const target = n('src/target.ts')
    const duplicateTargetNode = { ...target }
    const missingTarget = n('src/missing-target.ts')
    const repoPath = tempRepo({
      'src/root.ts': 'root',
      'src/target.ts': 'target',
    })
    const graph = createGraphIndex({
      nodes: [root, target, duplicateTargetNode, missingTarget],
      edges: [
        e(root, target, 'calls'),
        e(root, { ...target, id: 'missing-node' }),
        e(root, missingTarget),
        e(root, target),
      ],
    })

    const result = buildAnalyzerContextBundle({ repoPath, graph, rootFilePath: root.filePath, reason: 'import_export' })

    expect(result.bundle.relatedFiles.map((file) => file.filePath)).toEqual(['src/target.ts'])
    expect(result.bundle.relatedNodeIds).toEqual([target.id])
  })

  it('records unresolved import edges as suspected without throwing', () => {
    const root = n('src/root.ts')
    const repoPath = tempRepo({ 'src/root.ts': 'import dynamicThing from config' })
    const graph = createGraphIndex({ nodes: [root], edges: [e(root, null)] })

    const result = buildAnalyzerContextBundle({ repoPath, graph, rootFilePath: root.filePath, reason: 'import_export' })

    expect(result.suspected).toEqual([
      {
        nodeId: root.id,
        adapter: 'context_expansion',
        reason: 'unmatched_routing_file',
        contextHint: 'file',
      },
    ])
    expect(result.diagnostics.suspected).toBe(1)
  })
})
