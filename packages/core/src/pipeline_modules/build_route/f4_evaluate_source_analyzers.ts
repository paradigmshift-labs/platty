import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  AnalyzerContext,
  AnalyzerResult,
  BuildRouteAnalyzerAdapter,
  SourceFileContext,
} from './types.js'

export interface RunAnalyzerAdaptersInput {
  ctx: AnalyzerContext
  analyzers: BuildRouteAnalyzerAdapter[]
  readFile?: (filePath: string) => string | null
}

export function runAnalyzerAdapters(input: RunAnalyzerAdaptersInput): AnalyzerResult {
  const entryPoints: AnalyzerResult['entryPoints'] = []
  const suspected: AnalyzerResult['suspected'] = []
  const diagnostics: Record<string, number> = {}
  const sourceCache = new Map<string, SourceFileContext | null>()

  for (const analyzer of input.analyzers) {
    let applies = false
    try {
      applies = analyzer.appliesTo(input.ctx)
    } catch {
      increment(diagnostics, `${analyzer.name}.errors`)
      continue
    }
    if (!applies) continue

    let candidateFiles: string[]
    try {
      candidateFiles = [...new Set(analyzer.candidateFiles(input.ctx))].sort()
    } catch {
      increment(diagnostics, `${analyzer.name}.errors`)
      continue
    }
    if (candidateFiles.length === 0) {
      increment(diagnostics, `${analyzer.name}.emptyCandidates`)
      continue
    }

    for (const filePath of candidateFiles) {
      const file = getSourceFile(input, filePath, sourceCache)
      if (!file) continue
      try {
        const result = analyzer.analyzeFile(file, input.ctx)
        entryPoints.push(...result.entryPoints)
        suspected.push(...result.suspected)
        for (const [key, value] of Object.entries(result.diagnostics)) {
          diagnostics[`${analyzer.name}.${key}`] = (diagnostics[`${analyzer.name}.${key}`] ?? 0) + value
        }
      } catch {
        increment(diagnostics, `${analyzer.name}.errors`)
      }
    }
  }

  diagnostics.filesRead = [...sourceCache.values()].filter(Boolean).length
  return { entryPoints, suspected, diagnostics }
}

function getSourceFile(
  input: RunAnalyzerAdaptersInput,
  filePath: string,
  cache: Map<string, SourceFileContext | null>,
): SourceFileContext | null {
  /* v8 ignore next -- has()+get() only falls back for non-standard Map implementations. */
  if (cache.has(filePath)) return cache.get(filePath) ?? null

  const source = input.readFile
    ? input.readFile(filePath)
    : readFileFromRepo(input.ctx.repoPath, filePath)
  if (source === null) {
    cache.set(filePath, null)
    return null
  }

  const fileNode = input.ctx.graph.nodesByFile(filePath).find((node) => node.type === 'file')
  const file = { filePath, source, fileNodeId: fileNode?.id ?? filePath }
  cache.set(filePath, file)
  return file
}

function readFileFromRepo(repoPath: string, filePath: string): string | null {
  try {
    return readFileSync(join(repoPath, filePath), 'utf-8')
  } catch {
    return null
  }
}

function increment(diagnostics: Record<string, number>, key: string): void {
  diagnostics[key] = (diagnostics[key] ?? 0) + 1
}
