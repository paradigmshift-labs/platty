import {
  emptyReviewBuckets,
  projectEditableDraftToReviewablePlan,
  type EditableEpicDraftPlan,
  type EpicDraftCommand,
} from '@/pipeline_modules/build_epics/core/editable_draft.js'
import type { ConfirmedEpicPlan, ReviewableEpicPlan } from '@/pipeline_modules/build_epics/core/types.js'

export type PersistedEditablePlan = ReviewableEpicPlan & { version?: number }

export function toEditableDraft(input: {
  draftId: string
  projectId: string
  plan: PersistedEditablePlan
}): EditableEpicDraftPlan {
  const domains = input.plan.domains ?? []
  const domainIdByEpicId = new Map<string, string>()
  for (const domain of domains) {
    for (const epicId of domain.epicIds) domainIdByEpicId.set(epicId, domain.domainId)
  }

  return {
    draftId: input.draftId,
    projectId: input.projectId,
    version: input.plan.version ?? 1,
    strategy: 'capability_seed',
    domains: domains.map((domain) => ({
      ...domain,
      epicIds: [...domain.epicIds],
      source: 'generated',
    })),
    epics: input.plan.epics.map((epic) => ({
      ...epic,
      domainId: epic.domainId ?? domainIdByEpicId.get(epic.tempEpicId) ?? '',
      source: 'generated',
    })),
    reviewBuckets: input.plan.reviewBuckets ?? emptyReviewBuckets(),
    validationIssues: input.plan.validationIssues,
    judgeResults: input.plan.judgeResults,
  }
}

export function toPersistedPlan(draft: EditableEpicDraftPlan): PersistedEditablePlan {
  return {
    ...projectEditableDraftToReviewablePlan(draft),
    version: draft.version,
  }
}

export function summarizeEditCommands(commands: EpicDraftCommand[]) {
  return {
    commandCount: commands.length,
    createdEpics: commands.filter((command) => command.type === 'create_epic').length,
    movedDocuments: commands
      .filter((command): command is Extract<EpicDraftCommand, { type: 'move_documents' }> => command.type === 'move_documents')
      .reduce((count, command) => count + command.documentIds.length, 0),
    renamedEpics: commands.filter((command) => command.type === 'rename_epic').length,
    mergedEpics: commands.filter((command) => command.type === 'merge_epics').length,
  }
}

export function toConfirmedPlan(plan: PersistedEditablePlan): ConfirmedEpicPlan {
  return {
    ...plan,
    epics: plan.epics.map((epic) => ({
      ...epic,
      status: 'confirmed',
    })),
  }
}
