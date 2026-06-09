/**
 * F6: persistGraph — DB 저장 (DELETE → INSERT, 멱등) — V2 Drizzle
 * SOT: specs/build_graph/architecture.md §4.3
 *
 * 변환 (V1 대비):
 *   - DbAdapter raw SQL → Drizzle (sync, better-sqlite3)
 *   - projects.status UPDATE 폐기 (orchestrator S8에서 phase_status UPSERT)
 *   - dangling doc_deps 정리 폐기 (M7 책임)
 *   - runStepFn → optional callback (orchestrator가 ctx.emit으로 연결)
 *
 * 트랜잭션 흐름:
 *   PRAGMA foreign_keys = OFF → tx(DELETE edges → DELETE nodes → INSERT nodes → INSERT edges) → ON
 *   외부 산출물 FK 보호용 PRAGMA (doc_deps 등).
 */
import { eq, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import type { CodeNodeRaw, CodeEdgeRaw, UpsertStats, RunStepFn } from './types.js'

// Drizzle better-sqlite3 트랜잭션 콜백 인자 타입.
// db.transaction((tx) => { ... }) 의 tx는 DB 자체와 거의 동일한 인터페이스 (insert/delete/update 사용 가능).
// 단순화: Pick<DB, 'insert' | 'delete' | 'update' | 'select'>로 받음.
type Tx = Pick<DB, 'insert' | 'delete' | 'update' | 'select'>

// ── 내부 상수 ──
export const BATCH_SIZE = 500

// ── 서브함수 ──

/**
 * 잔류 pending edge → failed 강제 변환 + 선택적 진행 로그.
 * 트랜잭션 밖에서 실행. 입력 edges 비변형 (얕은 복사).
 */
export async function convertPendingToFailed(
  edges: CodeEdgeRaw[],
  repoId: string,
  runStepFn?: RunStepFn,
): Promise<{ edges: CodeEdgeRaw[]; convertedCount: number }> {
  let convertedCount = 0
  const samples: Array<Pick<CodeEdgeRaw, 'source_id' | 'relation' | 'target_specifier' | 'target_symbol'>> = []
  const result: CodeEdgeRaw[] = new Array(edges.length)

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    if (edge.resolve_status !== 'pending') {
      result[i] = edge
      continue
    }
    convertedCount++
    if (samples.length < 5) {
      samples.push({
        source_id: edge.source_id,
        relation: edge.relation,
        target_specifier: edge.target_specifier,
        target_symbol: edge.target_symbol,
      })
    }
    result[i] = { ...edge, resolve_status: 'failed' }
  }

  if (convertedCount > 0 && runStepFn) {
    await runStepFn({
      phase: 'build_graph',
      step: 'F6:pendingResidual',
      repoId,
      meta: { convertedCount, samples },
    })
  }

  return { edges: result, convertedCount }
}

/** 8-tuple key 기반 JS-level dedup (순수 함수).
 *  chain_path 포함 — receiver(예: prismaClient.resetToken vs prismaClient.refreshToken)만
 *  다른 calls edge 는 db_access 대상 테이블이 다른 별개 edge 이므로 병합하면 안 된다. */
export function deduplicateEdges(edges: CodeEdgeRaw[]): CodeEdgeRaw[] {
  const edgeMap = new Map<string, CodeEdgeRaw>()
  for (const edge of edges) {
    const key = [
      edge.source_id,
      edge.target_id ?? '',
      edge.relation,
      edge.target_specifier ?? '',
      edge.target_symbol ?? '',
      edge.first_arg ?? '',
      edge.literal_args ?? '',
      edge.chain_path ?? '',
    ].join('\x00')
    if (!edgeMap.has(key)) edgeMap.set(key, edge)
  }
  return Array.from(edgeMap.values())
}

/** 트랜잭션 내 sync — 기존 repo의 edges, nodes 삭제 (FK 순서) */
export function deleteExisting(tx: Tx, repoId: string): void {
  tx.delete(codeEdges).where(eq(codeEdges.repoId, repoId)).run()
  tx.delete(codeNodes).where(eq(codeNodes.repoId, repoId)).run()
}

/** 트랜잭션 내 sync — nodes 500단위 INSERT */
export function batchInsertNodes(tx: Tx, nodes: CodeNodeRaw[]): number {
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE)
    const values = batch.map((node) => ({
      id: node.id,
      repoId: node.repo_id,
      type: node.type,
      filePath: node.file_path,
      name: node.name,
      lineStart: node.line_start,
      lineEnd: node.line_end,
      normalizedCodeHash: node.normalized_code_hash ?? null,
      parentNodeId: node.parent_node_id ?? null,
      originKind: node.origin_kind ?? null,
      role: node.role ?? null,
      signature: node.signature,
      exported: node.exported,
      isDefaultExport: node.is_default_export ?? false,
      isAsync: node.is_async,
      isTest: node.is_test,
      testType: node.test_type,
      docComment: node.jsdoc,
      parseStatus: node.parse_status,
    }))
    tx.insert(codeNodes).values(values).run()
  }
  return nodes.length
}

/** 트랜잭션 내 sync — edges 500단위 INSERT OR IGNORE */
export function batchInsertEdges(tx: Tx, edges: CodeEdgeRaw[]): number {
  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE)
    const values = batch.map((edge) => ({
      repoId: edge.repo_id,
      sourceId: edge.source_id,
      targetId: edge.target_id,
      relation: edge.relation,
      targetSpecifier: edge.target_specifier,
      targetSymbol: edge.target_symbol,
      typeRefSubtype: edge.type_ref_subtype ?? null,
      chainPath: edge.chain_path ?? null,
      firstArg: edge.first_arg ?? null,
      literalArgs: edge.literal_args ?? null,
      argExpressions: edge.arg_expressions ?? null,
      // 'n/a'는 V2 enum에 없음 — convertPendingToFailed 후엔 'pending/resolved/external/failed'만
      resolveStatus: (edge.resolve_status === 'n/a' ? 'failed' : edge.resolve_status) as
        | 'pending' | 'resolved' | 'external' | 'failed',
      confidence: edge.confidence ?? null,
      source: edge.source ?? 'static',
    }))
    tx.insert(codeEdges).values(values).onConflictDoNothing().run()
  }
  return edges.length
}

// ── 오케스트레이터 ──

/**
 * F6 본체 — DELETE → INSERT 멱등.
 *   1. pending → failed (트랜잭션 밖)
 *   2. 7-tuple dedup (순수)
 *   3. PRAGMA OFF → tx(DELETE → INSERT) → ON
 *   4. SELECT count → 실제 반영 edge 수
 */
export async function persistGraph(
  repoId: string,
  nodes: CodeNodeRaw[],
  edges: CodeEdgeRaw[],
  db: DB,
  runStepFn?: RunStepFn,
  onProgress?: (meta: Record<string, unknown>) => void,
): Promise<UpsertStats> {
  const { edges: convertedEdges } = await convertPendingToFailed(edges, repoId, runStepFn)
  const dedupedEdges = deduplicateEdges(convertedEdges)
  emitPersistProgress(onProgress, {
    unit: 'steps',
    completed: 1,
    total: 4,
    currentLabel: 'deduplicate',
    nodes: nodes.length,
    edges: dedupedEdges.length,
  })

  db.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    db.transaction((tx) => {
      deleteExisting(tx, repoId)
      emitPersistProgress(onProgress, { unit: 'steps', completed: 2, total: 4, currentLabel: 'delete_existing' })
      batchInsertNodes(tx, nodes)
      emitPersistProgress(onProgress, { unit: 'nodes', completed: nodes.length, total: nodes.length, currentLabel: 'insert_nodes' })
      batchInsertEdges(tx, dedupedEdges)
      emitPersistProgress(onProgress, { unit: 'edges', completed: dedupedEdges.length, total: dedupedEdges.length, currentLabel: 'insert_edges' })
    })
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`)
  }

  const row = db
    .select({ cnt: sql<number>`count(*)` })
    .from(codeEdges)
    .where(eq(codeEdges.repoId, repoId))
    .get()
  /* v8 ignore next -- SQLite count(*) always returns one row; fallback is defensive. */
  const edgesCount = row?.cnt ?? 0

  return {
    nodes_count: nodes.length,
    edges_count: edgesCount,
  }
}

function emitPersistProgress(
  onProgress: ((meta: Record<string, unknown>) => void) | undefined,
  meta: Record<string, unknown>,
): void {
  try {
    onProgress?.(meta)
  } catch { /* progress logging must not affect graph persistence */ }
}
