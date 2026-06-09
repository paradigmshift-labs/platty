import { traceReceiverIdentity } from '../../../graph_trace/receiver_identity.js'
import type { RelationCandidate } from '../../../types.js'
import { isS3ClientPackage } from '../packages.js'
import type { ExternalServiceExtractionFamily } from './extraction_types.js'
import {
  collectStringConstants,
  readFileNodeSource,
  resolveObjectStringProperty,
} from './extraction_utils.js'

const S3_COMMAND_METHODS: Record<string, string> = {
  PutObjectCommand: 'putObject',
  GetObjectCommand: 'getObject',
  DeleteObjectCommand: 'deleteObject',
}

export const STORAGE_SERVICE_EXTRACTION: ExternalServiceExtractionFamily = {
  services: ['s3', 'supabase_storage', 'cloudinary', 'uploadthing'],
  extractCandidates(inputs, index, helpers) {
    if (!inputs.repoPath) return []

    const candidates: RelationCandidate[] = []
    for (const fileNode of inputs.nodes.filter((node) => node.type === 'file' && /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(node.filePath))) {
      const importsS3 = (index.importsBySource.get(fileNode.id) ?? [])
        .some((imp) => isS3ClientPackage(imp.targetSpecifier))
      if (!importsS3) continue

      const source = readFileNodeSource(inputs, fileNode.filePath)
      if (!source) continue

      const constants = collectStringConstants(source)
      for (const match of source.matchAll(/\bnew\s+(PutObjectCommand|GetObjectCommand|DeleteObjectCommand)\s*\(\s*\{([\s\S]*?)\}\s*\)/g)) {
        const commandName = match[1]
        const objectBody = match[2]
        if (!commandName || !objectBody) continue

        const bucket = resolveObjectStringProperty(objectBody, 'Bucket', constants)
        if (!bucket) continue

        const sourceNodeId = helpers.sourceNodeIdForOffset(fileNode.id, fileNode.filePath, match.index ?? 0, source)
        candidates.push({
          kind: 'external_service',
          sourceNodeId,
          evidenceNodeIds: [sourceNodeId],
          receiver: commandName,
          targetSymbol: S3_COMMAND_METHODS[commandName] ?? commandName,
          chainPath: commandName,
          firstArg: bucket,
          payload: { service: 's3', adapter: 'aws_sdk_v3_command', command: commandName },
        })
      }
    }

    return candidates
  },
  targetArgs(service, context) {
    if (service !== 'supabase_storage') return null

    const literal = context.call.chainPath?.match(/\.from\(['"]([^'"]+)['"]\)/)?.[1]
    if (literal) return [literal]

    const identifier = context.call.chainPath?.match(/\.from\(([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\)/)?.[1]
    if (!identifier) return []

    const bucket = context.resolveStaticArg(identifier)
    return bucket ? [bucket] : []
  },
  detectServicesForCall(context) {
    const identity = traceReceiverIdentity({
      nodeId: context.sourceNodeId,
      chainPath: context.call.chainPath ?? '',
      index: context.index,
      maxHops: 5,
    })
    return identity?.orm === 'supabase' && context.call.chainPath?.includes('.storage')
      ? ['supabase_storage']
      : []
  },
}
