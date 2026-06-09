// rule_authoring/promoted_api_call_rules — the growing rulebook of api_call (HTTP client) rules that
// passed the deterministic referee. Each maps a client's call methods to HTTP verbs; the endpoint
// (METHOD + internal path) is what build_service_map matches to the backend route. The keystone re-runs
// the referee on every entry. See agent-relation-rule-loop.md.

/** An api_call rule's core data + one representative call so the keystone can build + verify an anchor. */
export interface ApiClientRuleSpec {
  id: string
  clientLabel: string
  clientPackages: string[]
  methodBySymbol: Record<string, string>
  example: { symbol: string; firstArg: string; expectedCanonical: string }
}

const HTTP_VERBS: Record<string, string> = {
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH', head: 'HEAD', options: 'OPTIONS',
}

export const PROMOTED_API_CALL_RULES: ApiClientRuleSpec[] = [
  {
    id: 'rel.api_call.axios',
    clientLabel: 'axios',
    clientPackages: ['axios'],
    methodBySymbol: HTTP_VERBS,
    example: { symbol: 'get', firstArg: '/api/users', expectedCanonical: 'GET /api/users' },
  },
  {
    id: 'rel.api_call.got',
    clientLabel: 'got',
    clientPackages: ['got'],
    methodBySymbol: HTTP_VERBS,
    example: { symbol: 'post', firstArg: '/api/orders', expectedCanonical: 'POST /api/orders' },
  },
  {
    id: 'rel.api_call.ky',
    clientLabel: 'ky',
    clientPackages: ['ky'],
    methodBySymbol: HTTP_VERBS,
    example: { symbol: 'get', firstArg: '/api/profile', expectedCanonical: 'GET /api/profile' },
  },
  {
    id: 'rel.api_call.superagent',
    clientLabel: 'superagent',
    clientPackages: ['superagent'],
    methodBySymbol: HTTP_VERBS,
    example: { symbol: 'put', firstArg: '/api/settings', expectedCanonical: 'PUT /api/settings' },
  },
]
