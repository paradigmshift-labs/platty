import { describe, expect, it } from 'vitest'

import { skippedReasonForStage } from '@/pipeline_infra/index.js'

describe('pipeline stage gate', () => {
  it('skips epics and business docs when build_docs failed', () => {
    expect(skippedReasonForStage('build_epics', { buildDocsStatus: 'failed' })).toBe('skipped_due_to_failed_build_docs')
    expect(skippedReasonForStage('build_business_docs', { buildDocsStatus: 'failed' })).toBe('skipped_due_to_failed_build_docs')
    expect(skippedReasonForStage('build_service_map', { buildDocsStatus: 'failed' })).toBeNull()
  })

  it('skips business docs when build_epics failed or skipped', () => {
    expect(skippedReasonForStage('build_business_docs', { buildDocsStatus: 'passed', buildEpicsStatus: 'failed' })).toBe('skipped_due_to_failed_build_epics')
    expect(skippedReasonForStage('build_business_docs', { buildDocsStatus: 'passed', buildEpicsStatus: 'skipped' })).toBe('skipped_due_to_failed_build_epics')
    expect(skippedReasonForStage('build_business_docs', { buildDocsStatus: 'passed', buildEpicsStatus: 'passed' })).toBeNull()
  })
})
