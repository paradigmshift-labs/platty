import { eq, getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '@/db/testing.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import {
  sharedCodeSegmentEntryPoints,
  sharedCodeSegmentNodes,
  sharedCodeSegments,
} from '@/db/schema/shared_code_segments.js'
import {
  compactSourceContextWithSharedSegments,
  detectSharedCodeSegments,
  loadSharedCodeSegmentsForEntryPoints,
  rebuildSharedCodeSegmentsForProject,
  SHARED_CODE_SEGMENTS_DETECTOR_VERSION,
} from '@/pipeline_modules/build_docs/source/shared_segments.js'

describe('shared code segment schema', () => {
  it('exports the persisted shared segment tables', () => {
    expect(getTableName(sharedCodeSegments)).toBe('shared_code_segments')
    expect(getTableName(sharedCodeSegmentEntryPoints)).toBe('shared_code_segment_entrypoints')
    expect(getTableName(sharedCodeSegmentNodes)).toBe('shared_code_segment_nodes')
  })
})

describe('detectSharedCodeSegments', () => {
  it('selects a common non-entrypoint node used by three routes', () => {
    const result = detectSharedCodeSegments({
      minUsageThreshold: 3,
      entryPoints: [
        { id: 'ep:a', targetKey: 'screen:/a', documentType: 'screen_spec' },
        { id: 'ep:b', targetKey: 'screen:/b', documentType: 'screen_spec' },
        { id: 'ep:c', targetKey: 'screen:/c', documentType: 'screen_spec' },
      ],
      bundles: [
        { entryPointId: 'ep:a', nodeId: 'handler:a', depth: 0 },
        { entryPointId: 'ep:b', nodeId: 'handler:b', depth: 0 },
        { entryPointId: 'ep:c', nodeId: 'handler:c', depth: 0 },
        { entryPointId: 'ep:a', nodeId: 'node:button', depth: 2 },
        { entryPointId: 'ep:b', nodeId: 'node:button', depth: 2 },
        { entryPointId: 'ep:c', nodeId: 'node:button', depth: 2 },
        { entryPointId: 'ep:a', nodeId: 'node:button-style', depth: 3 },
        { entryPointId: 'ep:b', nodeId: 'node:button-style', depth: 3 },
        { entryPointId: 'ep:c', nodeId: 'node:button-style', depth: 3 },
      ],
      nodes: [
        node('handler:a', 'PageA', 'src/a.tsx', 'function'),
        node('handler:b', 'PageB', 'src/b.tsx', 'function'),
        node('handler:c', 'PageC', 'src/c.tsx', 'function'),
        node('node:button', 'Button', 'src/ui/Button.tsx', 'component'),
        node('node:button-style', 'buttonClassName', 'src/ui/Button.tsx', 'constant'),
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      detectorVersion: SHARED_CODE_SEGMENTS_DETECTOR_VERSION,
      rootNodeId: 'node:button',
      rootSymbol: 'Button',
      rootFilePath: 'src/ui/Button.tsx',
      usedByEntryPointCount: 3,
      coveredNodeIds: ['node:button', 'node:button-style'],
    })
    expect(result[0].usedByEntryPoints.map((item) => item.entryPointId)).toEqual(['ep:a', 'ep:b', 'ep:c'])
  })

  it('does not classify two-route overlap as shared by default', () => {
    const result = detectSharedCodeSegments({
      entryPoints: [
        { id: 'ep:a', targetKey: 'screen:/a', documentType: 'screen_spec' },
        { id: 'ep:b', targetKey: 'screen:/b', documentType: 'screen_spec' },
      ],
      bundles: [
        { entryPointId: 'ep:a', nodeId: 'node:format', depth: 1 },
        { entryPointId: 'ep:b', nodeId: 'node:format', depth: 1 },
      ],
      nodes: [node('node:format', 'formatDate', 'src/lib/date.ts', 'function')],
    })

    expect(result).toEqual([])
  })
})

describe('compactSourceContextWithSharedSegments', () => {
  it('omits covered low-priority shared nodes and preserves protected evidence', () => {
    const result = compactSourceContextWithSharedSegments({
      sourceContext: [
        source('e:handler', 'handler:a', 0, 'PageA', 'src/a.tsx', 'function'),
        source('e:button', 'node:button', 2, 'Button', 'src/ui/Button.tsx', 'component'),
        source('e:model', 'node:user-dto', 3, 'UserDto', 'src/api/UserDto.ts', 'class'),
      ],
      sharedSegments: [{
        segment_id: 'shared:button',
        root_node_id: 'node:button',
        root_symbol: 'Button',
        root_file_path: 'src/ui/Button.tsx',
        detector_version: SHARED_CODE_SEGMENTS_DETECTOR_VERSION,
        summary_schema_version: 'shared_code_summary_v1',
        used_by_entrypoint_count: 3,
        used_by_entrypoints: [],
        covered_node_ids: ['node:button', 'node:user-dto'],
        summary: {
          title: 'Button',
          natural_language_summary: 'Shared UI button.',
          public_contract: [],
          business_relevance: [],
          source_refs: [],
        },
      }],
      protectedNodeIds: new Set(['node:user-dto']),
    })

    expect(result.sourceContext.map((item) => item.node_id)).toEqual(['handler:a', 'node:user-dto'])
    expect(result.metadata.omitted_node_count).toBe(1)
    expect(result.metadata.segment_ids).toEqual(['shared:button'])
  })

  it('preserves protected evidence when ownership compaction is present', () => {
    const result = compactSourceContextWithSharedSegments({
      sourceContext: [
        source('e:handler', 'handler:a', 0, 'PageA', 'src/a.tsx', 'function'),
        source('e:button', 'node:button', 2, 'Button', 'src/ui/Button.tsx', 'component'),
        source('e:policy', 'node:shared-policy', 3, 'SharedPolicy', 'src/ui/policy.ts', 'function'),
      ],
      sharedSegments: [{
        segment_id: 'shared:button',
        root_node_id: 'node:button',
        root_symbol: 'Button',
        root_file_path: 'src/ui/Button.tsx',
        detector_version: SHARED_CODE_SEGMENTS_DETECTOR_VERSION,
        summary_schema_version: 'shared_code_summary_v1',
        used_by_entrypoint_count: 3,
        used_by_entrypoints: [],
        covered_node_ids: ['node:button', 'node:shared-policy'],
        summary: {
          title: 'Button',
          natural_language_summary: 'Shared UI button.',
          public_contract: [],
          business_relevance: [],
          source_refs: [],
        },
      }],
      protectedNodeIds: new Set(['node:shared-policy']),
      sharedOwnershipIndex: { targetRetainedNodeIds: new Set() },
    })

    expect(result.sourceContext.map((item) => item.node_id)).toEqual(['handler:a', 'node:shared-policy'])
    expect(result.metadata.omitted_node_count).toBe(1)
  })
})

describe('shared segment persistence API', () => {
  it('exports rebuild and context loader functions', async () => {
    const module = await import('@/pipeline_modules/build_docs/source/shared_segments.js')
    expect(typeof module.rebuildSharedCodeSegmentsForProject).toBe('function')
    expect(typeof module.loadSharedCodeSegmentsForEntryPoints).toBe('function')
  })

  it('rebuilds shared segments from route bundles and loads shared context for entry points', async () => {
    const client = createTestPlattyDb()
    try {
      client.db.insert(projects).values({ id: 'p1', name: 'Project' }).run()
      client.db.insert(repositories).values({
        id: 'r1',
        projectId: 'p1',
        name: 'Repo',
        repoPath: '/repo',
        analysisBranch: 'main',
        analysisWorktreePath: '/analysis/repo',
      }).run()
      for (const row of [
        { id: 'handler:a', name: 'PageA', filePath: 'src/a.tsx', type: 'function' },
        { id: 'handler:b', name: 'PageB', filePath: 'src/b.tsx', type: 'function' },
        { id: 'handler:c', name: 'PageC', filePath: 'src/c.tsx', type: 'function' },
        { id: 'node:button', name: 'Button', filePath: 'src/ui/Button.tsx', type: 'component' },
        { id: 'node:button-style', name: 'buttonClassName', filePath: 'src/ui/Button.tsx', type: 'constant' },
      ]) {
        client.db.insert(codeNodes).values({
          ...row,
          repoId: 'r1',
          lineStart: 1,
          lineEnd: 5,
          signature: `${row.name}()`,
          parseStatus: 'ok',
        }).run()
      }
      for (const route of [
        { id: 'ep:a', path: '/a', handlerNodeId: 'handler:a' },
        { id: 'ep:b', path: '/b', handlerNodeId: 'handler:b' },
        { id: 'ep:c', path: '/c', handlerNodeId: 'handler:c' },
      ]) {
        client.db.insert(entryPoints).values({
          id: route.id,
          repoId: 'r1',
          framework: 'react',
          kind: 'page',
          httpMethod: null,
          path: route.path,
          fullPath: route.path,
          handlerNodeId: route.handlerNodeId,
          detectionSource: 'rule:react',
          confidence: 'high',
        }).run()
      }
      for (const [entryPointId, handlerNodeId] of [
        ['ep:a', 'handler:a'],
        ['ep:b', 'handler:b'],
        ['ep:c', 'handler:c'],
      ] as const) {
        client.db.insert(codeBundles).values([
          { entryPointId, nodeId: handlerNodeId, depth: 0, edgePath: [] },
          { entryPointId, nodeId: 'node:button', depth: 1, edgePath: [handlerNodeId] },
          { entryPointId, nodeId: 'node:button-style', depth: 2, edgePath: [handlerNodeId, 'node:button'] },
        ]).run()
      }

      await expect(rebuildSharedCodeSegmentsForProject({
        db: client.db,
        projectId: 'p1',
      })).resolves.toMatchObject({
        project_id: 'p1',
        rebuilt_repo_count: 1,
        segment_count: 1,
        detector_version: SHARED_CODE_SEGMENTS_DETECTOR_VERSION,
      })

      const [segment] = client.db.select().from(sharedCodeSegments).where(eq(sharedCodeSegments.projectId, 'p1')).all()
      expect(segment).toMatchObject({
        rootNodeId: 'node:button',
        rootSymbol: 'Button',
        usedByEntryPointCount: 3,
        summaryStatus: 'deterministic',
        validity: 'fresh',
      })
      expect(client.db.select().from(sharedCodeSegmentEntryPoints).all()).toHaveLength(3)
      expect(client.db.select().from(sharedCodeSegmentNodes).all()).toHaveLength(2)

      expect(loadSharedCodeSegmentsForEntryPoints({
        db: client.db,
        projectId: 'p1',
        entryPointIds: ['ep:a'],
      })).toEqual([
        expect.objectContaining({
          segment_id: segment!.id,
          root_node_id: 'node:button',
          covered_node_ids: ['node:button', 'node:button-style'],
          summary: expect.objectContaining({ title: 'Button' }),
        }),
      ])
    } finally {
      await client.cleanup()
    }
  })
})

function node(id: string, name: string, filePath: string, type: string) {
  return {
    id,
    name,
    filePath,
    type,
    lineStart: 1,
    lineEnd: 5,
    signature: `${name}()`,
  }
}

function source(evidenceId: string, nodeId: string, hop: number, symbol: string, filePath: string, nodeType: string) {
  return {
    evidence_id: evidenceId,
    node_id: nodeId,
    node_type: nodeType,
    dep_type: hop === 0 ? 'entrypoint' as const : 'dependency' as const,
    hop,
    file_path: filePath,
    symbol,
    line_start: 1,
    line_end: 5,
    signature: `${symbol}()`,
    source_missing: false,
    source_excerpt: `export const ${symbol} = true`,
  }
}
