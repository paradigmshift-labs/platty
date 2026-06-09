import type { ServiceResolver } from './types.js'

export const AMPLITUDE_SERVICE_RESOLVER: ServiceResolver = {
  resourceFor: (candidate) => {
    if (candidate.targetSymbol === 'track') return 'events'
    if (candidate.targetSymbol === 'identify') return 'profiles'
    if (candidate.targetSymbol === 'groupIdentify') return 'groups'
    if (candidate.targetSymbol === 'revenue') return 'revenue'
    if (candidate.targetSymbol === 'flush') return 'delivery'
    return null
  },
  operationFor: (candidate) => {
    const method = candidate.targetSymbol
    if (method === 'track') return 'capture_event'
    if (method === 'identify') return 'update_profile'
    if (method === 'groupIdentify') return 'update_group'
    if (method === 'revenue') return 'track_revenue'
    if (method === 'flush') return 'flush'
    return null
  },
}
