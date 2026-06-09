export type GatedStageStatus = 'passed' | 'failed' | 'skipped'
export type GatedStageId = 'build_service_map' | 'build_epics' | 'build_business_docs' | string

export function skippedReasonForStage(
  stageId: GatedStageId,
  status: { buildDocsStatus?: GatedStageStatus; buildEpicsStatus?: GatedStageStatus },
): 'skipped_due_to_failed_build_docs' | 'skipped_due_to_failed_build_epics' | null {
  if ((stageId === 'build_epics' || stageId === 'build_business_docs') && status.buildDocsStatus === 'failed') {
    return 'skipped_due_to_failed_build_docs'
  }
  if (stageId === 'build_business_docs' && (status.buildEpicsStatus === 'failed' || status.buildEpicsStatus === 'skipped')) {
    return 'skipped_due_to_failed_build_epics'
  }
  return null
}

