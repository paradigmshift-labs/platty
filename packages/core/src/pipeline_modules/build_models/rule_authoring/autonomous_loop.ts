// build_models/rule_authoring — the autonomous loop: scan a repo for ORM packages no build_models adapter
// covers, have an agent author a declarative graph-query spec for each, run the deterministic referee, and
// auto-promote the passers. Mirrors build_relations' autonomous_loop. The author is pluggable (real = an
// LLM agent; tests = a stub), so the orchestration is deterministic + testable.

import { eq, and } from 'drizzle-orm'
import type { DB } from '@/db/client.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { evaluateModelAdapterForPromotion, type ModelAdapterPromotionResult } from './promote_gate.js'
import type { ModelAdapterSpec, ModelShape } from './types.js'

/** An imported package that no build_models adapter covers, found in files that also declare decorated classes. */
export interface ModelAdapterGap {
  packageSpecifier: string
  files: string[]
  /** distinct decorator names seen on classes in the importing files (head start for the author). */
  classDecoratorHints: string[]
}

/**
 * Detect imported packages with no adapter, restricted to packages whose importing files contain decorated
 * classes (a decorator-ORM signal — keeps the gap list to plausible entity ORMs, not every import).
 */
export function findModelAdapterGaps(db: DB, repoId: string, knownPackages: Set<string>): ModelAdapterGap[] {
  const importEdges = db
    .select({ sourceId: codeEdges.sourceId, spec: codeEdges.targetSpecifier })
    .from(codeEdges)
    .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.relation, 'imports')))
    .all()

  // file (node id) → its filePath
  const fileNodes = db
    .select({ id: codeNodes.id, filePath: codeNodes.filePath })
    .from(codeNodes)
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'file')))
    .all()
  const pathById = new Map(fileNodes.map((f) => [f.id, f.filePath]))

  // class nodes + their decorator names (class decorators only)
  const classDecorEdges = db
    .select({ sourceId: codeEdges.sourceId, sym: codeEdges.targetSymbol })
    .from(codeEdges)
    .innerJoin(codeNodes, eq(codeNodes.id, codeEdges.sourceId))
    .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.relation, 'decorates'), eq(codeNodes.type, 'class')))
    .all()
  const classNodeRows = db
    .select({ id: codeNodes.id, filePath: codeNodes.filePath })
    .from(codeNodes)
    .where(and(eq(codeNodes.repoId, repoId), eq(codeNodes.type, 'class')))
    .all()
  const fileOfClass = new Map(classNodeRows.map((c) => [c.id, c.filePath]))
  const decoratorsByFile = new Map<string, Set<string>>()
  for (const e of classDecorEdges) {
    const fp = fileOfClass.get(e.sourceId)
    if (!fp || !e.sym) continue
    if (!decoratorsByFile.has(fp)) decoratorsByFile.set(fp, new Set())
    decoratorsByFile.get(fp)!.add(e.sym)
  }

  const byPkg = new Map<string, { files: Set<string>; decorators: Set<string> }>()
  for (const edge of importEdges) {
    const spec = edge.spec
    if (!spec || knownPackages.has(spec)) continue
    const fp = pathById.get(edge.sourceId)
    if (!fp) continue
    const decs = decoratorsByFile.get(fp)
    if (!decs || decs.size === 0) continue // require a decorated-class signal in the importing file
    if (!byPkg.has(spec)) byPkg.set(spec, { files: new Set(), decorators: new Set() })
    const entry = byPkg.get(spec)!
    entry.files.add(fp)
    for (const d of decs) entry.decorators.add(d)
  }

  return [...byPkg.entries()].map(([packageSpecifier, v]) => ({
    packageSpecifier,
    files: [...v.files],
    classDecoratorHints: [...v.decorators],
  }))
}

export interface ModelRuleAuthorContext {
  db: DB
  repoId: string
}

/** An authored spec plus the anchor it should be graded against (a representative seeded graph + expected). */
export interface AuthoredModelAdapter {
  spec: ModelAdapterSpec
  anchorDb: DB
  anchorRepoId: string
  anchorExpected: ModelShape[]
}

export type ModelRuleAuthor = (gap: ModelAdapterGap, ctx: ModelRuleAuthorContext) => Promise<AuthoredModelAdapter | null>

export interface ModelDiscoveryInput {
  db: DB
  repoId: string
  knownPackages: string[]
  knownRuleIds: string[]
  /** other-ORM repos for the referee's cross-clean check. */
  foreign: Array<{ fixture: string; db: DB; repoId: string }>
  authorCandidate: ModelRuleAuthor
}

export interface ModelDiscoveryResult {
  gaps: ModelAdapterGap[]
  promoted: ModelAdapterSpec[]
  rejected: Array<{ ruleId: string; reason: string }>
}

export async function runModelAdapterDiscovery(input: ModelDiscoveryInput): Promise<ModelDiscoveryResult> {
  const gaps = findModelAdapterGaps(input.db, input.repoId, new Set(input.knownPackages))
  const promoted: ModelAdapterSpec[] = []
  const rejected: Array<{ ruleId: string; reason: string }> = []
  const knownIds = new Set(input.knownRuleIds)

  for (const gap of gaps) {
    const authored = await input.authorCandidate(gap, { db: input.db, repoId: input.repoId })
    if (!authored) continue
    const id = authored.spec.id
    if (knownIds.has(id)) {
      rejected.push({ ruleId: id, reason: 'duplicate_id' })
      continue
    }
    const verdict: ModelAdapterPromotionResult = await evaluateModelAdapterForPromotion({
      candidate: authored.spec,
      anchorDb: authored.anchorDb,
      anchorRepoId: authored.anchorRepoId,
      anchorExpected: authored.anchorExpected,
      foreign: input.foreign,
    })
    if (verdict.promote) {
      promoted.push(authored.spec)
      knownIds.add(id)
    } else {
      rejected.push({ ruleId: id, reason: verdict.reason })
    }
  }

  return { gaps, promoted, rejected }
}
