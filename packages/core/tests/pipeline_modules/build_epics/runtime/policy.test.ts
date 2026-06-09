import { describe, expect, it } from 'vitest'
import { resolveBuildEpicsRuntimePolicy } from '@/pipeline_modules/build_epics/runtime/policy.js'

describe('build_epics CLI runtime policy', () => {
  it('resolves bounded assignment chunks for large projects', () => {
    const policy = resolveBuildEpicsRuntimePolicy({ outputLanguage: 'en' }, { totalAssignableDocs: 2000, totalDocumentCards: 2000 })

    expect(policy.outputLanguage).toBe('en')
    expect(policy.resolvedAssignmentChunkSize).toBe(80)
    expect(policy.maxCrossLinksPerDocument).toBe(8)
    expect(policy.resolvedAssignmentTaskCount).toBe(25)
    expect(policy.resolvedTaxonomyTaskCount).toBe(34)
    expect(policy.resolvedTaxonomyConsolidationTaskCount).toBe(1)
  })

  it('does not create a taxonomy consolidation task estimate when there are no document cards', () => {
    const policy = resolveBuildEpicsRuntimePolicy({}, { totalAssignableDocs: 0, totalDocumentCards: 0 })

    expect(policy.resolvedTaxonomyTaskCount).toBe(0)
    expect(policy.resolvedTaxonomyConsolidationTaskCount).toBe(0)
    expect(policy.resolvedAssignmentTaskCount).toBe(0)
  })

  it('estimates cross-domain tasks from document card count', () => {
    const policy = resolveBuildEpicsRuntimePolicy(
      { maxWorkerCount: 20, taskMultiplier: 1, taxonomyChunkSize: 240, crossDomainChunkSize: 120 },
      { totalAssignableDocs: 1533, totalDocumentCards: 1533 },
    )

    expect(policy.resolvedTaxonomyTaskCount).toBe(7)
    expect(policy.resolvedAssignmentTaskCount).toBe(20)
    expect(policy.crossDomainChunkSize).toBe(120)
    expect(policy.resolvedCrossDomainTaskCount).toBe(13)
  })

  it('normalizes the cross-domain link cap from runtime policy', () => {
    const policy = resolveBuildEpicsRuntimePolicy(
      { maxCrossLinksPerDocument: 12.9 },
      { totalAssignableDocs: 10, totalDocumentCards: 10 },
    )

    expect(policy.maxCrossLinksPerDocument).toBe(12)
  })
})
