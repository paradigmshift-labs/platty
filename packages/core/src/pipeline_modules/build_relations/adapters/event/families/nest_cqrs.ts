import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CallArgExpression, RelationCandidate } from '../../../types.js'
import type { EventBrokerExtractionContext } from './types.js'
import { escapeRegExp } from './utils.js'

export function extractNestCqrsCandidates(context: EventBrokerExtractionContext): RelationCandidate[] {
  const { inputs, index, node, broker, decorators, calls } = context
  const candidates: RelationCandidate[] = []
  const cqrsHandler = broker === 'nestjs_cqrs'
    ? decorators.find((d) => d.targetSymbol === 'CommandHandler' || d.targetSymbol === 'QueryHandler' || d.targetSymbol === 'EventsHandler')
    : null

  if (cqrsHandler && node.type !== 'class') {
    const target = cqrsHandler.firstArg
      ?? findNestCqrsHandlerTarget(inputs.repoPath, node.filePath, node.name, cqrsHandler.targetSymbol)
    if (target) {
      candidates.push({
        kind: 'event',
        sourceNodeId: node.id,
        evidenceNodeIds: [`edge:${cqrsHandler.id}`],
        targetSymbol: cqrsHandler.targetSymbol,
        chainPath: null,
        firstArg: target,
        payload: {
          broker,
          direction: 'listen',
          adapter: 'nestjs_cqrs',
          decorator: cqrsHandler.targetSymbol,
        },
      })
    }
  }

  for (const call of calls) {
    if (broker === 'nestjs_cqrs') {
      const target = extractNestCqrsDispatchTarget(node.id, call, index)
      if (target) {
        candidates.push({
          kind: 'event',
          sourceNodeId: node.id,
          evidenceNodeIds: [`edge:${call.id}`],
          targetSymbol: call.targetSymbol,
          chainPath: call.chainPath,
          firstArg: target,
          payload: { broker, adapter: 'nestjs_cqrs' },
        })
      }
      continue
    }
  }

  return candidates
}

function extractNestCqrsDispatchTarget(
  nodeId: string,
  call: EventBrokerExtractionContext['calls'][number],
  index: EventBrokerExtractionContext['index'],
): string | null {
  if (call.targetSymbol !== 'execute' && call.targetSymbol !== 'publish') return null
  if (call.firstArg) return call.firstArg

  const argExpressions = Array.isArray(call.argExpressions) ? call.argExpressions : []
  const rawArg = argExpressions.find((arg: CallArgExpression) => arg.index === 0)?.raw
  const fromRaw = rawArg?.match(/\bnew\s+([A-Za-z_$][\w$]*)\b/)?.[1]
  if (fromRaw) return fromRaw

  const constructedInSameNode = (index.callsBySource.get(nodeId) ?? [])
    .find((candidate) => candidate.id !== call.id && /^[A-Z][A-Za-z0-9_$]*(?:Command|Query|Event)$/.test(candidate.targetSymbol ?? ''))
  return constructedInSameNode?.targetSymbol ?? null
}

function findNestCqrsHandlerTarget(
  repoPath: string | null,
  filePath: string,
  nodeName: string,
  decoratorName: string | null,
): string | null {
  if (!repoPath || !decoratorName) return null
  const sourcePath = join(repoPath, filePath)
  if (!existsSync(sourcePath)) return null

  const className = nodeName.includes('.')
    ? nodeName.split('.')[0]
    : nodeName
  if (!className) return null

  const source = readFileSync(sourcePath, 'utf8')
  const escapedDecorator = escapeRegExp(decoratorName)
  const escapedClass = escapeRegExp(className)
  const pattern = new RegExp(
    `@${escapedDecorator}\\s*\\(\\s*([A-Za-z_$][\\w$]*(?:\\.name)?)\\s*\\)[\\s\\S]{0,400}?class\\s+${escapedClass}\\b`,
  )
  const match = source.match(pattern)
  return match?.[1]?.replace(/\.name$/, '') ?? null
}
