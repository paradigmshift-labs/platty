import { describe, expect, it } from 'vitest'
import { packBuildEpicsDocumentCards } from '@/pipeline_modules/build_epics_cli_runtime/cards.js'
import type { BuildEpicsDocIndex, BuildEpicsDocumentType } from '@/pipeline_modules/build_epics_core/types.js'

describe('build_epics CLI runtime document cards', () => {
  it('packs L0 and L1 document cards from build_docs index data', () => {
    const cards = packBuildEpicsDocumentCards(docIndexForRuntime(['api:orders']))

    expect(cards).toEqual([
      expect.objectContaining({
        documentId: 'api:orders',
        type: 'api_spec',
        title: 'api:orders',
        summary: 'api:orders summary.',
        method: 'GET',
        path: '/api:orders',
        access: 'Login required: user token is checked.',
        actorHints: [],
        domainHints: [],
        relationHints: [],
      }),
    ])
  })

  it('packs type-specific screen, event, and schedule card fields', () => {
    const cards = packBuildEpicsDocumentCards({
      projectId: 'project:test',
      apis: [],
      screens: [screenDoc('screen:orders')],
      events: [eventDoc('event:orders')],
      schedules: [scheduleDoc('schedule:orders')],
    })

    expect(cards).toEqual([
      expect.objectContaining({ documentId: 'screen:orders', type: 'screen_spec', routePath: '/orders' }),
      expect.objectContaining({ documentId: 'event:orders', type: 'event_spec', eventKey: 'orders.created' }),
      expect.objectContaining({ documentId: 'schedule:orders', type: 'schedule_spec', jobName: 'syncOrders' }),
    ])
  })
})

function docIndexForRuntime(ids: string[]): BuildEpicsDocIndex {
  return {
    projectId: 'project:test',
    apis: ids.map((documentId) => ({
      ...baseDoc(documentId, 'api_spec'),
      method: 'GET',
      path: `/${documentId}`,
      handler: `${documentId}Handler`,
      sourceFilePath: 'src/app.ts',
      access: 'Login required: user token is checked.',
      authRequired: null,
      tables: [],
      eventsPublished: [],
      externalCalls: [],
      businessLogic: [],
      businessRules: [],
    })),
    screens: [],
    events: [],
    schedules: [],
  }
}

function screenDoc(documentId: string): BuildEpicsDocIndex['screens'][number] {
  return {
    ...baseDoc(documentId, 'screen_spec'),
    routePath: '/orders',
    screenName: 'Orders',
    component: 'OrdersPage',
    sourceFilePath: 'src/OrdersPage.tsx',
    apiCalls: [],
    navigation: [],
    actions: [],
    businessLogic: [],
  }
}

function eventDoc(documentId: string): BuildEpicsDocIndex['events'][number] {
  return {
    ...baseDoc(documentId, 'event_spec'),
    eventKey: 'orders.created',
    listeners: [],
  }
}

function scheduleDoc(documentId: string): BuildEpicsDocIndex['schedules'][number] {
  return {
    ...baseDoc(documentId, 'schedule_spec'),
    jobName: 'syncOrders',
    schedule: { trigger: 'cron' },
    handler: 'syncOrders',
    sourceFilePath: 'src/jobs.ts',
    tables: [],
    eventsPublished: [],
    externalCalls: [],
    businessLogic: [],
  }
}

function baseDoc<T extends BuildEpicsDocumentType>(documentId: string, type: T) {
  return {
    documentId,
    projectId: 'project:test',
    type,
    status: 'passed' as const,
    filePath: null,
    title: documentId,
    summary: `${documentId} summary.`,
    evidenceGaps: [],
    relationEvidence: null,
    actorHints: [],
    domainHints: [],
    operationKey: null,
    routePattern: null,
  }
}
