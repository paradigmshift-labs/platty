import type { BuildDocsGenerationContextResponse, ValidationError } from './types.js'

interface AuditInput {
  document: unknown
  context: BuildDocsGenerationContextResponse
}

export function auditDraftQuality(input: AuditInput): ValidationError[] {
  if (!isRecord(input.document)) return []
  const errors: ValidationError[] = []
  auditGenericFlow(input.document, input.context, errors)
  return errors
}

function auditGenericFlow(
  document: Record<string, unknown>,
  context: BuildDocsGenerationContextResponse,
  errors: ValidationError[],
): void {
  if (!hasBehaviorEvidence(context)) return
  if (!Array.isArray(document.flow)) return
  const flow = document.flow.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (flow.length === 0 || !flow.every(isGenericFlowStep)) return
  errors.push({
    code: 'GENERIC_FLOW',
    path: '$.flow',
    message: `flow must name source-backed behavior such as ${behaviorHint(context)}`,
  })
}

function hasBehaviorEvidence(context: BuildDocsGenerationContextResponse): boolean {
  return context.content.code_relation_facts.length > 0 || context.content.service_map_facts.length > 0 || context.content.source_context.length > 1
}

function isGenericFlowStep(step: string): boolean {
  const normalized = step.trim().replace(/\s+/g, ' ')
  return /^handles?\s+(GET|POST|PUT|PATCH|DELETE)\b/i.test(normalized)
    || /^calls?\s+the\s+handler\.?$/i.test(normalized)
    || /^returns?\s+(a\s+)?response\.?$/i.test(normalized)
    || /^handler\s+handles\b/i.test(normalized)
}

function behaviorHint(context: BuildDocsGenerationContextResponse): string {
  const relation = context.content.code_relation_facts[0] ?? context.content.service_map_facts[0]
  if (relation?.target && relation.operation) return `${relation.operation} ${relation.target}`
  const repo = context.content.source_context.find((source) => /Repository\./.test(source.symbol))
  return repo?.symbol ?? context.content.source_context[0]?.symbol ?? 'the source-backed call chain'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
