import { eq, getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestPlattyDb } from '@/db/testing.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import { analysisReviewDecisions } from '@/db/schema/project_analysis_v2.js'
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

  it('marks detector version v2 for subtree-aware coverage', () => {
    expect(SHARED_CODE_SEGMENTS_DETECTOR_VERSION).toBe('shared_code_segments_v2')
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

describe('detectSharedCodeSegments subtree coverage', () => {
  const ROUTES = ['ep:a', 'ep:b', 'ep:c'] as const
  const routeEntryPoints = ROUTES.map((id) => ({
    id,
    targetKey: `api:${id}`,
    documentType: 'api_spec' as const,
  }))
  const handlerRows = ROUTES.flatMap((entryPointId, index) => [
    { entryPointId, nodeId: `handler:${index}`, depth: 0 },
  ])
  const handlerNodes = ROUTES.map((_, index) =>
    node(`handler:${index}`, `Handler${index}`, `src/handler-${index}.ts`, 'function'))

  it('covers an entire namespace subtree without the per-segment cap and absorbs member candidates', () => {
    const members = Array.from({ length: 100 }, (_, i) => node(
      `node:ns-member-${String(i).padStart(3, '0')}`,
      `MEMBER_${i}`,
      'src/constants.ts',
      'variable',
      { lineStart: 2 + i * 4, lineEnd: 4 + i * 4, parentNodeId: 'node:ns' },
    ))
    const result = detectSharedCodeSegments({
      entryPoints: [...routeEntryPoints],
      bundles: [
        ...handlerRows,
        ...ROUTES.flatMap((entryPointId) => [
          { entryPointId, nodeId: 'node:ns', depth: 1 },
          ...members.map((member) => ({ entryPointId, nodeId: member.id, depth: 2 })),
        ]),
      ],
      nodes: [
        ...handlerNodes,
        node('node:ns', 'AppConstants', 'src/constants.ts', 'variable', { lineStart: 1, lineEnd: 500 }),
        ...members,
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.rootNodeId).toBe('node:ns')
    expect(result[0]!.coveredNodeIds).toHaveLength(101)
    for (const member of members) {
      expect(result[0]!.coveredNodeIds).toContain(member.id)
    }
  })

  it('treats parent-chain descendants as subtree even when line ranges do not overlap', () => {
    const result = detectSharedCodeSegments({
      maxCoveredNodesPerSegment: 0,
      entryPoints: [...routeEntryPoints],
      bundles: [
        ...handlerRows,
        ...ROUTES.flatMap((entryPointId) => [
          { entryPointId, nodeId: 'node:ns', depth: 1 },
          { entryPointId, nodeId: 'node:ns-group', depth: 2 },
          { entryPointId, nodeId: 'node:ns-leaf', depth: 3 },
        ]),
      ],
      nodes: [
        ...handlerNodes,
        node('node:ns', 'AppConstants', 'src/constants.ts', 'variable', { lineStart: 1, lineEnd: 10 }),
        node('node:ns-group', 'Push', 'src/constants.ts', 'variable', {
          lineStart: 100, lineEnd: 110, parentNodeId: 'node:ns',
        }),
        node('node:ns-leaf', 'DEFAULT', 'src/constants.ts', 'variable', {
          lineStart: 102, lineEnd: 103, parentNodeId: 'node:ns-group',
        }),
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.coveredNodeIds).toEqual(['node:ns', 'node:ns-group', 'node:ns-leaf'])
  })

  it('falls back to same-file line containment when parent links are missing', () => {
    const result = detectSharedCodeSegments({
      maxCoveredNodesPerSegment: 0,
      entryPoints: [...routeEntryPoints],
      bundles: [
        ...handlerRows,
        ...ROUTES.flatMap((entryPointId) => [
          { entryPointId, nodeId: 'node:ns', depth: 1 },
          { entryPointId, nodeId: 'node:ns-inline', depth: 2 },
          { entryPointId, nodeId: 'node:ns-sibling', depth: 2 },
        ]),
      ],
      nodes: [
        ...handlerNodes,
        node('node:ns', 'AppConstants', 'src/constants.ts', 'variable', { lineStart: 1, lineEnd: 100 }),
        node('node:ns-inline', 'INLINE', 'src/constants.ts', 'variable', { lineStart: 10, lineEnd: 20 }),
        node('node:ns-sibling', 'SIBLING', 'src/constants.ts', 'variable', { lineStart: 200, lineEnd: 210 }),
      ],
    })

    expect(result[0]!.rootNodeId).toBe('node:ns')
    expect(result[0]!.coveredNodeIds).toEqual(['node:ns', 'node:ns-inline'])
  })

  it('keeps the cap for cross-file co-travelers', () => {
    const coTravelers = Array.from({ length: 7 }, (_, i) => node(
      `node:ct-${i}`,
      `helper${i}`,
      `src/helpers/helper-${i}.ts`,
      'function',
    ))
    const result = detectSharedCodeSegments({
      maxCoveredNodesPerSegment: 5,
      entryPoints: [...routeEntryPoints],
      bundles: [
        ...handlerRows,
        ...ROUTES.flatMap((entryPointId) => [
          { entryPointId, nodeId: 'node:ns', depth: 1 },
          ...coTravelers.map((helper) => ({ entryPointId, nodeId: helper.id, depth: 2 })),
        ]),
      ],
      nodes: [
        ...handlerNodes,
        node('node:ns', 'AppConstants', 'src/constants.ts', 'variable', { lineStart: 1, lineEnd: 100 }),
        ...coTravelers,
      ],
    })

    expect(result[0]!.rootNodeId).toBe('node:ns')
    expect(result[0]!.coveredNodeIds).toEqual([
      'node:ns',
      'node:ct-0',
      'node:ct-1',
      'node:ct-2',
      'node:ct-3',
      'node:ct-4',
    ])
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

  it('excludes deprecated entry points from usage counting and coverage intersection', async () => {
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
        { id: 'handler:d', name: 'PageD', filePath: 'src/d.tsx', type: 'function' },
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
        { id: 'ep:d', path: '/d', handlerNodeId: 'handler:d' },
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
      // deprecated 라우트: button은 쓰지만 button-style은 안 씀 → 포함되면 교집합이 깨진다.
      client.db.insert(codeBundles).values([
        { entryPointId: 'ep:d', nodeId: 'handler:d', depth: 0, edgePath: [] },
        { entryPointId: 'ep:d', nodeId: 'node:button', depth: 1, edgePath: ['handler:d'] },
      ]).run()
      client.db.insert(analysisReviewDecisions).values({
        id: 'decision:ep-d',
        projectId: 'p1',
        repoId: 'r1',
        targetType: 'route',
        targetId: 'ep:d',
        targetSource: 'entry_point',
        decision: 'deprecated',
        reason: 'user_manual',
      }).run()

      await rebuildSharedCodeSegmentsForProject({ db: client.db, projectId: 'p1' })

      const [segment] = client.db.select().from(sharedCodeSegments).where(eq(sharedCodeSegments.projectId, 'p1')).all()
      expect(segment).toMatchObject({
        rootNodeId: 'node:button',
        usedByEntryPointCount: 3,
      })
      expect(segment!.coveredNodeIdsJson).toEqual(['node:button', 'node:button-style'])
      const linkedEntryPointIds = client.db.select().from(sharedCodeSegmentEntryPoints).all()
        .map((link) => link.entryPointId)
        .sort()
      expect(linkedEntryPointIds).toEqual(['ep:a', 'ep:b', 'ep:c'])
    } finally {
      await client.cleanup()
    }
  })

  it('persists uncapped subtree coverage beyond the insert chunk size', async () => {
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
      const memberIds = Array.from({ length: 250 }, (_, i) => `node:ns-member-${String(i).padStart(3, '0')}`)
      for (const row of [
        { id: 'handler:a', name: 'PageA', filePath: 'src/a.tsx', parentNodeId: null, lineStart: 1, lineEnd: 5 },
        { id: 'handler:b', name: 'PageB', filePath: 'src/b.tsx', parentNodeId: null, lineStart: 1, lineEnd: 5 },
        { id: 'handler:c', name: 'PageC', filePath: 'src/c.tsx', parentNodeId: null, lineStart: 1, lineEnd: 5 },
        { id: 'node:ns', name: 'AppConstants', filePath: 'src/constants.ts', parentNodeId: null, lineStart: 1, lineEnd: 2000 },
        ...memberIds.map((id, i) => ({
          id,
          name: `MEMBER_${i}`,
          filePath: 'src/constants.ts',
          parentNodeId: 'node:ns',
          lineStart: 2 + i * 4,
          lineEnd: 4 + i * 4,
        })),
      ]) {
        client.db.insert(codeNodes).values({
          ...row,
          repoId: 'r1',
          type: 'variable',
          signature: `${row.name}`,
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
          framework: 'express',
          kind: 'api',
          httpMethod: 'GET',
          path: route.path,
          fullPath: route.path,
          handlerNodeId: route.handlerNodeId,
          detectionSource: 'rule:express',
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
          { entryPointId, nodeId: 'node:ns', depth: 1, edgePath: [handlerNodeId] },
        ]).run()
        for (const memberId of memberIds) {
          client.db.insert(codeBundles).values({
            entryPointId,
            nodeId: memberId,
            depth: 2,
            edgePath: [handlerNodeId, 'node:ns'],
          }).run()
        }
      }

      const result = await rebuildSharedCodeSegmentsForProject({ db: client.db, projectId: 'p1' })
      expect(result.segment_count).toBe(1)

      const [segment] = client.db.select().from(sharedCodeSegments).where(eq(sharedCodeSegments.projectId, 'p1')).all()
      expect(segment!.rootNodeId).toBe('node:ns')
      expect(segment!.coveredNodeIdsJson).toHaveLength(251)
      expect(client.db.select().from(sharedCodeSegmentNodes).all()).toHaveLength(251)
    } finally {
      await client.cleanup()
    }
  })

  it('clears segments persisted by older detector versions on rebuild', async () => {
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
      client.db.insert(codeNodes).values({
        id: 'node:old',
        repoId: 'r1',
        name: 'Old',
        filePath: 'src/old.ts',
        type: 'function',
        lineStart: 1,
        lineEnd: 5,
        signature: 'Old()',
        parseStatus: 'ok',
      }).run()
      client.db.insert(sharedCodeSegments).values({
        id: 'shared:stale-v1',
        projectId: 'p1',
        repoId: 'r1',
        rootNodeId: 'node:old',
        rootSymbol: 'Old',
        rootFilePath: 'src/old.ts',
        detectorVersion: 'shared_code_segments_v1',
        summarySchemaVersion: 'shared_code_summary_v1',
        segmentHash: 'hash:stale',
        sourceHash: 'hash:source',
        usedByEntryPointCount: 3,
        coveredNodeIdsJson: ['node:old'],
        deterministicSummaryJson: {
          title: 'Old',
          natural_language_summary: 'stale',
          public_contract: [],
          business_relevance: [],
          source_refs: [],
        },
        llmSummaryJson: null,
        summaryStatus: 'deterministic',
        validity: 'fresh',
        updatedAt: new Date().toISOString(),
      }).run()

      await rebuildSharedCodeSegmentsForProject({ db: client.db, projectId: 'p1' })

      expect(client.db.select().from(sharedCodeSegments).all()).toEqual([])
    } finally {
      await client.cleanup()
    }
  })
})

function node(
  id: string,
  name: string,
  filePath: string,
  type: string,
  extra: { lineStart?: number; lineEnd?: number; parentNodeId?: string | null } = {},
) {
  return {
    id,
    name,
    filePath,
    type,
    lineStart: extra.lineStart ?? 1,
    lineEnd: extra.lineEnd ?? 5,
    signature: `${name}()`,
    ...(extra.parentNodeId !== undefined ? { parentNodeId: extra.parentNodeId } : {}),
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
