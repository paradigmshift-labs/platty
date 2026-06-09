/**
 * F7: validateGraph — 그래프 무결성 검증 (V2 Drizzle)
 * SOT: specs/build_graph/architecture.md §4.4
 *
 * V1 패턴 유지:
 *   - throw 금지: 검증 실패는 valid=false + warnings로만 기록
 *   - DB 오류 시 best-effort
 *
 * 변환:
 *   - DbAdapter raw SQL → Drizzle (sync better-sqlite3)
 *   - project_id → repo_id
 */
import { eq, and, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import type { ValidationResult } from './types.js'

// ── 임계값 (Q7 — V1 그대로) ──
export const PARSE_ERROR_RATIO_THRESHOLD = 0.10
export const UNRESOLVED_RATIO_THRESHOLD = 0.30

// ── 서브함수 ──

/** pending 0 검증 — DB 오류 시 0 (best-effort, throw 금지). */
export function assertPendingZero(repoId: string, db: DB): number {
  try {
    const row = db
      .select({ cnt: sql<number>`count(*)` })
      .from(codeEdges)
      .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.resolveStatus, 'pending')))
      .get()
    /* v8 ignore next -- SQLite count(*) always returns one row; fallback is defensive. */
    return row?.cnt ?? 0
  } catch {
    return 0
  }
}

/** file 노드 ≥ 1 확인 */
export function checkFileNodeCount(repoId: string, db: DB): { count: number; valid: boolean } {
  const row = db
    .select({ cnt: sql<number>`count(*)` })
    .from(codeNodes)
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'file')))
    .get()
  /* v8 ignore next -- SQLite count(*) always returns one row; fallback is defensive. */
  const count = row?.cnt ?? 0
  return { count, valid: count >= 1 }
}

/** failed/total edge 비율 경고 */
export function checkUnresolvedRatio(
  repoId: string,
  db: DB,
): { ratio: number; failed: number; total: number; warning: string | null } {
  const rows = db
    .select({ resolveStatus: codeEdges.resolveStatus, cnt: sql<number>`count(*)` })
    .from(codeEdges)
    .where(eq(codeEdges.repoId, repoId))
    .groupBy(codeEdges.resolveStatus)
    .all()

  let total = 0
  let failed = 0
  for (const r of rows) {
    total += r.cnt
    if (r.resolveStatus === 'failed') failed += r.cnt
  }

  if (total === 0) return { ratio: 0, failed: 0, total: 0, warning: null }

  const ratio = failed / total
  const warning =
    ratio > UNRESOLVED_RATIO_THRESHOLD
      ? `해석 실패 edge 비율 ${(ratio * 100).toFixed(1)}% (${failed}/${total}) — 임계 ${UNRESOLVED_RATIO_THRESHOLD * 100}% 초과`
      : null

  return { ratio, failed, total, warning }
}

// ── 오케스트레이터 ──

/**
 * F7 — 그래프 무결성 검증 (throw 금지).
 *
 * warnings 순서: pending → file → parse → unresolved
 * valid=false 조건: pending > 0 / file 노드 0개 / repoId 비어있음
 */
export function validateGraph(
  repoId: string,
  totalFiles: number,
  parseErrorCount: number,
  db: DB,
): ValidationResult & { pending_edges: number } {
  if (!repoId || repoId.trim() === '') {
    return { valid: false, warnings: ['repoId is empty'], pending_edges: 0 }
  }

  try {
    const warnings: string[] = []
    let valid = true

    const pendingCount = assertPendingZero(repoId, db)
    if (pendingCount > 0) {
      valid = false
      warnings.push(`pending edge ${pendingCount}건 잔류 (F6 강제 변환 누락)`)
    }

    const { count: fileNodeCount, valid: fileValid } = checkFileNodeCount(repoId, db)
    if (!fileValid) {
      valid = false
      warnings.push(`file 노드 0개 (실제 count=${fileNodeCount})`)
    }

    if (totalFiles > 0) {
      const parseRatio = parseErrorCount / totalFiles
      if (parseRatio > PARSE_ERROR_RATIO_THRESHOLD) {
        warnings.push(
          `파싱 실패율 ${(parseRatio * 100).toFixed(1)}% (${parseErrorCount}/${totalFiles}) — 임계 ${PARSE_ERROR_RATIO_THRESHOLD * 100}% 초과`,
        )
      }
    }

    const { warning: unresolvedWarning } = checkUnresolvedRatio(repoId, db)
    if (unresolvedWarning !== null) warnings.push(unresolvedWarning)

    return { valid, warnings, pending_edges: pendingCount }
  } catch {
    return { valid: false, warnings: [], pending_edges: 0 }
  }
}
