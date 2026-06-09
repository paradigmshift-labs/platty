// build_models/rule_authoring — the promoted graph-query adapter rulebook (MVP persistence = compiled-in,
// mirroring build_relations' promoted_*_rules). The autonomous loop appends referee-passing ModelAdapterSpecs
// here; the registry composer turns each into a GraphQuerySpecAdapter so build_models' normal f1→f2 path
// uses it. Runtime DB persistence is a follow-up (spec §8).

import type { BuildModelsAdapter, LoadedSource } from '../types.js'
import { GraphQuerySpecAdapter } from './graph_query_spec_adapter.js'
import type { ModelAdapterSpec } from './types.js'

/** Referee-promoted specs for ORMs not covered by a hand-written adapter. Empty until the loop promotes any. */
/**
 * Referee-promoted graph-query adapter specs (the declarative form of a decorator ORM). The keystone test
 * re-runs the referee on every entry (each reproduces a representative anchor + stays clean on other ORMs),
 * so a rule arrives tested-by-construction — mirroring build_relations' promoted_*_rules rulebooks. These
 * cover ORMs that ALSO have a hand-written adapter, so composeModelAdapterRegistry strips them (hard-coded
 * wins) at consumption; they serve as faithfulness references + the seed for new-ORM specs the loop promotes.
 */
export const PROMOTED_MODEL_ADAPTERS: ModelAdapterSpec[] = [
  {
    id: 'model.adapter.typeorm', orm: 'typeorm', clientPackages: ['typeorm', '@nestjs/typeorm'],
    entityDecorators: ['Entity', 'ChildEntity'], tableNameArgKey: 'name',
    columnDecorators: ['Column', 'PrimaryColumn', 'PrimaryGeneratedColumn', 'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn', 'VersionColumn'],
    primaryDecorators: ['PrimaryColumn', 'PrimaryGeneratedColumn'],
    relationDecoratorTypes: { OneToMany: 'oneToMany', ManyToOne: 'manyToOne', OneToOne: 'oneToOne', ManyToMany: 'manyToMany' },
  },
  {
    id: 'model.adapter.mikro-orm', orm: 'mikro-orm', clientPackages: ['@mikro-orm/core', 'mikro-orm'],
    entityDecorators: ['Entity'], tableNameArgKey: 'tableName',
    columnDecorators: ['PrimaryKey', 'Property', 'Enum', 'SerializedPrimaryKey'],
    primaryDecorators: ['PrimaryKey', 'SerializedPrimaryKey'],
    relationDecoratorTypes: { OneToMany: 'oneToMany', ManyToOne: 'manyToOne', OneToOne: 'oneToOne', ManyToMany: 'manyToMany' },
  },
]

/** Map each promoted spec to an adapter factory keyed by its orm. */
export function buildPromotedModelAdapterRegistry(
  specs: ModelAdapterSpec[] = PROMOTED_MODEL_ADAPTERS,
): Map<string, () => BuildModelsAdapter> {
  const registry = new Map<string, () => BuildModelsAdapter>()
  for (const spec of specs) {
    registry.set(spec.orm, () => new GraphQuerySpecAdapter(spec))
  }
  return registry
}

/**
 * Compose a base registry (hand-written adapters) with promoted specs. Hand-written adapters win on a name
 * collision — promoted specs only fill ORMs the base doesn't cover.
 */
export function composeModelAdapterRegistry(
  base: Map<string, () => BuildModelsAdapter>,
  specs: ModelAdapterSpec[] = PROMOTED_MODEL_ADAPTERS,
): Map<string, () => BuildModelsAdapter> {
  const composed = new Map(base)
  for (const [orm, factory] of buildPromotedModelAdapterRegistry(specs)) {
    if (!composed.has(orm)) composed.set(orm, factory)
  }
  return composed
}

/**
 * Turn promoted specs into always-on, import-self-gated graph-query sources — the build_models analog of
 * build_route's composeRoutePromotedAdapters (promoted rules appended as always-on, requiresImport-gated
 * adapters). A loop-discovered ORM has NO schemaSource (analyze_repo can't know a brand-new ORM), so its
 * promoted adapter would never be invoked via loadSchemaSources, which only runs ORMs the repo's
 * schemaSources name. We inject a synthetic graph-query source per promoted spec instead. Excluded:
 *  - orms a hand-written adapter already covers (`hardCodedOrms`) — those are driven by analyze_repo's
 *    schemaSources; a synthetic source would double-run them.
 *  - orms already loaded from a schemaSource (`coveredOrms`) — avoid duplicates.
 * The GraphQuerySpecAdapter self-gates on clientPackages (repoImportsAny), so a source for a package the
 * repo doesn't import is a strict no-op — keeping this regression-safe (empty/irrelevant promotions → []).
 */
export function promotedGraphQuerySources(
  specs: ModelAdapterSpec[],
  hardCodedOrms: ReadonlySet<string>,
  coveredOrms: ReadonlySet<string>,
): LoadedSource[] {
  const seen = new Set<string>()
  const out: LoadedSource[] = []
  for (const spec of specs) {
    if (hardCodedOrms.has(spec.orm) || coveredOrms.has(spec.orm) || seen.has(spec.orm)) continue
    seen.add(spec.orm)
    out.push({
      source: { orm: spec.orm, provider: null, schema_paths: [], label: spec.orm },
      adapter: new GraphQuerySpecAdapter(spec),
      strategy: 'graph-query',
      absolutePaths: [],
    })
  }
  return out
}
