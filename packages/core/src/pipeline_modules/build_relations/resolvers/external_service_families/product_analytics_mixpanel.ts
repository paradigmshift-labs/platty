import type { ServiceResolver } from './types.js'

export const MIXPANEL_SERVICE_RESOLVER: ServiceResolver = {
  resourceFor: (candidate) => {
    const normalized = candidate.chainPath ?? ''
    if (candidate.targetSymbol === 'track' || candidate.targetSymbol === 'track_batch') return 'events'
    if (candidate.targetSymbol === 'alias') return 'users'
    if (normalized.includes('people') || candidate.targetSymbol === 'delete_user') return 'profiles'
    return null
  },
  operationFor: (candidate) => {
    const method = candidate.targetSymbol
    if (method === 'track' || method === 'track_batch') return 'capture_event'
    if (method === 'alias') return 'alias_user'
    if (method === 'track_charge') return 'track_revenue'
    if (method === 'clear_charges') return 'clear_revenue'
    if (method === 'delete_user') return 'delete_profile'
    if (method === 'set' || method === 'set_once' || method === 'increment' || method === 'append' || method === 'union') return 'update_profile'
    return null
  },
}
