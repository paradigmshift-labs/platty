import type { CallArgExpression } from '../../../types.js'
import type { RealtimeAuthFamily } from './types.js'
import { isRecord, normalizeAuthMethod, parseLiteralArgs, staticString } from './utils.js'

export const ablyRealtimeAuthFamily: RealtimeAuthFamily = {
  name: 'ably',
  match(edge) {
    if (edge.targetSpecifier !== 'ably' && edge.targetSpecifier !== 'ably/promises') return null
    const symbol = edge.targetSymbol ?? ''
    const chain = edge.chainPath ?? ''
    const isRealtimeOrRest = symbol === 'Realtime' ||
      symbol === 'Rest' ||
      symbol === 'Ably.Realtime' ||
      symbol === 'Ably.Rest' ||
      ((symbol === 'Promise' || symbol === 'Callbacks') && /(?:^|\.)Ably\.(?:Realtime|Rest)$/.test(chain)) ||
      ((chain === 'Ably' || chain.endsWith('.Ably')) && (symbol === 'Realtime' || symbol === 'Rest'))
    if (!isRealtimeOrRest) return null

    const auth = extractAblyAuthUrl(edge.argExpressions, edge.literalArgs)
    return auth
      ? {
          rawTarget: auth.rawTarget,
          method: auth.method,
          anchor: 'ably_auth_url',
          adapter: 'ably_auth',
        }
      : null
  },
}

function extractAblyAuthUrl(
  argExpressions: unknown,
  literalArgs: string | null | undefined,
): { rawTarget: string; method: string } | null {
  const expressions = Array.isArray(argExpressions) ? argExpressions as CallArgExpression[] : []
  const firstArg = expressions.find((arg) => arg.index === 0)
  const config = firstArg?.kind === 'object' ? firstArg : firstArg?.resolved
  if (config?.kind === 'object' && config.properties) {
    const authUrl = staticString(config.properties.authUrl)
    if (authUrl) {
      return {
        rawTarget: authUrl,
        method: normalizeAuthMethod(staticString(config.properties.authMethod)),
      }
    }
  }

  const options = parseLiteralArgs(literalArgs)[0]
  if (!isRecord(options) || typeof options.authUrl !== 'string') return null
  return {
    rawTarget: options.authUrl,
    method: normalizeAuthMethod(typeof options.authMethod === 'string' ? options.authMethod : null),
  }
}
