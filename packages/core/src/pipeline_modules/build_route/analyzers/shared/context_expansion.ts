import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { join, normalize } from 'node:path'

import type { CodeNode } from '@/db/schema/code_graph.js'
import type { GraphIndex } from '../../graph_index.js'
import type { AnalyzerContextBundle, SourceFileContext, SuspectedNode } from '../../types.js'

export interface ContextExpansionLimits {
  maxRelatedFiles?: number
  maxImportDepth?: number
  maxReExportDepth?: number
  maxSourceBytesPerFile?: number
}

export interface BuildContextBundleInput {
  repoPath: string
  graph: GraphIndex
  rootFilePath: string
  reason: AnalyzerContextBundle['reason']
  limits?: ContextExpansionLimits
}

export interface BuildContextBundleResult {
  bundle: AnalyzerContextBundle
  suspected: SuspectedNode[]
  diagnostics: Record<string, number>
}

const DEFAULT_LIMITS = {
  maxRelatedFiles: 8,
  maxImportDepth: 2,
  maxReExportDepth: 3,
  maxSourceBytesPerFile: 80 * 1024,
}

export function buildAnalyzerContextBundle(input: BuildContextBundleInput): BuildContextBundleResult {
  const limits = { ...DEFAULT_LIMITS, ...input.limits }
  const rootFile = readSourceFile(input.repoPath, input.rootFilePath, limits.maxSourceBytesPerFile)
  const relatedFiles: SourceFileContext[] = []
  const relatedNodeIds: string[] = []
  const suspected: SuspectedNode[] = []
  const seenFiles = new Set([input.rootFilePath])
  const seenNodeIds = new Set<string>()
  const queue: Array<{ filePath: string; importDepth: number; reExportDepth: number }> = [
    { filePath: input.rootFilePath, importDepth: 0, reExportDepth: 0 },
  ]

  for (let cursor = 0; cursor < queue.length && relatedFiles.length < limits.maxRelatedFiles; cursor += 1) {
    const current = queue[cursor]
    for (const node of input.graph.nodesByFile(current.filePath)) {
      for (const edge of input.graph.outgoingEdges(node.id)) {
        if (edge.relation !== 'imports' && edge.relation !== 're_exports' && edge.relation !== 're_exports_ns') continue
        if (!edge.targetId) {
          suspected.push({
            nodeId: edge.sourceId,
            adapter: 'context_expansion',
            reason: 'unmatched_routing_file',
            contextHint: 'file',
          })
          continue
        }

        const target = input.graph.getNode(edge.targetId)
        if (!target) continue
        const isReExport = edge.relation === 're_exports' || edge.relation === 're_exports_ns'
        const nextImportDepth = isReExport ? current.importDepth : current.importDepth + 1
        const nextReExportDepth = isReExport ? current.reExportDepth + 1 : current.reExportDepth
        if (nextImportDepth > limits.maxImportDepth || nextReExportDepth > limits.maxReExportDepth) continue
        if (seenFiles.has(target.filePath) || shouldIgnoreSourceFile(target.filePath)) continue

        const source = readSourceFile(input.repoPath, target.filePath, limits.maxSourceBytesPerFile)
        if (!source) continue
        relatedFiles.push(source)
        seenFiles.add(target.filePath)
        queue.push({ filePath: target.filePath, importDepth: nextImportDepth, reExportDepth: nextReExportDepth })
        collectFileNodeIds(input.graph.nodesByFile(target.filePath), seenNodeIds, relatedNodeIds)
        if (relatedFiles.length >= limits.maxRelatedFiles) break
      }
      if (relatedFiles.length >= limits.maxRelatedFiles) break
    }
  }

  return {
    bundle: {
      rootFile: rootFile ?? { filePath: input.rootFilePath, source: '', fileNodeId: input.rootFilePath },
      relatedFiles,
      relatedNodeIds,
      reason: input.reason,
    },
    suspected,
    diagnostics: {
      relatedFiles: relatedFiles.length,
      relatedNodeIds: relatedNodeIds.length,
      suspected: suspected.length,
    },
  }
}

function collectFileNodeIds(nodes: CodeNode[], seen: Set<string>, out: string[]): void {
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    seen.add(node.id)
    out.push(node.id)
  }
}

function readSourceFile(repoPath: string, filePath: string, maxBytes: number): SourceFileContext | null {
  if (shouldIgnoreSourceFile(filePath)) return null
  const fullPath = join(repoPath, normalize(filePath))
  let fd: number | null = null
  try {
    fd = openSync(fullPath, 'r')
    const size = Math.min(fstatSync(fd).size, maxBytes)
    const buffer = Buffer.alloc(size)
    const bytesRead = readSync(fd, buffer, 0, size, 0)
    return {
      filePath,
      source: buffer.subarray(0, bytesRead).toString('utf8'),
      fileNodeId: filePath,
    }
  /* v8 ignore next -- platform-specific read errors vary; missing/ignored roots are covered behaviorally. */
  } catch {
    return null
  /* v8 ignore next 3 -- fd-closing branch depends on OS-specific post-open read errors. */
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function shouldIgnoreSourceFile(filePath: string): boolean {
  const normalized = normalize(filePath).replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (normalized === '.env' || normalized.includes('/.env')) return true
  if (/(^|\/)([^/]*(secret|credential|private_key|api_key)[^/]*)$/i.test(normalized)) return true
  return parts.some((part, index) => {
    if (['node_modules', '.next', 'build', 'dist', 'coverage', 'generated', 'vendor'].includes(part)) return true
    if (part === 'Pods' && parts[index - 1] === 'ios') return true
    /* v8 ignore next -- 'build' is already handled as a generic generated directory above. */
    return part === 'build' && parts[index - 1] === 'android'
  })
}
