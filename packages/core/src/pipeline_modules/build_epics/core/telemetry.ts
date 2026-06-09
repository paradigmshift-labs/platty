import type { BuildEpicsDoc, BuildEpicsDocIndex, ValidationIssue } from './types.js'

export type BuildEpicsTelemetryStage =
  | 'catalog_input'
  | 'catalog_output'
  | 'catalog_chunk_input'
  | 'catalog_chunk_output'
  | 'catalog_merge'
  | 'capability_seed_start'
  | 'domain_planning_chunked'
  | 'capability_seed_input'
  | 'capability_seed_output'
  | 'taxonomy_candidate_input'
  | 'taxonomy_candidate_output'
  | 'taxonomy_merge_input'
  | 'taxonomy_merge_output'
  | 'document_assignment_input'
  | 'document_assignment_output'
  | 'cross_domain_input'
  | 'cross_domain_output'
  | 'boundary_refinement_input'
  | 'boundary_refinement_output'
  | 'document_id_resolved'
  | 'schema_violation'
  | 'final_plan'
  | 'judge_input'
  | 'judge_output'
  | 'debug_file'

export interface BuildEpicsTelemetryEvent {
  stage: BuildEpicsTelemetryStage
  message?: string
  data: Record<string, unknown>
}

export interface BuildEpicsTelemetry {
  record(event: BuildEpicsTelemetryEvent): void | Promise<void>
  saveArtifact?(name: string, content: string, metadata?: Record<string, unknown>): void | boolean | Promise<void | boolean>
}

export function safeRecord(telemetry: BuildEpicsTelemetry | undefined, event: BuildEpicsTelemetryEvent): void {
  if (!telemetry) return
  try {
    void telemetry.record(event)
  } catch {
    // Telemetry must never change pipeline behavior.
  }
}

export function safeSaveArtifact(
  telemetry: BuildEpicsTelemetry | undefined,
  name: string,
  content: string,
  metadata?: Record<string, unknown>,
): void {
  if (!telemetry?.saveArtifact) return
  try {
    const result = telemetry.saveArtifact(name, content, metadata)
    if (result === false) return
    safeRecord(telemetry, { stage: 'debug_file', data: { name, bytes: Buffer.byteLength(content, 'utf8'), ...(metadata ?? {}) } })
  } catch {
    // Debug artifacts are best-effort only.
  }
}

export function previewText(value: string, maxLength = 4000): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

export function safeArtifactName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'artifact.txt'
}

export function countDocIndex(docIndex: BuildEpicsDocIndex): Record<string, number> {
  return {
    api_spec: docIndex.apis.length,
    screen_spec: docIndex.screens.length,
    event_spec: docIndex.events.length,
    schedule_spec: docIndex.schedules.length,
  }
}

export function countDocs(docs: BuildEpicsDoc[]): Record<string, number> {
  return docs.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.type] = (acc[doc.type] ?? 0) + 1
    return acc
  }, {})
}

export function recordValidationIssue(
  telemetry: BuildEpicsTelemetry | undefined,
  issue: ValidationIssue,
  context: Record<string, unknown>,
): void {
  safeRecord(telemetry, {
    stage: 'schema_violation',
    data: {
      ...context,
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      documentId: issue.documentId,
      tempEpicId: issue.tempEpicId,
    },
  })
}
