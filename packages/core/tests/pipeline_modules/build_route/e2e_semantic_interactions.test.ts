import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { codeBundles, entryPoints } from '@/db/schema/build_route.js'
import { codeNodes } from '@/db/schema/code_graph.js'
import { projects, repositories } from '@/db/schema/core.js'
import { runBuildRoute } from '@/pipeline_modules/build_route/index.js'
import { createTestDb } from '../../server/helpers.js'

const PROJECT = 'project'
const REPO = 'repo'

describe('build_route semantic/server interaction E2E', () => {
  it('persists Next page route, internal tabs, server action, and semantic code bundle roots', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'build-route-next-semantic-'))
    mkdirSync(join(repoPath, 'app/dashboard'), { recursive: true })
    writeFileSync(join(repoPath, 'app/dashboard/page.tsx'), `
export default function DashboardPage() {
  const [tab, setTab] = useState('feed')
  async function createPost() {
    'use server'
  }
  return <>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsTrigger value="feed">Feed</TabsTrigger>
      <TabsTrigger value="search">Search</TabsTrigger>
    </Tabs>
    {tab === 'feed' && <FeedPage />}
    {tab === 'search' && <SearchPage />}
    <form action={createPost} />
  </>
}
`)

    const db = createTestDb()
    db.insert(projects).values({ id: PROJECT, name: 'p' }).run()
    db.insert(repositories).values({
      id: REPO,
      projectId: PROJECT,
      name: 'r',
      repoPath,
      framework: 'nextjs',
      routingFiles: ['app/dashboard/page.tsx'],
    }).run()

    const nodes = [
      node('app/dashboard/page.tsx', 'page.tsx', 'file'),
      node('app/dashboard/page.tsx', 'DashboardPage', 'function', true),
      node('app/dashboard/page.tsx', 'createPost', 'function'),
      node('app/dashboard/FeedPage.tsx', 'FeedPage', 'function'),
      node('app/dashboard/SearchPage.tsx', 'SearchPage', 'function'),
      node('app/dashboard/feed-service.ts', 'loadFeed', 'function'),
    ]
    db.insert(codeNodes).values(nodes).run()

    const result = await runBuildRoute({ db, repoId: REPO })
    const rows = db.select().from(entryPoints).all()
    const fullPaths = rows.map((row) => row.fullPath).sort()

    expect(fullPaths).toEqual(expect.arrayContaining([
      '/dashboard',
      '/dashboard#action:createPost',
      'internal://dashboard/feed',
      'internal://dashboard/search',
    ]))
    expect(rows.find((row) => row.fullPath === '/dashboard#action:createPost')?.metadata).toMatchObject({
      interactionKind: 'next_server_action',
      parentRoute: '/dashboard',
      actionName: 'createPost',
    })
    expect(rows.find((row) => row.fullPath === 'internal://dashboard/feed')?.metadata).toMatchObject({
      externalRoute: false,
      semanticEntry: true,
      parentRoute: '/dashboard',
      label: 'Feed',
    })
    expect(result.composeDiagnostics).toMatchObject({
      semanticEntries: 2,
      semanticSuspected: 0,
      internalEntriesDeduped: 0,
    })

    const feedEntry = rows.find((row) => row.fullPath === 'internal://dashboard/feed')!
    const feedBundleRoot = db.select().from(codeBundles).all().find((bundle) => bundle.entryPointId === feedEntry.id && bundle.depth === 0)
    expect(feedBundleRoot?.nodeId).toBe(`${REPO}:app/dashboard/FeedPage.tsx:FeedPage`)
    expect(result.entryPoints.map((entry) => entry.fullPath).sort()).toEqual(fullPaths)
  })
})

function node(filePath: string, name: string, type: 'file' | 'function', isDefaultExport = false) {
  return {
    id: `${REPO}:${filePath}:${name}`,
    repoId: REPO,
    type,
    filePath,
    name,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: isDefaultExport,
    isDefaultExport,
    isAsync: false,
    isTest: false,
    testType: null,
    docComment: null,
    parseStatus: 'ok',
  }
}
