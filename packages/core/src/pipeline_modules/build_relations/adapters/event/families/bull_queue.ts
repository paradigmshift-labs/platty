import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RelationCandidate, SemanticIndex } from '../../../types.js'
import type { EventBrokerExtractionContext } from './types.js'
import { escapeRegExp, eventCallCandidate, findDecoratorArg } from './utils.js'

export function extractBullQueueCandidates(context: EventBrokerExtractionContext): RelationCandidate[] {
  const { inputs, node, broker, calls, decorators, processor, packageImports, index } = context
  const candidates: RelationCandidate[] = []
  const isBullmq = packageImports.has('bullmq')
  const bullmqQueueBindings = isBullmq
    ? findBullmqQueueBindings(node.id, index)
    : new Map<string, string>()

  for (const call of calls) {
    if (isBullmq && call.targetSymbol === 'add') {
      const queue = findBullmqQueueName(call.chainPath, bullmqQueueBindings)
      if (queue && call.firstArg) {
        candidates.push({
          kind: 'event',
          sourceNodeId: node.id,
          evidenceNodeIds: [`edge:${call.id}`],
          targetSymbol: call.targetSymbol,
          chainPath: call.chainPath,
          firstArg: call.firstArg,
          payload: { broker: 'bull', queue, library: 'bullmq', adapter: 'bullmq_queue' },
        })
      }
      continue
    }

    if (isBullmq && call.targetSymbol === 'Worker' && call.firstArg) {
      candidates.push({
        kind: 'event',
        sourceNodeId: node.id,
        evidenceNodeIds: [`edge:${call.id}`],
        targetSymbol: call.targetSymbol,
        chainPath: call.chainPath,
        firstArg: '*',
        payload: {
          broker: 'bull',
          queue: call.firstArg,
          direction: 'listen',
          library: 'bullmq',
          adapter: 'bullmq_worker',
        },
      })
      continue
    }

    if (call.targetSymbol === 'add' && processor == null && broker === 'bull') {
      const queue = findDecoratorArg(decorators, 'InjectQueue')
        ?? findBullInjectQueueForReceiver(inputs.repoPath, node.filePath, call.chainPath)
      candidates.push({
        kind: 'event',
        sourceNodeId: node.id,
        evidenceNodeIds: [`edge:${call.id}`],
        targetSymbol: call.targetSymbol,
        chainPath: call.chainPath,
        firstArg: call.firstArg,
        payload: { broker, queue, adapter: 'event_broker' },
      })
    }
  }

  if (processor) {
    const process = decorators.find((d) => d.targetSymbol === 'Process')
    if (process?.firstArg) {
      candidates.push({
        kind: 'event',
        sourceNodeId: node.id,
        evidenceNodeIds: [`edge:${process.id}`],
        firstArg: process.firstArg,
        payload: { broker: 'bull', queue: processor.firstArg, direction: 'listen', adapter: 'event_broker' },
      })
    }
  }

  return candidates
}

export function findBullmqQueueBindings(
  nodeId: string,
  index: SemanticIndex,
): Map<string, string> {
  const bindings = new Map<string, string>()
  const node = index.nodesById.get(nodeId)
  const fileNodeIds = node ? (index.nodesByFile.get(node.filePath) ?? []).map((fileNode) => fileNode.id) : []
  const sourceIds = new Set([nodeId, ...fileNodeIds])

  for (const sourceId of sourceIds) {
    for (const call of index.callsBySource.get(sourceId) ?? []) {
      if (call.targetSymbol !== 'Queue' || !call.firstArg) continue

      if (call.chainPath) bindings.set(call.chainPath, call.firstArg)
      bindings.set('*', call.firstArg)
    }
  }

  return bindings
}

function findBullmqQueueName(chainPath: string | null, bindings: Map<string, string>): string | null {
  if (chainPath) {
    const direct = bindings.get(chainPath)
    if (direct) return direct

    const receiver = chainPath.split('.').at(-1)
    if (receiver) {
      const matched = bindings.get(receiver)
      if (matched) return matched
    }
  }

  if (bindings.size === 1) return bindings.values().next().value ?? null
  return bindings.get('*') ?? null
}

function findBullInjectQueueForReceiver(repoPath: string | null, filePath: string, chainPath: string | null): string | null {
  if (!repoPath || !chainPath) return null
  const receiver = chainPath.split('.').at(-1)
  if (!receiver) return null

  const sourcePath = join(repoPath, filePath)
  if (!existsSync(sourcePath)) return null
  const source = readFileSync(sourcePath, 'utf8')
  const escapedReceiver = escapeRegExp(receiver)
  const patterns = [
    new RegExp(`@InjectQueue\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*\\)[\\s\\S]{0,160}\\b${escapedReceiver}\\b`),
    new RegExp(`\\b${escapedReceiver}\\b[\\s\\S]{0,160}@InjectQueue\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*\\)`),
  ]
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}
