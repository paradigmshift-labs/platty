import { eq, and, inArray, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { models as modelsTable } from '@/db/schema/build_models.js'
import type { ModelRaw } from './types.js'
import { AbortError, PipelineError } from '@/infra/errors.js'

export function toModelId(repoId: string, modelName: string): string {
  return `${repoId}:${modelName}`
}

function chunked<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

export async function orphanModelsForRepo(
  db: DB,
  repoId: string,
  commit: string | null,
  runIdOrSignal?: string | null | AbortSignal,
  signalArg?: AbortSignal,
): Promise<{ orphaned: number }> {
  const signal = typeof runIdOrSignal === 'object' ? runIdOrSignal : signalArg
  if (signal?.aborted) throw new AbortError('Aborted')

  const existingIds = db
    .select({ id: modelsTable.id })
    .from(modelsTable)
    .where(eq(modelsTable.repositoryId, repoId))
    .all()
    .map(row => row.id)

  if (existingIds.length > 0) {
    for (const chunk of chunked(existingIds, 999)) {
      db.update(modelsTable)
        .set({ validity: 'orphaned', updatedAt: sql`(datetime('now'))` })
        .where(inArray(modelsTable.id, chunk))
        .run()
    }
  }

  return { orphaned: existingIds.length }
}

export async function upsertModels(
  db: DB,
  repoId: string,
  orm: string,
  models: ModelRaw[],
  commit: string | null,
  runIdOrSignal?: string | null | AbortSignal,
  signalArg?: AbortSignal,
): Promise<{ upserted: number; orphaned: number }> {
  const signal = typeof runIdOrSignal === 'object' ? runIdOrSignal : signalArg
  if (signal?.aborted) throw new AbortError('Aborted')

  let result: { upserted: number; orphaned: number }
  try {
    const existingRows = db
      .select({ id: modelsTable.id, description: modelsTable.description })
      .from(modelsTable)
      .where(and(
        eq(modelsTable.repositoryId, repoId),
        eq(modelsTable.orm, orm),
      ))
      .all()

    const existingMap = new Map(existingRows.map(r => [r.id, r.description]))

    result = db.transaction((tx) => {
      const currentIds = new Set<string>()

      for (const raw of models) {
        const modelId = toModelId(repoId, raw.name)
        currentIds.add(modelId)
        const existingDescription = existingMap.get(modelId) ?? null

        tx.insert(modelsTable).values({
          id: modelId,
          repositoryId: repoId,
          name: raw.name,
          tableName: raw.table_name,
          comment: raw.comment,
          description: existingDescription,
          fields: raw.fields,
          relations: raw.relations,
          isDeprecated: raw.is_deprecated,
          sourceFile: raw.source_file,
          lineStart: raw.line_start,
          lineEnd: raw.line_end,
          orm,
          builtFromCommit: commit,
          validity: 'fresh',
          updatedAt: sql`(datetime('now'))`,
        }).onConflictDoUpdate({
          target: modelsTable.id,
          set: {
            name: sql`excluded.name`,
            tableName: sql`excluded.table_name`,
            comment: sql`excluded.comment`,
            fields: sql`excluded.fields`,
            relations: sql`excluded.relations`,
            isDeprecated: sql`excluded.is_deprecated`,
            sourceFile: sql`excluded.source_file`,
            lineStart: sql`excluded.line_start`,
            lineEnd: sql`excluded.line_end`,
            orm: sql`excluded.orm`,
            builtFromCommit: sql`excluded.built_from_commit`,
            validity: sql`'fresh'`,
            updatedAt: sql`(datetime('now'))`,
          },
        }).run()
      }

      const orphanedIds = [...existingMap.keys()].filter(id => !currentIds.has(id))

      if (orphanedIds.length > 0) {
        for (const chunk of chunked(orphanedIds, 999)) {
          tx.update(modelsTable)
            .set({ validity: 'orphaned', updatedAt: sql`(datetime('now'))` })
            .where(inArray(modelsTable.id, chunk))
            .run()
        }
      }

      return { upserted: models.length, orphaned: orphanedIds.length }
    })
  } catch (err) {
    if (err instanceof AbortError) throw err
    throw new PipelineError(`upsertModels failed: ${(err as Error).message}`)
  }

  return result
}
