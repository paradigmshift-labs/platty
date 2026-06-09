import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RelationCandidate } from '../../../types.js'
import type { EventBrokerExtractionContext } from './types.js'
import { collectStringConstants, eventCallCandidate, parseFirstObject, resolveObjectStringProperty } from './utils.js'

export function extractAwsMessagingCandidates(context: EventBrokerExtractionContext): RelationCandidate[] {
  const { inputs, node, broker, calls } = context
  const candidates: RelationCandidate[] = []

  for (const call of calls) {
    if (call.targetSymbol === 'SendMessageCommand' && broker === 'sqs') {
      const target = extractAwsCommandTarget(call.literalArgs, 'QueueUrl')
        ?? extractAwsCommandTargetFromSource(inputs.repoPath, node.filePath, 'SendMessageCommand', 'QueueUrl')
      if (target) candidates.push(eventCallCandidate(node.id, { ...call, firstArg: target }, 'sqs'))
      continue
    }

    if (call.targetSymbol === 'ReceiveMessageCommand' && broker === 'sqs') {
      const target = extractAwsCommandTarget(call.literalArgs, 'QueueUrl')
        ?? extractAwsCommandTargetFromSource(inputs.repoPath, node.filePath, 'ReceiveMessageCommand', 'QueueUrl')
      if (target) candidates.push(eventCallCandidate(node.id, { ...call, firstArg: target }, 'sqs', 'listen'))
      continue
    }

    if (call.targetSymbol === 'PublishCommand' && broker === 'sns') {
      const target = extractAwsCommandTarget(call.literalArgs, 'TopicArn')
        ?? extractAwsCommandTargetFromSource(inputs.repoPath, node.filePath, 'PublishCommand', 'TopicArn')
      if (target) candidates.push(eventCallCandidate(node.id, { ...call, firstArg: target }, 'sns'))
      continue
    }

    if (call.targetSymbol === 'sendMessage' && broker === 'sqs') {
      candidates.push(eventCallCandidate(node.id, call, broker))
    }
  }

  return candidates
}

function extractAwsCommandTarget(literalArgs: string | null | undefined, key: string): string | null {
  const first = parseFirstObject(literalArgs)
  const value = first?.[key]
  return typeof value === 'string' ? value : null
}

function extractAwsCommandTargetFromSource(
  repoPath: string | null,
  filePath: string,
  commandName: string,
  key: string,
): string | null {
  if (!repoPath) return null
  const sourcePath = join(repoPath, filePath)
  if (!existsSync(sourcePath)) return null

  const source = readFileSync(sourcePath, 'utf-8')
  const constants = collectStringConstants(source)
  for (const match of source.matchAll(new RegExp(`\\bnew\\s+${commandName}\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, 'g'))) {
    const objectBody = match[1]
    if (!objectBody) continue
    const resolved = resolveObjectStringProperty(objectBody, key, constants)
    if (resolved) return resolved
  }
  return null
}
