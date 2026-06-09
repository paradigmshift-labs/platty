// F6: persistCodeRelations — DB transaction replace
// SOT: specs/build_relations/architecture.md §4 F6

import { eq } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeRelations, type NewCodeRelation } from '@/db/schema/build_relations.js'
import type { NormalizedCodeRelation, BuildRelationsResult } from './types.js'
import { makeRelationId } from './normalize_relations.js'

export async function persistCodeRelations(
  db: DB,
  repoId: string,
  relations: NormalizedCodeRelation[],
): Promise<BuildRelationsResult> {
  db.transaction((tx) => {
    tx.delete(codeRelations).where(eq(codeRelations.repoId, repoId)).run()

    for (const rel of relations) {
      const row: NewCodeRelation = {
        id: makeRelationId(repoId, rel),
        repoId,
        sourceNodeId: rel.sourceNodeId,
        kind: rel.kind,
        target: rel.target,
        operation: rel.operation,
        canonicalTarget: rel.canonicalTarget,
        payload: rel.payload,
        evidenceNodeIds: rel.evidenceNodeIds,
        confidence: rel.confidence,
        unresolvedReason: rel.unresolvedReason ?? null,
      }
      tx.insert(codeRelations).values(row).run()
    }
  })

  const byKind: Record<string, number> = {}
  for (const rel of relations) {
    byKind[rel.kind] = (byKind[rel.kind] ?? 0) + 1
  }

  return { relationsCount: relations.length, byKind }
}
