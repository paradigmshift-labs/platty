import { and, eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeEdges, codeNodes } from '@/db/schema/code_graph.js'
import { entryPoints } from '@/db/schema/build_route.js'
import { makeDocumentId } from '@/pipeline_modules/shared/id_builders.js'
import type { DocumentTarget } from './types.js'

interface EndpointNodeRow {
  codeNodeId: string
  nodeType: 'api_endpoint' | 'scheduler' | 'event' | 'screen'
  route: {
    id: string
    framework: string
    kind: string
    httpMethod: string | null
    path: string | null
    fullPath: string | null
    confidence: string
    detectionSource: string
    detectionEvidence?: Record<string, unknown> | null
  }
  filePath: string
  name: string
  parentNodeId: string | null
}

export async function selectDocumentTargets(repoId: string, db: DB, projectId = repoId): Promise<DocumentTarget[]> {
  const rows = db.select({
    entryPointId: entryPoints.id,
    framework: entryPoints.framework,
    kind: entryPoints.kind,
    httpMethod: entryPoints.httpMethod,
    path: entryPoints.path,
    fullPath: entryPoints.fullPath,
    confidence: entryPoints.confidence,
    detectionSource: entryPoints.detectionSource,
    detectionEvidence: entryPoints.detectionEvidence,
    codeNodeId: entryPoints.handlerNodeId,
    filePath: codeNodes.filePath,
    name: codeNodes.name,
    parentNodeId: codeEdges.sourceId,
  })
    .from(entryPoints)
    .innerJoin(codeNodes, eq(codeNodes.id, entryPoints.handlerNodeId))
    .leftJoin(codeEdges, and(
      eq(codeEdges.targetId, entryPoints.handlerNodeId),
      eq(codeEdges.relation, 'contains'),
      eq(codeEdges.repoId, repoId),
    ))
    .where(eq(entryPoints.repoId, repoId))
    .orderBy(codeNodes.filePath, codeNodes.name, entryPoints.kind, entryPoints.fullPath)
    .all()

  const endpointRows: EndpointNodeRow[] = rows.map((row) => ({
    codeNodeId: row.codeNodeId,
    nodeType: nodeTypeForEntryKind(row.kind),
    route: {
      id: row.entryPointId,
      framework: row.framework,
      kind: row.kind,
      httpMethod: row.httpMethod,
      path: row.path,
      fullPath: row.fullPath,
      confidence: row.confidence,
      detectionSource: row.detectionSource,
      detectionEvidence: row.detectionEvidence,
    },
    filePath: row.filePath,
    name: row.name,
    parentNodeId: row.parentNodeId ?? null,
  }))

  return groupByEntrypoint(filterDuplicateUnknownApiEntrypoints(endpointRows), projectId)
}

export function groupByEntrypoint(nodes: EndpointNodeRow[], projectId = 'project'): DocumentTarget[] {
  const groups = new Map<string, DocumentTarget>()

  for (const row of nodes) {
    const info = determineGroupKey(row)
    const existing = groups.get(info.key)

    if (existing) {
      existing.entryPointIds.push(row.route.id)
      addSeedNodeIds(existing.seedNodeIds, seedNodeIdsForEndpoint(row))
      continue
    }

    groups.set(info.key, {
      documentId: makeDocumentId(projectId, info.documentType, row.route.id),
      documentType: info.documentType,
      seedNodeIds: seedNodeIdsForEndpoint(row),
      entryPointIds: [row.route.id],
      primaryEntryPointId: row.route.id,
      targetKey: info.key,
      metadata: {
        framework_hint: info.frameworkHint,
        file_path: row.filePath,
      },
    })
  }

  return Array.from(groups.values())
}

function filterDuplicateUnknownApiEntrypoints(rows: EndpointNodeRow[]): EndpointNodeRow[] {
  const pathsWithCanonicalMethod = new Set(
    rows
      .filter((row) => row.route.kind === 'api' && typeof row.route.httpMethod === 'string' && row.route.httpMethod.length > 0)
      .map((row) => row.route.fullPath ?? row.route.path)
      .filter((path): path is string => path !== null),
  )
  if (pathsWithCanonicalMethod.size === 0) return rows
  return rows.filter((row) => {
    if (row.route.kind !== 'api') return true
    if (typeof row.route.httpMethod === 'string' && row.route.httpMethod.length > 0) return true
    const path = row.route.fullPath ?? row.route.path
    return path === null || !pathsWithCanonicalMethod.has(path)
  })
}

function seedNodeIdsForEndpoint(row: EndpointNodeRow): string[] {
  const ids = [row.codeNodeId]
  const matched = row.route.detectionEvidence?.matchedNodeIds
  if (Array.isArray(matched)) {
    for (const id of matched) {
      if (typeof id === 'string' && id.length > 0) ids.push(id)
    }
  }
  return [...new Set(ids)]
}

function addSeedNodeIds(target: string[], ids: string[]): void {
  for (const id of ids) {
    if (!target.includes(id)) target.push(id)
  }
}

function determineGroupKey(row: EndpointNodeRow): {
  key: string
  documentType: DocumentTarget['documentType']
  frameworkHint: string | null
} {
  if (row.nodeType === 'event') {
    return { key: `event:${row.name}:${row.codeNodeId}`, documentType: 'event_spec', frameworkHint: null }
  }
  if (row.nodeType === 'scheduler') {
    const schedule = row.route.fullPath ?? row.route.path ?? row.name
    return { key: `schedule:${schedule}:${row.name}:${row.codeNodeId}`, documentType: 'schedule_spec', frameworkHint: row.route.framework || null }
  }
  if (row.nodeType === 'screen') {
    const route = row.route.fullPath ?? row.route.path ?? row.name
    return { key: `screen:${route}:${row.name}`, documentType: 'screen_spec', frameworkHint: detectScreenFramework(row.route.framework, row.filePath) }
  }
  const method = row.route.httpMethod?.toUpperCase() ?? 'UNKNOWN'
  const path = row.route.fullPath ?? row.route.path ?? row.name
  return { key: `api:${method}:${path}`, documentType: 'api_spec', frameworkHint: row.parentNodeId ? 'nestjs' : detectApiFramework(row.route.framework, row.filePath) }
}

function nodeTypeForEntryKind(kind: string): EndpointNodeRow['nodeType'] {
  if (kind === 'api') return 'api_endpoint'
  if (kind === 'page') return 'screen'
  if (kind === 'event') return 'event'
  if (kind === 'job') return 'scheduler'
  return 'api_endpoint'
}

function detectScreenFramework(framework: string, filePath: string): string | null {
  if (framework.startsWith('flutter')) return 'flutter'
  if (framework === 'nextjs') return 'nextjs'
  if (/\.(tsx|jsx)$/.test(filePath)) return 'react'
  return framework || null
}

function detectApiFramework(framework: string, filePath: string): string | null {
  if (framework) return framework
  if (filePath.includes('/app/') && filePath.endsWith('route.ts')) return 'nextjs'
  if (filePath.includes('/routes/') || filePath.includes('/router')) return 'express'
  return null
}
