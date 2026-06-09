import { describe, expect, it } from 'vitest'

import { resolveUnresolvedTargets } from '@/pipeline_modules/build_service_map/f4_resolve_unresolved_targets.js'
import { validateServiceMap } from '@/pipeline_modules/build_service_map/f9_validate_service_map.js'
import type {
  DeterministicFactIndex,
  DocumentFactIndex,
  ServiceMapInputIndex,
} from '@/pipeline_modules/build_service_map/types.js'

describe('non-product DB fact validation policy', () => {
  it('classifies SGlobal cleanDatabase orphan DB facts separately from product gaps', () => {
    const serviceMapInput = minimalServiceMapInput({
      graphNodes: [
        {
          id: 'repo:src/SGlobal.ts:SGlobal.cleanDatabase',
          type: 'method',
          filePath: 'src/SGlobal.ts',
          name: 'SGlobal.cleanDatabase',
          lineStart: 100,
          lineEnd: 540,
        },
      ],
      codeRelations: [
        {
          id: 'rel-clean',
          repoId: 'repo',
          sourceNodeId: 'repo:src/SGlobal.ts:SGlobal.cleanDatabase',
          kind: 'db_access',
          target: 'user',
          operation: 'delete',
          canonicalTarget: 'db:user:delete',
          payload: { orm: 'prisma', method: 'deleteMany' },
          evidenceNodeIds: ['edge:1'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const validation = runValidation(serviceMapInput, {
      factId: 'fact-clean',
      kind: 'db_access',
      relationId: 'rel-clean',
      reason: 'source_node_not_in_any_bundle',
    })

    expect(validation.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RELATION_NOT_ANCHORED_TO_ENTRYPOINT',
          relationId: 'rel-clean',
          category: 'non_product_db_fact',
        }),
      ]),
    )
  })

  it('keeps normal app orphan DB facts as product gaps', () => {
    const serviceMapInput = minimalServiceMapInput({
      graphNodes: [
        {
          id: 'repo:src/feed.usecase.ts:FeedUsecase.execute',
          type: 'method',
          filePath: 'src/feed.usecase.ts',
          name: 'FeedUsecase.execute',
          lineStart: 10,
          lineEnd: 30,
        },
      ],
      codeRelations: [
        {
          id: 'rel-feed',
          repoId: 'repo',
          sourceNodeId: 'repo:src/feed.usecase.ts:FeedUsecase.execute',
          kind: 'db_access',
          target: 'feed',
          operation: 'select',
          canonicalTarget: 'db:feed:select',
          payload: { orm: 'prisma', method: 'findMany' },
          evidenceNodeIds: ['edge:2'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const validation = runValidation(serviceMapInput, {
      factId: 'fact-feed',
      kind: 'db_access',
      relationId: 'rel-feed',
      reason: 'source_node_not_in_any_bundle',
    })

    expect(validation.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RELATION_NOT_ANCHORED_TO_ENTRYPOINT',
          relationId: 'rel-feed',
          category: 'product_gap',
        }),
      ]),
    )
  })

  it('keeps app cleanup deleteMany orphan DB facts as product gaps', () => {
    const serviceMapInput = minimalServiceMapInput({
      graphNodes: [
        {
          id: 'repo:src/admin/user-cleanup.usecase.ts:UserCleanup.execute',
          type: 'method',
          filePath: 'src/admin/user-cleanup.usecase.ts',
          name: 'UserCleanup.execute',
          lineStart: 10,
          lineEnd: 30,
        },
      ],
      codeRelations: [
        {
          id: 'rel-cleanup',
          repoId: 'repo',
          sourceNodeId: 'repo:src/admin/user-cleanup.usecase.ts:UserCleanup.execute',
          kind: 'db_access',
          target: 'user',
          operation: 'delete',
          canonicalTarget: 'db:user:delete',
          payload: { orm: 'prisma', method: 'deleteMany' },
          evidenceNodeIds: ['edge:3'],
          confidence: 'high',
          unresolvedReason: null,
        },
      ],
    })

    const validation = runValidation(serviceMapInput, {
      factId: 'fact-cleanup',
      kind: 'db_access',
      relationId: 'rel-cleanup',
      reason: 'source_node_not_in_any_bundle',
    })

    expect(validation.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'RELATION_NOT_ANCHORED_TO_ENTRYPOINT',
          relationId: 'rel-cleanup',
          category: 'product_gap',
          severity: 'warning',
        }),
      ]),
    )
  })
})

function runValidation(
  serviceMapInput: ServiceMapInputIndex,
  orphanFact: DeterministicFactIndex['orphanFacts'][number],
) {
  const deterministic: DeterministicFactIndex = {
    anchoredFacts: [],
    scheduleMarkers: [],
    orphanFacts: [orphanFact],
  }
  const documents: DocumentFactIndex = {
    anchoredFacts: [],
    mergeEvidenceFacts: [],
    unresolvedFacts: [],
    warnings: [],
  }
  const resolvedFacts = resolveUnresolvedTargets({ deterministic, documents, serviceMapInput })
  return validateServiceMap({
    serviceMapInput,
    resolvedFacts,
    persistedEdges: [],
    skippedLowConfidence: 0,
    failOnValidationWarning: false,
  })
}

function minimalServiceMapInput(overrides: Partial<ServiceMapInputIndex> = {}): ServiceMapInputIndex {
  return {
    repoId: null,
    projectId: 'project-1',
    repoIds: ['repo'],
    apiTargetRepoHints: [],
    entryPoints: [],
    codeBundles: [],
    graphNodes: [],
    graphEdges: [],
    codeRelations: [],
    documents: [],
    docDeps: [],
    ...overrides,
  }
}
