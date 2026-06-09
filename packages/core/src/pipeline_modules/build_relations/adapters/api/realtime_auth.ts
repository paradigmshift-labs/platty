import type { CodeEdgeLike, RelationCandidate } from '../../types.js'
import { REALTIME_AUTH_FAMILIES } from './realtime_auth_families/families.js'

const INTERNAL_PATH_RE = /^\/[^/]/
const EXTERNAL_URL_RE = /^https?:\/\//

export function matchRealtimeAuthApiCandidate(
  edge: CodeEdgeLike,
  sourceNodeId: string,
): RelationCandidate | null {
  for (const family of REALTIME_AUTH_FAMILIES) {
    const auth = family.match(edge)
    if (!auth) continue
    if (EXTERNAL_URL_RE.test(auth.rawTarget) || !INTERNAL_PATH_RE.test(auth.rawTarget)) return null
    return {
      kind: 'api_call',
      sourceNodeId,
      evidenceNodeIds: [`edge:${edge.id}`],
      chainPath: edge.chainPath ?? null,
      firstArg: auth.rawTarget,
      rawTarget: auth.rawTarget,
      payload: {
        method: auth.method,
        protocol: 'rest',
        anchor: auth.anchor,
        adapter: auth.adapter,
      },
    }
  }

  return null
}
