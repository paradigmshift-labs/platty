import { describe, expect, it, beforeEach } from 'vitest'

import { codeNodes } from '@/db/schema/code_graph.js'
import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { projects, repositories } from '@/db/schema/core.js'
import { persistResults } from '@/pipeline_modules/build_route/f6_persist_results.js'
import type { EntryPointDraft } from '@/pipeline_modules/build_route/types.js'
import { createTestDb, type DB } from '../../server/helpers.js'

const REPO = 'repo'
const PROJECT = 'project'
const HANDLER = 'repo:app/dashboard/BillingPanel.tsx:BillingPanel'

let db: DB

beforeEach(() => {
  db = createTestDb()
  db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
  db.insert(repositories).values({ id: REPO, projectId: PROJECT, name: 'r', repoPath: '.' }).run()
  db.insert(codeNodes).values({
    id: HANDLER,
    repoId: REPO,
    type: 'function',
    filePath: 'app/dashboard/BillingPanel.tsx',
    name: 'BillingPanel',
  }).run()
})

function semanticEntry(overrides: Partial<EntryPointDraft> = {}): EntryPointDraft {
  return {
    framework: 'nextjs',
    kind: 'page',
    fullPath: 'internal://dashboard/billing',
    handlerNodeId: HANDLER,
    metadata: {
      externalRoute: false,
      semanticEntry: true,
      parentRoute: '/dashboard',
      parentPage: 'DashboardPage',
      navigationKind: 'tabs',
      label: 'Billing',
      tabKey: 'billing',
      evidence: ['tab_like_control', 'state_key_selector'],
    },
    detectionSource: 'semantic:react',
    confidence: 'high',
    detectionEvidence: { matchedRuleId: 'semantic:react:tabs', matchedNodeIds: [HANDLER], matchedEdgeIds: [] },
    ...overrides,
  }
}

describe('semantic persistence', () => {
  it('persists semantic metadata and code bundles, and rerun stays idempotent', async () => {
    const entry = semanticEntry()
    const entryPointId = `${REPO}:nextjs:page::internal://dashboard/billing:${HANDLER}`

    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [entry],
      bundles: [{ entryPointId, nodeId: HANDLER, depth: 0 }],
    })
    await persistResults({
      db,
      repoId: REPO,
      detections: [],
      entryPoints: [entry],
      bundles: [{ entryPointId, nodeId: HANDLER, depth: 0 }],
    })

    const rows = db.select().from(entryPoints).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: entryPointId,
      framework: 'nextjs',
      kind: 'page',
      fullPath: 'internal://dashboard/billing',
      handlerNodeId: HANDLER,
    })
    expect(rows[0].metadata).toMatchObject({
      externalRoute: false,
      semanticEntry: true,
      parentRoute: '/dashboard',
      navigationKind: 'tabs',
      label: 'Billing',
    })
    expect(db.select().from(codeBundles).all()).toEqual([
      { entryPointId, nodeId: HANDLER, depth: 0, edgePath: null },
    ])
  })

  it('persists server interaction metadata separately from semantic entries', async () => {
    const serverAction = semanticEntry({
      framework: 'nextjs',
      kind: 'api',
      httpMethod: 'POST',
      path: '/dashboard',
      fullPath: '/dashboard#action:createPost',
      metadata: {
        interactionKind: 'next_server_action',
        parentRoute: '/dashboard',
        actionName: 'createPost',
        stablePublicUrl: false,
      },
      detectionSource: 'source:nextjs_server_action',
    })

    await persistResults({ db, repoId: REPO, detections: [], entryPoints: [semanticEntry(), serverAction] })

    const rows = db.select().from(entryPoints).all()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.fullPath).sort()).toEqual([
      '/dashboard#action:createPost',
      'internal://dashboard/billing',
    ])
    expect(rows.find((row) => row.fullPath === '/dashboard#action:createPost')?.metadata).toMatchObject({
      interactionKind: 'next_server_action',
      stablePublicUrl: false,
    })
  })
})
