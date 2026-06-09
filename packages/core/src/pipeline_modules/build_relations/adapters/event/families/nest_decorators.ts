import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RelationCandidate } from '../../../types.js'
import type { EventBrokerExtractionContext } from './types.js'

export function extractNestDecoratorCandidates(context: EventBrokerExtractionContext): RelationCandidate[] {
  const { inputs, node, decorators } = context
  const candidates: RelationCandidate[] = []

  const onEvent = decorators.find((d) => d.targetSymbol === 'OnEvent')
  if (onEvent?.firstArg) {
    candidates.push({
      kind: 'event',
      sourceNodeId: node.id,
      evidenceNodeIds: [`edge:${onEvent.id}`],
      firstArg: onEvent.firstArg,
      payload: { broker: 'node_event', direction: 'listen', adapter: 'event_broker' },
    })
  }

  const subscribeMessage = decorators.find((d) => d.targetSymbol === 'SubscribeMessage')
  if (subscribeMessage?.firstArg) {
    const gateway = decorators.find((d) => d.targetSymbol === 'WebSocketGateway')
    const websocketTarget = buildWebsocketTarget(
      subscribeMessage.firstArg,
      gateway?.firstArg ?? findWebsocketGatewayPort(inputs.repoPath, node.filePath),
    )
    candidates.push({
      kind: 'event',
      sourceNodeId: node.id,
      evidenceNodeIds: [`edge:${subscribeMessage.id}`],
      firstArg: websocketTarget.target,
      payload: {
        broker: 'websocket',
        direction: 'listen',
        adapter: 'event_broker',
        ...(websocketTarget.port ? { port: websocketTarget.port } : {}),
      },
    })
  }

  return candidates
}

function buildWebsocketTarget(message: string, gatewayArg: string | null): { target: string; port: string | null } {
  const port = gatewayArg && /^\d+$/.test(gatewayArg) ? gatewayArg : null
  return {
    target: port ? `${port}#${message}` : message,
    port,
  }
}

function findWebsocketGatewayPort(repoPath: string | null, filePath: string): string | null {
  if (!repoPath) return null
  const sourcePath = join(repoPath, filePath)
  if (!existsSync(sourcePath)) return null
  const source = readFileSync(sourcePath, 'utf8')
  const match = /@WebSocketGateway\s*\(\s*(\d+)/.exec(source)
  return match?.[1] ?? null
}
