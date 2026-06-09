import type { RelationFactContext } from '../runtime/types.js'

export function buildSystemRelations(facts: RelationFactContext[]): Record<string, unknown[]> {
  const relations: Record<string, unknown[]> = {
    tables: [],
    external_calls: [],
    events: [],
    api_calls: [],
    navigation: [],
    external_links: [],
    related_apis: [],
  }

  for (const fact of facts) {
    if (fact.confidence !== 'high' && fact.confidence !== 'medium') continue

    if (fact.kind === 'db_access') {
      const table = relationTarget(fact, 'table')
      if (table) pushUniqueRelation(relations.tables, { table, operation: normalizeRelationOperation(relationPayloadString(fact, 'operation') ?? fact.operation) })
      continue
    }

    if (fact.kind === 'external_service') {
      const system = relationTarget(fact, 'system') ?? relationTarget(fact, 'url')
      if (system) pushUniqueRelation(relations.external_calls, compactUndefined({ system, operation: fact.operation }))
      continue
    }

    if (fact.kind === 'external_link') {
      const target = relationTarget(fact, 'url') ?? relationTarget(fact, 'system') ?? fact.target
      if (target) {
        pushUniqueRelation(relations.external_links, compactUndefined({ target, trigger: fact.operation }))
      }
      continue
    }

    if (fact.kind === 'event_publish' || fact.kind === 'event_listen') {
      const name = relationTarget(fact, 'event') ?? relationTarget(fact, 'name')
      if (name) pushUniqueRelation(relations.events, { name })
      continue
    }

    if (fact.kind === 'api_call') {
      const path = relationTarget(fact, 'path')
      if (path) pushUniqueRelation(relations.api_calls, compactUndefined({ method: fact.operation ?? undefined, path }))
      continue
    }

    if (fact.kind === 'navigation') {
      const targetPath = relationTarget(fact, 'path') ?? relationTarget(fact, 'target_path') ?? fact.target
      if (!targetPath) continue
      if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
        pushUniqueRelation(relations.external_links, compactUndefined({ target: targetPath, trigger: fact.operation }))
      } else {
        pushUniqueRelation(relations.navigation, compactUndefined({ target_path: targetPath, trigger: fact.operation }))
      }
    }
  }

  return relations
}

export function relationTarget(fact: RelationFactContext, payloadKey: string): string | null {
  const payloadValue = fact.payload[payloadKey]
  if (typeof payloadValue === 'string' && payloadValue.length > 0) return payloadValue
  return fact.target
}

export function relationPayloadString(fact: RelationFactContext, payloadKey: string): string | null {
  const payloadValue = fact.payload[payloadKey]
  return typeof payloadValue === 'string' && payloadValue.length > 0 ? payloadValue : null
}

export function normalizeRelationOperation(value: string | null): 'select' | 'insert' | 'update' | 'delete' | 'unknown' {
  if (value === 'select' || value === 'insert' || value === 'update' || value === 'delete') return value
  return 'unknown'
}

function pushUniqueRelation(rows: unknown[], row: Record<string, unknown>): void {
  const key = JSON.stringify(row)
  if (!rows.some((existing) => JSON.stringify(existing) === key)) rows.push(row)
}

function compactUndefined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== null))
}
