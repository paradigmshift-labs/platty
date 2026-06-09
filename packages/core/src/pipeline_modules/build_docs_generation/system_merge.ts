import type { BuildDocsGenerationContextResponse, RelationFactContext } from './types.js'
import { buildStaticDocumentEnvelope } from './static_envelope.js'
import { stripSourceLinkSelection } from './source_links.js'

export function mergeSystemDocument(input: {
  draft: Record<string, unknown>
  context: BuildDocsGenerationContextResponse
}): Record<string, unknown> {
  const draft = stripSourceLinkSelection(input.draft)
  const systemFields = buildStaticDocumentEnvelope(input.context, input.draft)

  return {
    ...draft,
    ...systemFields,
  }
}

export function systemRelationFacts(context: BuildDocsGenerationContextResponse): RelationFactContext[] {
  return [
    ...context.content.code_relation_facts,
    ...context.content.service_map_facts,
  ]
}
