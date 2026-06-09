import { describe, expect, it } from 'vitest'

import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type {
  AnalyzerContext,
  BuildRouteAnalyzerAdapter,
  EntryPointDraft,
  SemanticEntryMetadata,
  SuspectedNode,
} from '@/pipeline_modules/build_route/types.js'

describe('build_route analyzer contracts', () => {
  it('accepts semantic entry metadata on an internal page draft', () => {
    const metadata = {
      externalRoute: false,
      semanticEntry: true,
      parentPage: 'HomePage',
      navigationKind: 'bottom_nav',
      index: 0,
      label: 'Feed',
      evidence: ['bottom_nav_like_control', 'single_child_by_index', 'component_array', 'label_list'],
    } satisfies SemanticEntryMetadata

    const draft: EntryPointDraft = {
      framework: 'flutter',
      kind: 'page',
      fullPath: 'internal://home/feed',
      handlerNodeId: 'repo:lib/feed_page.dart:FeedPage',
      metadata,
      detectionSource: 'semantic:flutter',
      confidence: 'high',
      detectionEvidence: {
        matchedRuleId: 'semantic:flutter:bottom_nav',
        matchedNodeIds: ['repo:lib/home_page.dart:HomePage'],
        matchedEdgeIds: [],
      },
    }

    expect(draft.fullPath).toBe('internal://home/feed')
    expect(draft.metadata).toMatchObject({
      externalRoute: false,
      semanticEntry: true,
      navigationKind: 'bottom_nav',
      label: 'Feed',
    })
  })

  it('supports semantic ambiguity as a suspected reason', () => {
    const suspected = {
      nodeId: 'repo:lib/home_page.dart:HomePage',
      adapter: 'flutter_semantic',
      reason: 'semantic_navigation_ambiguous',
      contextHint: 'file',
    } satisfies SuspectedNode

    expect(suspected.reason).toBe('semantic_navigation_ambiguous')
  })

  it('defines analyzer adapters with bounded candidate files', () => {
    const analyzer: BuildRouteAnalyzerAdapter = {
      name: 'test_semantic',
      kind: 'semantic_page',
      framework: 'react',
      appliesTo: (ctx) => ctx.stackInfo.framework === 'react',
      candidateFiles: () => ['src/App.tsx'],
      analyzeFile: (file) => ({
        entryPoints: [],
        suspected: [{ nodeId: file.fileNodeId, adapter: 'test_semantic', reason: 'semantic_navigation_ambiguous' }],
        diagnostics: { analyzedFiles: 1 },
      }),
    }

    const ctx: AnalyzerContext = {
      repoPath: '/repo',
      repoId: 'repo',
      stackInfo: { framework: 'react', routingLibs: [], entrypointFiles: ['src/App.tsx'] },
      detections: [],
      graphNodes: [],
      graph: createGraphIndex({ nodes: [], edges: [] }),
    }

    expect(analyzer.appliesTo(ctx)).toBe(true)
    expect(analyzer.candidateFiles(ctx)).toEqual(['src/App.tsx'])
    expect(analyzer.analyzeFile({ filePath: 'src/App.tsx', source: '', fileNodeId: 'file' }, ctx)).toMatchObject({
      diagnostics: { analyzedFiles: 1 },
      suspected: [{ reason: 'semantic_navigation_ambiguous' }],
    })
  })
})
