// build_models/rule_authoring — declarative graph-query adapter spec for the self-improvement loop.
// A NEW decorator/class-based ORM is expressed as DATA (which decorator marks entity/column/relation),
// not code. The fixed GraphQuerySpecAdapter executes the spec against the code graph, so the loop can
// auto-author + referee new-ORM adapters without running LLM-generated code. (Prisma-style tree-sitter
// codegen is deferred — see specs/build_models/improvements/self-improvement-loop.md §8.)

import type { ModelRaw, ModelRelation } from '../types.js'

export interface ModelAdapterSpec {
  /** 'model.adapter.<orm>' */
  id: string
  orm: string
  /** the ORM's import specifiers; the adapter only fires when the repo imports one (cross-ORM gate). */
  clientPackages: string[]
  /** a class is an entity iff decorated by one of these (e.g. ['Entity']). */
  entityDecorators: string[]
  /** the decorator arg key holding an explicit table name (e.g. 'tableName' / 'name'); null → string-literal/snake_case. */
  tableNameArgKey?: string | null
  /** a property is a field iff decorated by one of these (e.g. ['Column','PrimaryColumn','Property']). */
  columnDecorators: string[]
  /** the subset of columnDecorators that mark a primary key (e.g. ['PrimaryColumn','PrimaryKey']). */
  primaryDecorators: string[]
  /** decorator → relation type (e.g. { OneToMany:'oneToMany', ManyToOne:'manyToOne' }). */
  relationDecoratorTypes: Record<string, ModelRelation['type']>
}

/**
 * The structural shape compared by the referee + faithfulness keystone. Field *types* are excluded —
 * exact type normalization is ORM-specific (per-adapter type maps) and out of the spec's scope; the loop
 * proves the adapter finds the right tables/columns/relations, not the exact type strings.
 */
export interface ModelShape {
  name: string
  table_name: string
  fields: Array<{ name: string; primary: boolean }>
  relations: Array<{ name: string; type: ModelRelation['type']; target_model: string }>
}

export function toModelShape(model: ModelRaw): ModelShape {
  return {
    name: model.name,
    table_name: model.table_name,
    fields: model.fields
      .map((f) => ({ name: f.name, primary: f.primary }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    relations: model.relations
      .map((r) => ({ name: r.name, type: r.type, target_model: r.target_model }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export function modelShapesEqual(a: ModelShape, b: ModelShape): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Compare two model sets by shape, keyed by model name. Returns missing/extra/mismatched. */
export function diffModelShapes(
  actual: ModelRaw[],
  expected: ModelShape[],
): { missing: string[]; extra: string[]; mismatched: string[] } {
  const actualByName = new Map(actual.map((m) => [m.name, toModelShape(m)]))
  const expectedByName = new Map(expected.map((s) => [s.name, s]))
  const missing: string[] = []
  const mismatched: string[] = []
  for (const [name, exp] of expectedByName) {
    const got = actualByName.get(name)
    if (!got) missing.push(name)
    else if (!modelShapesEqual(got, exp)) mismatched.push(name)
  }
  const extra = [...actualByName.keys()].filter((n) => !expectedByName.has(n))
  return { missing, extra, mismatched }
}
