// f3/walk_evaluator — walk 표현식 평가 (architecture.md §4.3).
// pure: parsed source value (object/array/map) → WalkEntry[]
// 호출자 책임: SelectCandidate.matchedEdges[].literalArgs JSON 파싱 후 source 추출.

import type { WalkEntry, WalkExpr } from '../types.js'

export function evaluateWalk(walk: WalkExpr, source: unknown): WalkEntry[] {
  switch (walk.iterate) {
    case 'array_element':
      if (!Array.isArray(source)) return []
      return source.map((value, idx) => ({ key: String(idx), value }))

    case 'object_property':
    case 'map_entries': {
      if (!isPlainObject(source)) return []
      if (walk.field !== undefined) {
        if (!(walk.field in source)) return []
        return [{ key: walk.field, value: source[walk.field] }]
      }
      return Object.entries(source).map(([key, value]) => ({ key, value }))
    }

    default:
      return []
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
