import { buildSystemRelations } from './relation_compactor.js'
import { resolveSourceLinkSelection } from './source_links.js'
import type {
  BuildDocsGenerationContextResponse,
  StaticDocumentEnvelope,
} from './types.js'

export function extractRoutePathParams(path: string): string[] {
  const matches: Array<{ index: number; param: string }> = []
  const params: string[] = []
  const seen = new Set<string>()
  const patterns = [
    /:([A-Za-z_][A-Za-z0-9_]*)(?:[?+*])?/g,
    /\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
  ]

  for (const pattern of patterns) {
    for (const match of path.matchAll(pattern)) {
      const param = match[1]
      const index = match.index ?? -1
      if (!param || index < 0) continue
      matches.push({ index, param })
    }
  }

  matches.sort((left, right) => left.index - right.index)

  for (const match of matches) {
    if (seen.has(match.param)) continue
    seen.add(match.param)
    params.push(match.param)
  }

  return params
}

export function buildStaticDocumentEnvelope(
  context: BuildDocsGenerationContextResponse,
  draft: Record<string, unknown> = {},
): StaticDocumentEnvelope & Record<string, unknown> {
  const target = context.content.target
  const envelope: StaticDocumentEnvelope & Record<string, unknown> = {
    id: target.document_id,
    type: target.document_type,
    identity: identityFromContext(context),
    relations: buildSystemRelations([
      ...context.content.code_relation_facts,
      ...context.content.service_map_facts,
    ]),
    evidence_refs: context.manifest.evidence_ids,
    relation_evidence_checked: true,
  }

  if (target.document_type !== 'api_spec') return { ...envelope, contracts: {} }

  const resolved = resolveSourceLinkSelection(
    draft.source_link_selection,
    context.content.source_link_candidates ?? [],
  )
  const sourceLinks = resolved.ok ? resolved.sourceLinks : { access: [], input: [], response: [] }
  return {
    ...envelope,
    source_links: sourceLinks,
  }
}

function identityFromContext(context: BuildDocsGenerationContextResponse): Record<string, unknown> {
  const target = context.content.target
  if (target.document_type === 'api_spec') {
    return {
      method: target.method,
      path: target.path,
      handler: target.handler,
      file_path: target.file_path,
    }
  }
  if (target.document_type === 'screen_spec') {
    return {
      route_path: target.path,
      screen_name: target.handler,
      component: target.handler,
      file_path: target.file_path,
      router: target.framework_hint ?? 'unknown',
    }
  }
  if (target.document_type === 'event_spec') {
    return {
      name: target.path,
      handler: target.handler,
      file_path: target.file_path,
    }
  }
  return {
    name: target.path,
    handler: target.handler,
    file_path: target.file_path,
  }
}
