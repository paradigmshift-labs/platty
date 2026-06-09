import type { CallArgExpression } from '../../../types.js'
import type { RealtimeAuthFamily } from './types.js'
import { isRecord, parseLiteralArgs, staticString } from './utils.js'

export const pusherRealtimeAuthFamily: RealtimeAuthFamily = {
  name: 'pusher',
  match(edge) {
    if (edge.targetSymbol !== 'Pusher' || edge.targetSpecifier !== 'pusher-js') return null
    const rawTarget = extractPusherAuthEndpoint(edge.argExpressions, edge.literalArgs)
    return rawTarget
      ? {
          rawTarget,
          method: 'POST',
          anchor: 'pusher_channel_authorization',
          adapter: 'pusher_auth',
        }
      : null
  },
}

function extractPusherAuthEndpoint(argExpressions: unknown, literalArgs: string | null | undefined): string | null {
  const expressions = Array.isArray(argExpressions) ? argExpressions as CallArgExpression[] : []
  const secondArg = expressions.find((arg) => arg.index === 1)
  const config = secondArg?.kind === 'object' ? secondArg : secondArg?.resolved
  if (config?.kind === 'object' && config.properties) {
    const channelAuth = config.properties.channelAuthorization
    if (channelAuth?.kind === 'object' && channelAuth.properties) {
      const endpoint = staticString(channelAuth.properties.endpoint)
      if (endpoint) return endpoint
    }
    const legacyEndpoint = staticString(config.properties.authEndpoint)
    if (legacyEndpoint) return legacyEndpoint
  }

  const parsed = parseLiteralArgs(literalArgs)
  const options = parsed[1]
  if (!isRecord(options)) return null
  const channelAuthorization = options.channelAuthorization
  if (isRecord(channelAuthorization) && typeof channelAuthorization.endpoint === 'string') {
    return channelAuthorization.endpoint
  }
  if (typeof options.authEndpoint === 'string') return options.authEndpoint
  return null
}
