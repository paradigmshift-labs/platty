import { describe, expect, it } from 'vitest'

import type { CodeNode } from '@/db/schema/code_graph.js'
import { reactSemanticAnalyzer } from '@/pipeline_modules/build_route/analyzers/semantic/react/index.js'
import { runAnalyzerAdapters } from '@/pipeline_modules/build_route/f4_evaluate_source_analyzers.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type { AnalyzerContext } from '@/pipeline_modules/build_route/types.js'

const REPO = 'repo'

function node(filePath: string, name: string, type: CodeNode['type'] = 'function'): CodeNode {
  return {
    id: `${REPO}:${filePath}:${name}`,
    repoId: REPO,
    type,
    filePath,
    name,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: false,
    isDefaultExport: false,
    isAsync: false,
    isTest: false,
    testType: null,
    docComment: null,
    parseStatus: 'ok',
    createdAt: '2026-05-13',
  }
}

function ctx(nodes: CodeNode[], routingFiles = ['app/dashboard/page.tsx']): AnalyzerContext {
  return {
    repoPath: '/repo',
    repoId: REPO,
    stackInfo: { framework: 'nextjs', routingLibs: [], routingFiles },
    detections: [{ framework: 'nextjs', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
    graphNodes: nodes,
    graph: createGraphIndex({ nodes, edges: [] }),
  }
}

describe('reactSemanticAnalyzer', () => {
  it('creates internal entries for TabsTrigger plus deterministic conditional renders', () => {
    const file = node('app/dashboard/page.tsx', 'page.tsx', 'file')
    const dashboard = node('app/dashboard/page.tsx', 'DashboardPage')
    const feed = node('app/dashboard/FeedPage.tsx', 'FeedPage')
    const search = node('app/dashboard/SearchPage.tsx', 'SearchPage')
    const source = `
export default function DashboardPage() {
  const [tab, setTab] = useState('feed')
  return <>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsTrigger value="feed">Feed</TabsTrigger>
      <TabsTrigger value="search">Search</TabsTrigger>
    </Tabs>
    {tab === 'feed' && <FeedPage />}
    {tab === 'search' && <SearchPage />}
  </>
}`

    const result = runAnalyzerAdapters({
      ctx: ctx([file, dashboard, feed, search]),
      analyzers: [reactSemanticAnalyzer],
      readFile: (filePath) => filePath === 'app/dashboard/page.tsx' ? source : '',
    })

    expect(result.entryPoints.map((entry) => entry.fullPath)).toEqual([
      'internal://dashboard/feed',
      'internal://dashboard/search',
    ])
    expect(result.entryPoints.map((entry) => entry.handlerNodeId)).toEqual([feed.id, search.id])
    expect(result.entryPoints[0].metadata).toMatchObject({
      externalRoute: false,
      semanticEntry: true,
      parentRoute: '/dashboard',
      parentPage: 'DashboardPage',
      navigationKind: 'key_state_nav',
      tabKey: 'feed',
      label: 'Feed',
    })
  })

  it('creates suspected only for dynamic activeTab component lookup', () => {
    const file = node('src/App.tsx', 'App.tsx', 'file')
    const source = `
function App() {
  const [activeTab] = useState('feed')
  const Panel = panels[activeTab]
  return <Panel />
}`

    const result = runAnalyzerAdapters({
      ctx: ctx([file], ['src/App.tsx']),
      analyzers: [reactSemanticAnalyzer],
      readFile: () => source,
    })

    expect(result.entryPoints).toEqual([])
    expect(result.suspected).toEqual([
      { nodeId: file.id, adapter: 'react_semantic', reason: 'semantic_navigation_ambiguous', contextHint: 'file' },
    ])
  })

  it('rejects dashboard card arrays as semantic entries', () => {
    const file = node('app/dashboard/page.tsx', 'page.tsx', 'file')
    const source = `
export default function DashboardPage() {
  const cards = [<SalesCard />, <RevenueCard />]
  return <DashboardGrid>{cards}</DashboardGrid>
}`

    const result = runAnalyzerAdapters({
      ctx: ctx([file]),
      analyzers: [reactSemanticAnalyzer],
      readFile: () => source,
    })

    expect(result.entryPoints).toEqual([])
    expect(result.suspected).toEqual([])
  })

  it('does not read irrelevant non-route component files from the graph', () => {
    const pageFile = node('app/dashboard/page.tsx', 'page.tsx', 'file')
    const helperFile = node('src/components/Cards.tsx', 'Cards.tsx', 'file')
    const readFiles: string[] = []

    runAnalyzerAdapters({
      ctx: ctx([pageFile, helperFile], []),
      analyzers: [reactSemanticAnalyzer],
      readFile: (filePath) => {
        readFiles.push(filePath)
        return ''
      },
    })

    expect(readFiles).toEqual(['app/dashboard/page.tsx'])
  })
})
