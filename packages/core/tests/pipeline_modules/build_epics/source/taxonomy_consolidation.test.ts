import { describe, expect, it } from 'vitest'
import {
  normalizeConsolidatedTaxonomySubmission,
  validateConsolidatedTaxonomySubmission,
} from '@/pipeline_modules/build_epics/source/taxonomy_consolidation.js'

describe('taxonomy consolidation', () => {
  it('dedupes domains and epics by stable key while preserving aliases', () => {
    const normalized = normalizeConsolidatedTaxonomySubmission({
      domains: [
        { domainId: 'domain:admin', stableKey: 'admin', name: 'Admin', summary: 'Admin work', epicIds: ['stale-epic'] },
        { domainId: 'domain:admin-duplicate', stableKey: 'admin', name: 'Admin duplicate', summary: 'Duplicate', epicIds: ['other-stale-epic'] },
      ],
      epics: [
        { tempEpicId: 'epic:admin_ops', domainId: 'domain:admin', stableKey: 'admin_ops', name: 'Admin Ops', abbr: 'AO', summary: 'Admin operations' },
        { tempEpicId: 'epic:admin_ops_2', domainId: 'domain:admin', stableKey: 'admin_ops', name: 'Admin Operations', abbr: 'AO2', summary: 'Duplicate admin operations' },
      ],
      aliases: [{ fromStableKey: 'admin_ops_2', toStableKey: 'admin_ops', reason: 'Same business boundary' }],
      boundaryNotes: [{ stableKey: 'admin_ops', includes: ['admin policy'], excludes: ['seller work'] }],
    })

    expect(normalized.domains).toHaveLength(1)
    expect(normalized.epics).toHaveLength(1)
    expect(normalized.domains[0]?.domainId).toBe('domain:admin-duplicate')
    expect(normalized.domains[0]?.epicIds).toEqual(['epic:admin_ops_2'])
    expect(normalized.epics[0]?.domainId).toBe('domain:admin-duplicate')
    expect(normalized.aliases).toEqual([{ fromStableKey: 'admin_ops_2', toStableKey: 'admin_ops', reason: 'Same business boundary' }])
    expect(normalized.boundaryNotes).toEqual([{ stableKey: 'admin_ops', includes: ['admin policy'], excludes: ['seller work'] }])
  })

  it('does not report unknown domain after duplicate domain id remapping', () => {
    const errors = validateConsolidatedTaxonomySubmission({
      domains: [
        { domainId: 'domain:admin', stableKey: 'admin', name: 'Admin', summary: 'Admin work', epicIds: [] },
        { domainId: 'domain:admin-duplicate', stableKey: 'admin', name: 'Admin duplicate', summary: 'Duplicate', epicIds: [] },
      ],
      epics: [
        { tempEpicId: 'epic:admin_ops', domainId: 'domain:admin', stableKey: 'admin_ops', name: 'Admin Ops', abbr: 'AO', summary: 'Admin operations' },
      ],
      aliases: [],
      boundaryNotes: [],
    })

    expect(errors).toEqual([])
  })

  it('rejects unknown alias sources even when the alias target exists', () => {
    const errors = validateConsolidatedTaxonomySubmission({
      domains: [{ domainId: 'domain:admin', stableKey: 'admin', name: 'Admin', summary: 'Admin work', epicIds: [] }],
      epics: [{ tempEpicId: 'epic:admin_ops', domainId: 'domain:admin', stableKey: 'admin_ops', name: 'Admin Ops', abbr: 'AO', summary: 'Admin operations' }],
      aliases: [{ fromStableKey: 'missing', toStableKey: 'admin_ops', reason: 'bad alias' }],
      boundaryNotes: [],
    })

    expect(errors).toEqual([expect.objectContaining({ code: 'UNKNOWN_ALIAS_SOURCE', stableKey: 'missing' })])
  })

  it('rejects aliases that point to unknown consolidated epics', () => {
    const errors = validateConsolidatedTaxonomySubmission({
      domains: [{ domainId: 'domain:admin', stableKey: 'admin', name: 'Admin', summary: 'Admin work', epicIds: [] }],
      epics: [{ tempEpicId: 'epic:admin_ops', domainId: 'domain:admin', stableKey: 'admin_ops', name: 'Admin Ops', abbr: 'AO', summary: 'Admin operations' }],
      aliases: [{ fromStableKey: 'missing', toStableKey: 'unknown', reason: 'bad alias' }],
      boundaryNotes: [],
    })

    expect(errors).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_ALIAS_SOURCE', stableKey: 'missing' }),
      expect.objectContaining({ code: 'UNKNOWN_ALIAS_TARGET', stableKey: 'unknown' }),
    ])
  })
})
