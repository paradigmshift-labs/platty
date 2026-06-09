import { and, eq, inArray, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { epicConfirmLogs, epicDependencies, epicDocumentLinks } from '@/db/schema/build_epics.js'
import { epicDomains, epics } from '@/db/schema/core.js'
import { BuildEpicsError, type PersistConfirmedEpicsResult, type ValidatedConfirmedEpicPlan } from './types.js'
import type { DB } from '@/db/client.js'
import { upsertProjectPhaseStatus } from '@/pipeline_infra/phase/phase_status.js'

export interface PersistConfirmedEpicsInput {
  db: DB
  projectId: string
  plan: ValidatedConfirmedEpicPlan
}

export async function persistConfirmedEpics(input: PersistConfirmedEpicsInput): Promise<PersistConfirmedEpicsResult> {
  if (!input.projectId) throw new BuildEpicsError('INVALID_INPUT', 'projectId is required')
  const now = new Date().toISOString()
  const result = input.db.transaction((tx) => {
    const current = tx.select().from(epics).where(and(eq(epics.projectId, input.projectId), eq(epics.source, 'build_epics'))).all()
    const currentDomains = tx.select().from(epicDomains).where(and(eq(epicDomains.projectId, input.projectId), eq(epicDomains.source, 'build_epics'))).all()
    const domains = input.plan.domains ?? []
    const hasDomainPlan = input.plan.domains !== undefined
    const keepDomainStableKeys = new Set(domains.map((domain) => normalizeStableKey(domain.stableKey || domain.name)))
    const domainDbIdByDraftId = new Map<string, string>()
    const keepStableKeys = new Set(input.plan.epics.map((epic) => epic.validatedStableKey))
    const idByTemp = new Map<string, string>()
    const upsertedEpicIds: string[] = []
    let softDeletedCount = 0

    if (hasDomainPlan) {
      const duplicateDomainKeys = findDuplicates(domains.map((domain) => normalizeStableKey(domain.stableKey || domain.name)))
      if (duplicateDomainKeys.length > 0) {
        throw new BuildEpicsError('DUPLICATE_DOMAIN_STABLE_KEY', `Duplicate domain stable keys: ${duplicateDomainKeys.join(', ')}`)
      }

      // Avoid unique name collisions when two live domains swap names in one confirmation.
      for (const row of currentDomains.filter((domain) => domain.deletedAt === null && domain.stableKey && keepDomainStableKeys.has(domain.stableKey))) {
        tx.update(epicDomains)
          .set({ name: `__platty_tmp_${row.id}`, updatedAt: now })
          .where(eq(epicDomains.id, row.id))
          .run()
      }

      const staleDomains = currentDomains.filter((row) => row.stableKey && !keepDomainStableKeys.has(row.stableKey) && row.deletedAt === null)
      const staleDomainIds = staleDomains.map((row) => row.id)
      for (const row of staleDomains) {
        tx.update(epicDomains).set({ deletedAt: now, updatedAt: now }).where(eq(epicDomains.id, row.id)).run()
      }
      if (staleDomainIds.length > 0) {
        tx.update(epics)
          .set({ domainId: null, updatedAt: now })
          .where(and(eq(epics.projectId, input.projectId), inArray(epics.domainId, staleDomainIds), isNull(epics.deletedAt)))
          .run()
      }

      domains.forEach((domain, index) => {
        const stableKey = normalizeStableKey(domain.stableKey || domain.name)
        const existing = currentDomains.find((row) => row.stableKey === stableKey)
        const id = existing?.id ?? nanoid()
        const values = {
          projectId: input.projectId,
          name: domain.name,
          stableKey,
          summary: domain.summary,
          status: 'confirmed' as const,
          source: 'build_epics' as const,
          confidence: null,
          sortOrder: index,
          confirmedAt: now,
          deletedAt: null,
          updatedAt: now,
        }
        if (existing) tx.update(epicDomains).set(values).where(eq(epicDomains.id, existing.id)).run()
        else tx.insert(epicDomains).values({ id, ...values, createdAt: now }).run()
        domainDbIdByDraftId.set(domain.domainId, id)
      })
    }

    for (const epic of input.plan.epics) {
      const existing = current.find((row) => row.stableKey === epic.validatedStableKey)
        ?? current.find((row) => row.deletedAt === null && row.name === epic.name)
      const id = existing?.id ?? nanoid()
      const domainId = epic.domainId ? domainDbIdByDraftId.get(epic.domainId) ?? null : null
      const values = {
        projectId: input.projectId,
        domainId,
        name: epic.name,
        abbr: epic.abbr,
        description: epic.summary,
        stableKey: epic.validatedStableKey,
        summary: epic.summary,
        status: epic.status,
        source: 'build_epics' as const,
        confidence: epic.confidence,
        confirmedAt: epic.status === 'confirmed' ? now : null,
        deletedAt: null,
        updatedAt: now,
      }
      if (existing) tx.update(epics).set(values).where(eq(epics.id, existing.id)).run()
      else tx.insert(epics).values({ id, ...values, createdAt: now }).run()
      idByTemp.set(epic.tempEpicId, id)
      upsertedEpicIds.push(id)
    }

    const stale = current.filter((row) => row.stableKey && !keepStableKeys.has(row.stableKey) && row.deletedAt === null && !upsertedEpicIds.includes(row.id))
    for (const row of stale) {
      tx.update(epics).set({ deletedAt: now, updatedAt: now }).where(eq(epics.id, row.id)).run()
      tx.delete(epicDocumentLinks).where(eq(epicDocumentLinks.epicId, row.id)).run()
      tx.delete(epicDependencies).where(eq(epicDependencies.sourceEpicId, row.id)).run()
      tx.delete(epicDependencies).where(eq(epicDependencies.targetEpicId, row.id)).run()
      softDeletedCount += 1
    }

    if (upsertedEpicIds.length > 0) {
      tx.delete(epicDocumentLinks).where(inArray(epicDocumentLinks.epicId, upsertedEpicIds)).run()
      tx.delete(epicDependencies).where(inArray(epicDependencies.sourceEpicId, upsertedEpicIds)).run()
      tx.delete(epicDependencies).where(inArray(epicDependencies.targetEpicId, upsertedEpicIds)).run()
    }

    let linkCount = 0
    let dependencyCount = 0
    for (const epic of input.plan.epics.filter((item) => item.status === 'confirmed')) {
      const epicId = idByTemp.get(epic.tempEpicId)
      /* v8 ignore next -- ids are populated for every plan epic before link persistence */
      if (!epicId) continue
      for (const link of [
        ...epic.apiLinks.map((item) => ({ documentId: item.apiDocId, documentType: 'api_spec' as const, role: item.role, reason: item.reason ?? '', confidence: item.confidence })),
        ...epic.screenLinks.map((item) => ({ documentId: item.screenDocId, documentType: 'screen_spec' as const, role: item.role, reason: item.reason ?? '', confidence: item.confidence })),
        ...epic.eventLinks.map((item) => ({ documentId: item.eventDocId, documentType: 'event_spec' as const, role: item.role, reason: item.reason ?? '', confidence: item.confidence })),
        ...epic.scheduleLinks.map((item) => ({ documentId: item.scheduleDocId, documentType: 'schedule_spec' as const, role: item.role, reason: item.reason ?? '', confidence: item.confidence })),
      ]) {
        tx.insert(epicDocumentLinks).values({ epicId, ...link, createdAt: now }).run()
        linkCount += 1
      }
      for (const dep of epic.dependencies) {
        const targetEpicId = idByTemp.get(dep.targetTempEpicId)
        if (!targetEpicId) continue
        tx.insert(epicDependencies).values({ sourceEpicId: epicId, targetEpicId, kind: dep.kind, reason: dep.reason, createdAt: now }).run()
        dependencyCount += 1
      }
    }

    const confirmLogId = nanoid()
    tx.insert(epicConfirmLogs).values({ id: confirmLogId, projectId: input.projectId, payloadJson: input.plan as unknown as Record<string, unknown>, createdAt: now }).run()
    return {
      upsertedEpicIds,
      confirmedCount: input.plan.epics.filter((epic) => epic.status === 'confirmed').length,
      rejectedCount: input.plan.epics.filter((epic) => epic.status === 'rejected').length,
      softDeletedCount,
      linkCount,
      dependencyCount,
      confirmLogId,
    }
  })
  upsertProjectPhaseStatus(input.db, input.projectId, 'build_epics', {
    status: 'passed',
    meta: { confirmedCount: result.confirmedCount, rejectedCount: result.rejectedCount },
  })
  return result
}

function normalizeStableKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || `domain-${nanoid(6)}`
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}
