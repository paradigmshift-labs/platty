import { createHash } from 'node:crypto'

export interface EntryPointIdentity {
  framework: string
  kind: string
  httpMethod?: string | null
  fullPath?: string | null
  path?: string | null
  handlerNodeId: string
}

export function makeEntryPointId(repoId: string, entryPoint: EntryPointIdentity): string {
  return [
    repoId,
    entryPoint.framework,
    entryPoint.kind,
    entryPoint.httpMethod ?? '',
    entryPoint.fullPath ?? entryPoint.path ?? '',
    entryPoint.handlerNodeId,
  ].join(':')
}

export function makeDocumentId(projectId: string, documentType: string, primaryEntryPointId: string): string {
  return `doc:${projectId}:${documentType}:${hashId(primaryEntryPointId)}`
}

function hashId(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
}
