// f6 persistResults — entry_points + framework_detections UPSERT.
// SOT: specs/build_route/specs/f6_persist_results/spec.md
//
// minimal (Step 9 a). 후속:
//   - code_bundles UPSERT (Step 8 reachability 완료 후)
//   - routes / route_entries 동기화 (옵션 A — migration.md)
//   - stale row 청소

import { eq, inArray, sql } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import {
  codeBundles,
  entryPoints as entryPointsTable,
  frameworkDetections as detectionsTable,
} from '@/db/schema/build_route.js'
import { makeEntryPointId } from '@/pipeline_modules/shared/id_builders.js'
import { routeSourceAttribution } from '@/pipeline_modules/shared/static_config/source_attribution.js'
import type {
  EntryPointDraft,
  FrameworkDetectionResult,
} from './types.js'

export interface PersistResultsInput {
  db: DB
  repoId: string
  detections: FrameworkDetectionResult[]
  entryPoints: EntryPointDraft[]
  /** code_bundles INSERT (entry_point_id → reachable node_ids). f5 결과. */
  bundles?: Array<{ entryPointId: string; nodeId: string; depth: number; edgePath?: string[] }>
}

export async function persistResults(input: PersistResultsInput): Promise<void> {
  const { db, repoId } = input

  db.transaction((tx) => {
    const currentEntryPointIds = input.entryPoints.map((ep) => makeEntryPointId(repoId, ep))
    const existingEntryPointIds = tx
      .select({ id: entryPointsTable.id })
      .from(entryPointsTable)
      .where(eq(entryPointsTable.repoId, repoId))
      .all()
      .map((row) => row.id)

    const staleEntryPointIds = existingEntryPointIds.filter((id) => !currentEntryPointIds.includes(id))
    for (const chunk of chunked(staleEntryPointIds, 999)) {
      tx.delete(codeBundles).where(inArray(codeBundles.entryPointId, chunk)).run()
      tx.delete(entryPointsTable).where(inArray(entryPointsTable.id, chunk)).run()
    }

    // ── framework_detections UPSERT ──
    for (const det of input.detections) {
      tx.insert(detectionsTable)
        .values({
          repoId,
          framework: det.framework,
          detectedVia: det.detectedVia,
          evidence: det.evidence,
          active: det.active,
        })
        .onConflictDoUpdate({
          target: [detectionsTable.repoId, detectionsTable.framework],
          set: {
            detectedVia: det.detectedVia,
            evidence: det.evidence,
            active: det.active,
            detectedAt: sql`(datetime('now'))`,
          },
        })
        .run()
    }

    // ── entry_points UPSERT ──
    for (const ep of input.entryPoints) {
      const id = makeEntryPointId(repoId, ep)
      const metadata = withRouteSourceAttribution(ep.metadata, ep.detectionSource)
      tx.insert(entryPointsTable)
        .values({
          id,
          repoId,
          framework: ep.framework,
          kind: ep.kind,
          httpMethod: ep.httpMethod ?? null,
          path: ep.path ?? null,
          parentPath: ep.parentPath ?? null,
          fullPath: ep.fullPath ?? null,
          handlerNodeId: ep.handlerNodeId,
          metadata,
          detectionSource: ep.detectionSource,
          confidence: ep.confidence,
          detectionEvidence: ep.detectionEvidence as unknown as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: entryPointsTable.id,
          set: {
            path: ep.path ?? null,
            parentPath: ep.parentPath ?? null,
            metadata,
            detectionSource: ep.detectionSource,
            confidence: ep.confidence,
            detectionEvidence: ep.detectionEvidence as unknown as Record<string, unknown>,
          },
        })
        .run()
    }

    // ── code_bundles REPLACE (옵션) ──
    if (input.bundles) {
      for (const chunk of chunked(currentEntryPointIds, 999)) {
        tx.delete(codeBundles).where(inArray(codeBundles.entryPointId, chunk)).run()
      }
    }

    if (input.bundles && input.bundles.length > 0) {
      for (const b of input.bundles) {
        tx.insert(codeBundles)
          .values({
            entryPointId: b.entryPointId,
            nodeId: b.nodeId,
            depth: b.depth,
            edgePath: b.edgePath,
          })
          .onConflictDoUpdate({
            target: [codeBundles.entryPointId, codeBundles.nodeId],
            set: { depth: b.depth, edgePath: b.edgePath },
          })
          .run()
      }
    }
  })
}

function withRouteSourceAttribution(
  metadata: Record<string, unknown>,
  detectionSource: string,
): Record<string, unknown> {
  const source = routeSourceAttribution({ metadata, detectionSource })
  return source ? { ...metadata, source } : metadata
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
