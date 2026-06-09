import { describe, expect, it } from 'vitest'

import { buildDeterministicFactIndex } from '@/pipeline_modules/build_service_map/f3_build_deterministic_fact_index.js'
import { resolveUnresolvedTargets } from '@/pipeline_modules/build_service_map/f4_resolve_unresolved_targets.js'
import { validateServiceMap } from '@/pipeline_modules/build_service_map/f9_validate_service_map.js'
import type { DeterministicFactIndex, DocumentFactIndex, ServiceMapInputIndex } from '@/pipeline_modules/build_service_map/types.js'

describe('build_service_map orphan relation visibility', () => {
  it('keeps orphan deterministic facts unresolved instead of dropping them', () => {
    const deterministic: DeterministicFactIndex = {
      anchoredFacts: [],
      scheduleMarkers: [],
      orphanFacts: [
        {
          factId: 'fact-orphan',
          kind: 'api_call',
          relationId: 'rel-orphan',
          reason: 'source_node_not_in_any_bundle',
        },
      ],
    }
    const documents: DocumentFactIndex = {
      anchoredFacts: [],
      mergeEvidenceFacts: [],
      unresolvedFacts: [],
      warnings: [],
    }
    const serviceMapInput = minimalServiceMapInput()

    const resolvedFacts = resolveUnresolvedTargets({ deterministic, documents, serviceMapInput })
    const validation = validateServiceMap({
      serviceMapInput,
      resolvedFacts,
      persistedEdges: [],
      skippedLowConfidence: 0,
      failOnValidationWarning: false,
    })

    expect(resolvedFacts.unresolvedFacts).toEqual([
      expect.objectContaining({
        factId: 'fact-orphan',
        relationId: 'rel-orphan',
        reason: 'source_node_not_in_any_bundle',
      }),
    ])
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RELATION_NOT_ANCHORED_TO_ENTRYPOINT',
        relationId: 'rel-orphan',
      }),
    ]))
  })

  it('carries deterministic anchor debug evidence into orphan warnings', () => {
    const deterministic: DeterministicFactIndex = {
      anchoredFacts: [],
      scheduleMarkers: [],
      orphanFacts: [
        {
          factId: 'fact-orphan',
          kind: 'api_call',
          relationId: 'rel-orphan',
          reason: 'source_node_not_in_any_bundle',
          metadata: {
            sourceNodeOriginKind: 'callback',
            sourceNodeRole: 'queryFn',
            parentNodeId: 'node-use-profile',
            anchorFailureReason: 'parent_node_not_reachable',
          },
        },
      ],
    }
    const documents: DocumentFactIndex = {
      anchoredFacts: [],
      mergeEvidenceFacts: [],
      unresolvedFacts: [],
      warnings: [],
    }

    const resolvedFacts = resolveUnresolvedTargets({ deterministic, documents, serviceMapInput: minimalServiceMapInput() })
    const validation = validateServiceMap({
      serviceMapInput: minimalServiceMapInput(),
      resolvedFacts,
      persistedEdges: [],
      skippedLowConfidence: 0,
      failOnValidationWarning: false,
    })

    expect(resolvedFacts.unresolvedFacts).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          anchorFailureReason: 'parent_node_not_reachable',
        }),
      }),
    ])
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RELATION_NOT_ANCHORED_TO_ENTRYPOINT',
        relationId: 'rel-orphan',
        metadata: expect.objectContaining({
          sourceNodeOriginKind: 'callback',
          sourceNodeRole: 'queryFn',
          parentNodeId: 'node-use-profile',
          anchorFailureReason: 'parent_node_not_reachable',
        }),
      }),
    ]))
  })

  it('marks non-product database orphan warnings as deterministic debug evidence', () => {
    const deterministic: DeterministicFactIndex = {
      anchoredFacts: [],
      scheduleMarkers: [],
      orphanFacts: [
        {
          factId: 'fact-db-cleanup',
          kind: 'db_access',
          relationId: 'rel-db-cleanup',
          reason: 'source_node_not_in_any_bundle',
          metadata: {
            anchorFailureReason: 'source_node_not_reachable',
          },
        },
      ],
    }
    const documents: DocumentFactIndex = {
      anchoredFacts: [],
      mergeEvidenceFacts: [],
      unresolvedFacts: [],
      warnings: [],
    }
    const serviceMapInput = minimalServiceMapInput()
    serviceMapInput.graphNodes = [
      { id: 'node-clean-db', type: 'function', filePath: 'src/SGlobal.ts', name: 'cleanDatabase', lineStart: 1, lineEnd: 5, parentNodeId: null, originKind: null, role: null },
    ]
    serviceMapInput.codeRelations = [
      {
        id: 'rel-db-cleanup',
        repoId: 'repo-1',
        sourceNodeId: 'node-clean-db',
        kind: 'db_access',
        target: 'orders',
        operation: 'delete',
        canonicalTarget: 'db:orders:delete',
        payload: {},
        evidenceNodeIds: ['node-clean-db'],
        confidence: 'high',
        unresolvedReason: null,
      },
    ]

    const resolvedFacts = resolveUnresolvedTargets({ deterministic, documents, serviceMapInput })
    const validation = validateServiceMap({
      serviceMapInput,
      resolvedFacts,
      persistedEdges: [],
      skippedLowConfidence: 0,
      failOnValidationWarning: false,
    })

    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RELATION_NOT_ANCHORED_TO_ENTRYPOINT',
        relationId: 'rel-db-cleanup',
        category: 'non_product_db_fact',
        severity: 'info',
        metadata: expect.objectContaining({
          anchorFailureReason: 'non_product_db_fact',
        }),
      }),
    ]))
  })

  it('preserves static target debug evidence when a reachable deterministic fact stays unresolved', () => {
    const serviceMapInput = minimalServiceMapInput()
    serviceMapInput.entryPoints = [
      {
        id: 'ep-profile',
        repoId: 'repo-1',
        framework: 'nextjs',
        kind: 'page',
        httpMethod: null,
        path: '/profile',
        fullPath: '/profile',
        handlerNodeId: 'node-profile-page',
        metadata: null,
        confidence: 'high',
        filePath: 'app/profile/page.tsx',
        name: 'ProfilePage',
      },
    ]
    serviceMapInput.codeBundles = [
      { entryPointId: 'ep-profile', nodeId: 'node-profile-page', depth: 0 },
    ]
    serviceMapInput.graphNodes = [
      { id: 'node-profile-page', type: 'function', filePath: 'app/profile/page.tsx', name: 'ProfilePage', lineStart: 1, lineEnd: 80, parentNodeId: null, originKind: 'function', role: null },
      { id: 'node-query-fn', type: 'function', filePath: 'app/profile/page.tsx', name: 'ProfilePage.$queryFn_12_14', lineStart: 12, lineEnd: 14, parentNodeId: 'node-profile-page', originKind: 'callback', role: 'queryFn' },
    ]
    serviceMapInput.graphEdges = [
      { sourceId: 'node-profile-page', targetId: 'node-query-fn', relation: 'contains', targetSymbol: 'queryFn', targetSpecifier: null, chainPath: null },
    ]
    serviceMapInput.codeRelations = [
      {
        id: 'rel-unresolved-profile-api',
        repoId: 'repo-1',
        sourceNodeId: 'node-query-fn',
        kind: 'api_call',
        target: '/api/me',
        operation: 'GET',
        canonicalTarget: null,
        payload: {},
        evidenceNodeIds: ['node-query-fn'],
        confidence: 'high',
        unresolvedReason: 'call_target_unresolved',
      },
    ]

    const deterministic = buildDeterministicFactIndex(serviceMapInput)
    const documents: DocumentFactIndex = {
      anchoredFacts: [],
      mergeEvidenceFacts: [],
      unresolvedFacts: [],
      warnings: [],
    }
    const resolvedFacts = resolveUnresolvedTargets({ deterministic, documents, serviceMapInput })
    const validation = validateServiceMap({
      serviceMapInput,
      resolvedFacts,
      persistedEdges: [],
      skippedLowConfidence: 0,
      failOnValidationWarning: false,
    })

    expect(deterministic.anchoredFacts).toEqual([
      expect.objectContaining({
        relationId: 'rel-unresolved-profile-api',
        metadata: expect.objectContaining({
          sourceNodeOriginKind: 'callback',
          sourceNodeRole: 'queryFn',
          parentNodeId: 'node-profile-page',
          anchorFailureReason: 'call_target_unresolved',
        }),
      }),
    ])
    expect(resolvedFacts.unresolvedFacts).toEqual([
      expect.objectContaining({
        relationId: 'rel-unresolved-profile-api',
        reason: 'no_canonical_target_and_no_fallback',
        metadata: expect.objectContaining({
          anchorFailureReason: 'call_target_unresolved',
        }),
      }),
    ])
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'RELATION_STATIC_TARGET_UNRESOLVED',
        relationId: 'rel-unresolved-profile-api',
        category: 'product_gap',
        severity: 'warning',
        metadata: expect.objectContaining({
          anchorFailureReason: 'call_target_unresolved',
        }),
      }),
    ]))
  })
})

function minimalServiceMapInput(): ServiceMapInputIndex {
  return {
    repoId: null,
    projectId: 'project-1',
    repoIds: ['repo-1'],
    entryPoints: [],
    codeBundles: [],
    graphNodes: [],
    graphEdges: [],
    codeRelations: [],
    documents: [],
    docDeps: [],
  }
}
