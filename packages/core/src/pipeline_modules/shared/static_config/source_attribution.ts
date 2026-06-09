import type { ResolvedConfigSource, SourceAttributionClass } from './types.js'

const CONFIG_SOURCE_ATTRIBUTION: Record<ResolvedConfigSource, SourceAttributionClass> = {
  default: 'default_config',
  repository_metadata: 'repository_metadata',
  user: 'user_config',
  approved: 'approved_config',
  fixture: 'fixture_config',
  agent_candidate: 'agent_search_proposal',
}

export function sourceAttributionFromConfigSource(
  source: ResolvedConfigSource | string | null | undefined,
): SourceAttributionClass | null {
  if (!source) return null
  return CONFIG_SOURCE_ATTRIBUTION[source as ResolvedConfigSource] ?? null
}

export function normalizeSourceAttribution(
  source: string | null | undefined,
): SourceAttributionClass | null {
  if (!source) return null
  const configSource = sourceAttributionFromConfigSource(source)
  if (configSource) return configSource
  if (source === 'adapter' || source.startsWith('rule:') || source.startsWith('semantic:')) return 'adapter'
  if (source === 'source_fallback' || source.startsWith('source:')) return 'source_fallback'
  if (source.startsWith('llm:') || source === 'llm_fallback' || source === 'route_llm_fallback') {
    return 'route_llm_fallback'
  }
  if (source === 'default_config' || source === 'user_config' || source === 'fixture_config') return source
  if (source === 'repository_metadata' || source === 'approved_config' || source === 'agent_search_proposal') return source
  return null
}

export function routeSourceAttribution(args: {
  metadata?: Record<string, unknown> | null
  detectionSource?: string | null
}): SourceAttributionClass | null {
  const metadataSource = typeof args.metadata?.source === 'string'
    ? normalizeSourceAttribution(args.metadata.source)
    : null
  if (metadataSource) return metadataSource
  if (args.metadata?.routeResolution === 'llm_fallback') return 'route_llm_fallback'
  return normalizeSourceAttribution(args.detectionSource)
}
