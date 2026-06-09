import type {
  SourceContext,
  SourceLinkCandidate,
  SourceLinkRole,
  SourceLinks,
  ValidationError,
} from './types.js'

export const SOURCE_LINK_ROLES: SourceLinkRole[] = ['access', 'input', 'response']

const TYPE_DEFINITION_NODE_TYPES = new Set(['class', 'interface', 'type', 'type_alias', 'schema', 'model'])

const ACCESS_PATTERN = /(admin|auth|guard|role|permission|jwt|login|public)/i
const INPUT_PATTERN = /(body|request|input|payload|query|params?|dto|schema)/i
const RESPONSE_PATTERN = /(response|result|output|return|json)/i

export function buildSourceLinkCandidates(sources: SourceContext[]): SourceLinkCandidate[] {
  return sources
    .filter((source) => Boolean(source.evidence_id && source.node_id && source.symbol))
    .map((source, index) => ({
      candidate_id: `source_link_candidate:${String(index + 1).padStart(3, '0')}`,
      node_id: source.node_id,
      symbol: source.symbol,
      node_type: source.node_type,
      file_path: source.file_path,
      line_start: source.line_start,
      line_end: source.line_end,
      evidence_id: source.evidence_id,
      role_hints: roleHintsFor(source),
    }))
}

export function resolveSourceLinkSelection(
  selection: unknown,
  candidates: SourceLinkCandidate[],
): { ok: true; sourceLinks: SourceLinks } | { ok: false; errors: ValidationError[] } {
  const sourceLinks = emptySourceLinks()
  if (!isRecord(selection)) return { ok: true, sourceLinks }

  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]))
  const errors: ValidationError[] = []

  for (const role of SOURCE_LINK_ROLES) {
    const selectedIds = selection[role]
    if (selectedIds === undefined) continue
    if (!Array.isArray(selectedIds)) {
      errors.push({
        code: 'QUALITY_FIELD_SHAPE',
        path: `$.source_link_selection.${role}`,
        message: `${role} selection must be an array of candidate ids`,
      })
      continue
    }

    const seenNodeIds = new Set<string>()
    selectedIds.forEach((candidateId, index) => {
      if (typeof candidateId !== 'string' || candidateId.length === 0) {
        errors.push({
          code: 'QUALITY_FIELD_SHAPE',
          path: `$.source_link_selection.${role}[${index}]`,
          message: `${role} selection entries must be non-empty candidate id strings`,
        })
        return
      }
      const candidate = candidatesById.get(candidateId)
      if (!candidate) {
        errors.push({
          code: 'UNKNOWN_SOURCE_LINK_CANDIDATE',
          path: `$.source_link_selection.${role}[${index}]`,
          message: `${candidateId} is not an available source link candidate`,
        })
        return
      }
      if (seenNodeIds.has(candidate.node_id)) return
      seenNodeIds.add(candidate.node_id)
      sourceLinks[role].push(candidate.node_id)
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, sourceLinks }
}

export function stripSourceLinkSelection(draft: Record<string, unknown>): Record<string, unknown> {
  const { source_link_selection: _sourceLinkSelection, ...rest } = draft
  return rest
}

function roleHintsFor(source: SourceContext): string[] {
  const hints: string[] = []
  const text = sourceText(source)

  if (source.dep_type === 'entrypoint') hints.push('entrypoint')
  if (TYPE_DEFINITION_NODE_TYPES.has(source.node_type)) hints.push('type-definition')
  if (ACCESS_PATTERN.test(text)) hints.push('access')
  if (INPUT_PATTERN.test(text)) hints.push('input')
  if (source.dep_type === 'entrypoint' || RESPONSE_PATTERN.test(text)) hints.push('response')

  return hints
}

function sourceText(source: SourceContext): string {
  return [
    source.symbol,
    source.signature ?? '',
    source.source_excerpt,
  ].join('\n')
}

function emptySourceLinks(): SourceLinks {
  return {
    access: [],
    input: [],
    response: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
