import { and, eq, isNull, type AnyColumn, type SQL } from 'drizzle-orm'

/**
 * Soft delete 컬럼(`deleted_at`) NULL 검사 헬퍼.
 *
 * 사용:
 *   db.select().from(documents).where(notDeleted(documents.deletedAt))
 */
export const notDeleted = (col: AnyColumn) => isNull(col)

export const aliveById = (idCol: AnyColumn, deletedCol: AnyColumn, id: string): SQL =>
  and(eq(idCol, id), isNull(deletedCol)) as SQL
