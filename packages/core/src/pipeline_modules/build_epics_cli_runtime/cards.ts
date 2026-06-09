import type { BuildEpicsDoc, BuildEpicsDocIndex } from '@/pipeline_modules/build_epics_core/types.js'
import type { BuildEpicsDocumentCard } from './types.js'

export function packBuildEpicsDocumentCards(docIndex: BuildEpicsDocIndex): BuildEpicsDocumentCard[] {
  return [
    ...docIndex.apis.map(cardForDoc),
    ...docIndex.screens.map(cardForDoc),
    ...docIndex.events.map(cardForDoc),
    ...docIndex.schedules.map(cardForDoc),
  ]
}

function cardForDoc(doc: BuildEpicsDoc): BuildEpicsDocumentCard {
  const base = {
    documentId: doc.documentId,
    type: doc.type,
    title: doc.title,
    summary: doc.summary,
    actorHints: doc.actorHints,
    domainHints: doc.domainHints,
    relationHints: (doc.relationEvidence ?? []).map((evidence) => ({
      kind: evidence.kind,
      target: evidence.target,
      operation: evidence.operation,
      evidenceIds: evidence.evidenceNodeIds,
    })),
  }

  if (doc.type === 'api_spec') return { ...base, method: doc.method, path: doc.path, access: doc.access }
  if (doc.type === 'screen_spec') return { ...base, routePath: doc.routePath }
  if (doc.type === 'event_spec') return { ...base, eventKey: doc.eventKey }
  return { ...base, jobName: doc.jobName }
}
