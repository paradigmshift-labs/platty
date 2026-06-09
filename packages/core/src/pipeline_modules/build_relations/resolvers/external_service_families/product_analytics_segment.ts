import type { ServiceResolver } from './types.js'

export const SEGMENT_SERVICE_RESOLVER: ServiceResolver = {
  resourceFor: (candidate) => {
    if (candidate.targetSymbol === 'identify' || candidate.targetSymbol === 'alias') return 'users'
    if (candidate.targetSymbol === 'group') return 'groups'
    if (candidate.targetSymbol === 'page') return 'pages'
    if (candidate.targetSymbol === 'screen') return 'screens'
    if (candidate.targetSymbol === 'track') return 'events'
    if (candidate.targetSymbol === 'flush' || candidate.targetSymbol === 'closeAndFlush') return 'delivery'
    return null
  },
  operationFor: (candidate) => {
    const method = candidate.targetSymbol
    if (method === 'identify') return 'identify_user'
    if (method === 'track') return 'capture_event'
    if (method === 'page') return 'page_view'
    if (method === 'screen') return 'screen_view'
    if (method === 'group') return 'identify_group'
    if (method === 'alias') return 'alias_user'
    if (method === 'flush' || method === 'closeAndFlush') return 'flush'
    return null
  },
}
