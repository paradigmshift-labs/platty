import type { RelationCandidate } from '../../../types.js'
import type { EventBrokerExtractionContext } from './types.js'
import { eventCallCandidate, parseLiteralArgs } from './utils.js'

export function extractRabbitCandidates(context: EventBrokerExtractionContext): RelationCandidate[] {
  const { node, calls, packageImports } = context
  const candidates: RelationCandidate[] = []
  const isAmqplib = packageImports.has('amqplib')

  for (const call of calls) {
    if (isAmqplib && call.targetSymbol === 'publish') {
      const target = extractRabbitPublishTarget(call.firstArg, call.literalArgs)
      if (target) {
        candidates.push(eventCallCandidate(node.id, { ...call, firstArg: target }, 'rabbitmq'))
      }
      continue
    }

    if (isAmqplib && call.targetSymbol === 'sendToQueue' && call.firstArg) {
      candidates.push(eventCallCandidate(node.id, call, 'rabbitmq'))
      continue
    }

    if (isAmqplib && call.targetSymbol === 'consume' && call.firstArg) {
      candidates.push(eventCallCandidate(node.id, call, 'rabbitmq', 'listen'))
    }
  }

  return candidates
}

function extractRabbitPublishTarget(
  exchange: string | null | undefined,
  literalArgs: string | null | undefined,
): string | null {
  if (!exchange) return null

  const args = parseLiteralArgs(literalArgs)
  const routingKey = typeof args[1] === 'string' ? args[1] : null
  if (routingKey) return `${exchange}/${routingKey}`

  return exchange
}
