import type { ServiceResolver } from './types.js'

export const POSTHOG_SERVICE_RESOLVER: ServiceResolver = {
  resourceFor: (candidate) => {
    if (candidate.targetSymbol === 'capture') return 'events'
    if (candidate.targetSymbol === 'identify') return 'users'
    if (candidate.targetSymbol === 'group') return 'groups'
    return null
  },
  operationFor: (candidate) => {
    const method = candidate.targetSymbol
    if (method === 'capture') return 'capture_event'
    if (method === 'identify') return 'identify_user'
    if (method === 'group') return 'identify_group'
    return null
  },
}
