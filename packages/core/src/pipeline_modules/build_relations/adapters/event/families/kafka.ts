import type { RelationCandidate } from '../../../types.js'
import type { EventBrokerExtractionContext } from './types.js'
import { eventCallCandidate, isRecord, parseFirstObject } from './utils.js'

export function extractKafkaCandidates(context: EventBrokerExtractionContext): RelationCandidate[] {
  const { node, calls, decorators, packageImports } = context
  const candidates: RelationCandidate[] = []
  const isKafkaJs = packageImports.has('kafkajs')

  for (const call of calls) {
    if (isKafkaJs && call.targetSymbol === 'send') {
      const topic = extractKafkaTopic(call.literalArgs)
      if (topic) candidates.push(eventCallCandidate(node.id, { ...call, firstArg: topic }, 'kafka'))
      continue
    }

    if (isKafkaJs && call.targetSymbol === 'sendBatch') {
      for (const topic of extractKafkaBatchTopics(call.literalArgs)) {
        candidates.push(eventCallCandidate(node.id, { ...call, firstArg: topic }, 'kafka'))
      }
      continue
    }

    if (isKafkaJs && call.targetSymbol === 'subscribe') {
      for (const topic of extractKafkaSubscribeTopics(call.literalArgs)) {
        candidates.push(eventCallCandidate(node.id, { ...call, firstArg: topic }, 'kafka', 'listen'))
      }
    }
  }

  const messagePattern = decorators.find((d) => d.targetSymbol === 'MessagePattern')
  const messagePatternTarget = messagePattern ? extractNestMessagePatternTarget(messagePattern) : null
  if (messagePattern && messagePatternTarget) {
    const rpcPattern = decorators.find((d) => d.targetSymbol === 'RpcPattern')
    candidates.push({
      kind: 'event',
      sourceNodeId: node.id,
      evidenceNodeIds: [`edge:${rpcPattern?.id ?? messagePattern.id}`],
      firstArg: messagePatternTarget,
      payload: { broker: rpcPattern ? 'nest_rpc' : 'kafka', direction: 'listen', adapter: 'event_broker' },
    })
  }

  return candidates
}

function extractKafkaTopic(literalArgs: string | null | undefined): string | null {
  const first = parseFirstObject(literalArgs)
  const topic = first?.topic
  return typeof topic === 'string' ? topic : null
}

function extractKafkaBatchTopics(literalArgs: string | null | undefined): string[] {
  const first = parseFirstObject(literalArgs)
  if (!first) return []

  const topicMessages = first.topicMessages
  if (!Array.isArray(topicMessages)) return []

  return topicMessages
    .map((entry) => isRecord(entry) && typeof entry.topic === 'string' ? entry.topic : null)
    .filter((topic): topic is string => topic != null)
}

function extractKafkaSubscribeTopics(literalArgs: string | null | undefined): string[] {
  const first = parseFirstObject(literalArgs)
  if (!first) return []

  if (typeof first.topic === 'string') return [first.topic]
  if (Array.isArray(first.topics)) {
    return first.topics.filter((topic): topic is string => typeof topic === 'string')
  }

  return []
}

function extractNestMessagePatternTarget(edge: { firstArg: string | null; literalArgs?: string | null }): string | null {
  if (edge.firstArg) return edge.firstArg

  const first = parseFirstObject(edge.literalArgs)
  const target = first?.cmd ?? first?.pattern
  return typeof target === 'string' ? target : null
}
