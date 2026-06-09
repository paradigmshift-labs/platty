import { existsSync, readFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'

import type {
  SourceRouteAdapter,
  SourceRouteAdapterRunResult,
  SourceRouteContext,
} from '../types.js'

export function createSourceRouteContext(
  input: Omit<SourceRouteContext, 'sourceFiles' | 'readSource'>,
): SourceRouteContext {
  const fileNodes = input.graphNodes
    .filter((node) => node.type === 'file')
    .sort((a, b) => a.filePath.localeCompare(b.filePath))

  const sourceFiles = fileNodes.map((node) => ({
    filePath: node.filePath,
    fileNodeId: node.id,
    source: readSourceFromRepo(input.repoPath, node.filePath) ?? '',
  }))

  const sourceByPath = new Map(sourceFiles.map((file) => [file.filePath, file.source]))

  return {
    ...input,
    sourceFiles,
    readSource(filePath: string): string | null {
      /* v8 ignore next -- sourceByPath values are always strings; fallback is defensive. */
      if (sourceByPath.has(filePath)) return sourceByPath.get(filePath) ?? ''
      return readSourceFromRepo(input.repoPath, filePath)
    },
  }
}

export function runSourceRouteAdapters(
  ctx: SourceRouteContext,
  adapters: SourceRouteAdapter[],
): SourceRouteAdapterRunResult {
  const detections = []
  const entryPoints = []

  for (const adapter of adapters) {
    const detection = adapter.detect(ctx)
    detections.push(detection)
    if (!detection.active) continue
    entryPoints.push(...adapter.extract(ctx, detection))
  }

  return {
    entryPoints,
    detections,
    diagnostics: {
      adaptersTotal: adapters.length,
      adaptersActive: detections.filter((detection) => detection.active).length,
      entries: entryPoints.length,
    },
  }
}

function readSourceFromRepo(repoPath: string, filePath: string): string | null {
  const abs = joinPath(repoPath, filePath)
  if (!existsSync(abs)) return null
  return readFileSync(abs, 'utf-8')
}
