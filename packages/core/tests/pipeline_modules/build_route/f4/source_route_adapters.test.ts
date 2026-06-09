import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import { createSourceRouteContext, runSourceRouteAdapters } from '@/pipeline_modules/build_route/f4/source_route_adapters.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type { EntryPointDraft, SourceRouteAdapter } from '@/pipeline_modules/build_route/types.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-route-source-adapters-'))
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

function entry(adapterId: string): EntryPointDraft {
  return {
    framework: adapterId,
    kind: 'api',
    httpMethod: 'GET',
    path: '/health',
    fullPath: '/health',
    handlerNodeId: `${REPO}:src/app.ts`,
    metadata: { adapterId },
    detectionSource: `source:${adapterId}`,
    confidence: 'high',
    detectionEvidence: {
      matchedRuleId: adapterId,
      matchedNodeIds: [`${REPO}:src/app.ts`],
      matchedEdgeIds: [],
    },
  }
}

describe('source route adapters', () => {
  it('gives adapters controlled source access instead of direct filesystem ownership', () => {
    const repoPath = tempRepo({ 'src/app.ts': 'app.get("/health", handler)' })
    const nodes = [fileNode('src/app.ts')]
    const graph = createGraphIndex({ nodes, edges: [] })
    const ctx = createSourceRouteContext({
      repoPath,
      repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [],
      graph,
      graphNodes: nodes,
      graphEdges: [],
    })

    expect(ctx.sourceFiles.map((file) => file.filePath)).toEqual(['src/app.ts'])
    expect(ctx.readSource('src/app.ts')).toBe('app.get("/health", handler)')
    expect(ctx.readSource('missing.ts')).toBeNull()
  })

  it('uses empty source for graph file nodes missing on disk', () => {
    const nodes = [fileNode('src/missing.ts')]
    const graph = createGraphIndex({ nodes, edges: [] })
    const ctx = createSourceRouteContext({
      repoPath: tempRepo({}),
      repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [],
      graph,
      graphNodes: nodes,
      graphEdges: [],
    })

    expect(ctx.sourceFiles).toEqual([{ filePath: 'src/missing.ts', fileNodeId: `${REPO}:src/missing.ts`, source: '' }])
    expect(ctx.readSource('src/missing.ts')).toBe('')
  })

  it('runs only adapters with source evidence and concatenates their entries', () => {
    const nodes = [fileNode('src/app.ts')]
    const edges: CodeEdge[] = []
    const graph = createGraphIndex({ nodes, edges })
    const ctx = createSourceRouteContext({
      repoPath: tempRepo({ 'src/app.ts': 'app.get("/health", handler)' }),
      repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [],
      graph,
      graphNodes: nodes,
      graphEdges: edges,
    })

    const active: SourceRouteAdapter = {
      id: 'express',
      family: 'express',
      capability: 'rest',
      additive: true,
      detect: (input) => ({
        adapterId: 'express',
        active: input.readSource('src/app.ts')?.includes('app.get') ?? false,
        confidence: 'high',
        evidence: ['src/app.ts:app.get'],
      }),
      extract: () => [entry('express')],
    }
    const inactive: SourceRouteAdapter = {
      id: 'flutter_getx',
      family: 'flutter',
      capability: 'getx',
      additive: true,
      detect: () => ({
        adapterId: 'flutter_getx',
        active: false,
        confidence: 'low',
        evidence: [],
        reason: 'no GetPage source evidence',
      }),
      extract: () => [entry('flutter_getx')],
    }

    const result = runSourceRouteAdapters(ctx, [active, inactive])

    expect(result.entryPoints.map((item) => item.framework)).toEqual(['express'])
    expect(result.detections).toEqual([
      expect.objectContaining({ adapterId: 'express', active: true }),
      expect.objectContaining({ adapterId: 'flutter_getx', active: false, reason: 'no GetPage source evidence' }),
    ])
    expect(result.diagnostics).toMatchObject({
      adaptersTotal: 2,
      adaptersActive: 1,
      entries: 1,
    })
  })
})
