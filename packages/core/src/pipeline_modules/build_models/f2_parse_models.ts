import path from 'path'
import fs from 'fs'
import type { LoadedSource, ModelRaw, SchemaFile } from './types.js'
import type { SchemaSource } from '@/db/schema/json_types/schema_source.js'
import type { DB } from '@/db/client.js'

export async function parseModels(
  loaded: LoadedSource[],
  db: DB,
  repoId: string,
  repoPath: string,
  signal?: AbortSignal,
): Promise<{
  bySource: Array<{ source: SchemaSource; models: ModelRaw[] }>
  skippedFiles: string[]
}> {
  if (loaded.length === 0) return { bySource: [], skippedFiles: [] }

  let bySource: Array<{ source: SchemaSource; models: ModelRaw[] }> = []
  const skippedFiles: string[] = []
  const seenNames = new Set<string>()
  let totalCount = 0

  for (const loadedSource of loaded) {
    if (signal?.aborted) break

    try {
      let rawModels: ModelRaw[]

      if (loadedSource.strategy === 'dsl-parse') {
        rawModels = await runDslParse(loadedSource, skippedFiles, repoPath)
      } else {
        rawModels = await loadedSource.adapter.queryFromGraph!(db, repoId)
      }

      const sourceModels: ModelRaw[] = []
      for (const model of rawModels) {
        if (seenNames.has(model.name)) {
          console.warn(`[F2] duplicate model '${model.name}' from '${loadedSource.source.orm}', skipping`)
          continue
        }
        seenNames.add(model.name)
        sourceModels.push(model)
        totalCount++
      }

      bySource.push({ source: loadedSource.source, models: sourceModels })
    } catch (err) {
      const paths = loadedSource.absolutePaths.length > 0
        ? loadedSource.absolutePaths.map(p => path.relative(repoPath, p))
        : [`[${loadedSource.source.orm}:graph-query]`]
      skippedFiles.push(...paths)
      console.warn(`[F2] failed to parse ${loadedSource.source.orm}: ${(err as Error).message}`)
    }
  }

  if (totalCount > 500) {
    console.warn(`[F2] model count ${totalCount} exceeds 500, truncating`)
    let remaining = 500
    bySource = bySource
      .map(entry => ({
        ...entry,
        models: (() => {
          if (remaining <= 0) return []
          const kept = entry.models.slice(0, remaining)
          remaining -= kept.length
          return kept
        })(),
      }))
      .filter(entry => entry.models.length > 0)
    skippedFiles.push('__truncated__')
  }

  return { bySource, skippedFiles }
}

async function runDslParse(
  loadedSource: LoadedSource,
  skippedFiles: string[],
  repoPath: string,
): Promise<ModelRaw[]> {
  await loadedSource.adapter.ensureReady?.()

  const schemaFiles: SchemaFile[] = []
  const localSkipped: string[] = []

  for (const absPath of loadedSource.absolutePaths) {
    try {
      const content = fs.readFileSync(absPath, 'utf-8')
      schemaFiles.push({ path: absPath, content })
    } catch {
      localSkipped.push(path.relative(repoPath, absPath))
    }
  }

  if (schemaFiles.length === 0) {
    // 모든 파일 읽기 실패 → outer catch가 absolutePaths를 skippedFiles에 추가
    throw new Error(`No schema files could be read for ${loadedSource.source.orm}`)
  }

  // 일부 파일 실패: 이미 읽은 파일들로 계속 진행, 실패 파일은 skippedFiles에 추가
  skippedFiles.push(...localSkipped)

  const ctx = loadedSource.adapter.collectNames!(schemaFiles)
  const chunks = loadedSource.adapter.prepareChunks!(schemaFiles)

  const results: ModelRaw[] = []
  for (const chunk of chunks) {
    const parsed = await loadedSource.adapter.parseChunk!(chunk, ctx)
    results.push(...parsed)
  }

  return results
}
