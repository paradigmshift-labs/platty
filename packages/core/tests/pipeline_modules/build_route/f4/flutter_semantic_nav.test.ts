import { describe, expect, it } from 'vitest'

import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'
import { flutterSemanticAnalyzer } from '@/pipeline_modules/build_route/analyzers/semantic/flutter/index.js'
import { runAnalyzerAdapters } from '@/pipeline_modules/build_route/f4_evaluate_source_analyzers.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type { AnalyzerContext } from '@/pipeline_modules/build_route/types.js'

const REPO = 'repo'

function node(filePath: string, name: string, type: CodeNode['type'] = 'class'): CodeNode {
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

function ctx(nodes: CodeNode[], routingFiles = ['lib/home_page.dart']): AnalyzerContext {
  return {
    repoPath: '/repo',
    repoId: REPO,
    stackInfo: { framework: 'flutter', routingLibs: [], routingFiles },
    detections: [{ framework: 'flutter_gorouter', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
    graphNodes: nodes,
    graph: createGraphIndex({ nodes, edges: [] }),
  }
}

function edge(sourceId: string, targetSymbol: string): CodeEdge {
  return {
    id: 1,
    repoId: REPO,
    sourceId,
    targetId: null,
    relation: 'calls',
    targetSpecifier: null,
    targetSymbol,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'external',
    confidence: null,
    source: 'static',
    createdAt: '2026-05-13',
  }
}

function ctxWithEdges(nodes: CodeNode[], edges: CodeEdge[], routingFiles: string[] = []): AnalyzerContext {
  return {
    repoPath: '/repo',
    repoId: REPO,
    stackInfo: { framework: 'flutter', routingLibs: [], routingFiles },
    detections: [{ framework: 'flutter_gorouter', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
    graphNodes: nodes,
    graph: createGraphIndex({ nodes, edges }),
  }
}

describe('flutterSemanticAnalyzer', () => {
  it('creates internal entries for BottomNavigationBar plus IndexedStack variable children', () => {
    const homeFile = node('lib/home_page.dart', 'home_page.dart', 'file')
    const home = node('lib/home_page.dart', 'HomePage')
    const feed = node('lib/feed_page.dart', 'FeedPage')
    const search = node('lib/search_page.dart', 'SearchPage')
    const my = node('lib/my_page.dart', 'MyPage')
    const source = `
class HomePage extends StatefulWidget {}
class _HomePageState extends State<HomePage> {
  int selectedIndex = 0;
  final pages = [FeedPage(), SearchPage(), MyPage()];
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: selectedIndex, children: pages),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: selectedIndex,
        items: const [
          BottomNavigationBarItem(label: 'Feed', icon: Icon(Icons.home)),
          BottomNavigationBarItem(label: 'Search', icon: Icon(Icons.search)),
          BottomNavigationBarItem(label: 'My', icon: Icon(Icons.person)),
        ],
      ),
    );
  }
}`

    const result = runAnalyzerAdapters({
      ctx: ctx([homeFile, home, feed, search, my]),
      analyzers: [flutterSemanticAnalyzer],
      readFile: (filePath) => filePath === 'lib/home_page.dart' ? source : '',
    })

    expect(result.entryPoints.map((entry) => entry.fullPath)).toEqual([
      'internal://home/feed',
      'internal://home/search',
      'internal://home/my',
    ])
    expect(result.entryPoints.map((entry) => entry.handlerNodeId)).toEqual([feed.id, search.id, my.id])
    expect(result.entryPoints[0].metadata).toMatchObject({
      externalRoute: false,
      semanticEntry: true,
      parentPage: 'HomePage',
      navigationKind: 'bottom_nav',
      index: 0,
      label: 'Feed',
    })
    expect(result.entryPoints[0].metadata.evidence).toEqual(expect.arrayContaining([
      'bottom_nav_like_control',
      'single_child_by_index',
      'component_array',
      'label_list',
    ]))
  })

  it('creates suspected only for dynamic page factories', () => {
    const homeFile = node('lib/home_page.dart', 'home_page.dart', 'file')
    const home = node('lib/home_page.dart', 'HomePage')
    const source = `
class HomePage extends StatefulWidget {}
class _HomePageState extends State<HomePage> {
  int selectedIndex = 0;
  final pages = buildPagesFromConfig();
  Widget build(BuildContext context) {
    return Scaffold(
      body: pages[selectedIndex],
      bottomNavigationBar: BottomNavigationBar(items: const []),
    );
  }
}`

    const result = runAnalyzerAdapters({
      ctx: ctx([homeFile, home]),
      analyzers: [flutterSemanticAnalyzer],
      readFile: () => source,
    })

    expect(result.entryPoints).toEqual([])
    expect(result.suspected).toEqual([
      {
        nodeId: homeFile.id,
        adapter: 'flutter_semantic',
        reason: 'semantic_navigation_ambiguous',
        contextHint: 'file',
      },
    ])
  })

  it('ignores ordinary Column children', () => {
    const homeFile = node('lib/home_page.dart', 'home_page.dart', 'file')
    const home = node('lib/home_page.dart', 'HomePage')
    const source = `
class HomePage extends StatelessWidget {
  Widget build(BuildContext context) {
    return Column(children: [FeedPage(), SearchPage()]);
  }
}`

    const result = runAnalyzerAdapters({
      ctx: ctx([homeFile, home]),
      analyzers: [flutterSemanticAnalyzer],
      readFile: () => source,
    })

    expect(result.entryPoints).toEqual([])
    expect(result.suspected).toEqual([])
  })

  it('does not read irrelevant Dart component files from the graph', () => {
    const mainFile = node('lib/main.dart', 'main.dart', 'file')
    const cardFile = node('lib/widgets/stat_card.dart', 'stat_card.dart', 'file')
    const readFiles: string[] = []

    runAnalyzerAdapters({
      ctx: ctx([mainFile, cardFile], []),
      analyzers: [flutterSemanticAnalyzer],
      readFile: (filePath) => {
        readFiles.push(filePath)
        return ''
      },
    })

    expect(readFiles).toEqual(['lib/main.dart'])
  })

  it('reads arbitrary widget files when build_graph found Flutter navigation calls', () => {
    const mainFile = node('lib/main.dart', 'main.dart', 'file')
    const cardFile = node('lib/widgets/action_card.dart', 'action_card.dart', 'file')
    const actionCard = node('lib/widgets/action_card.dart', 'ActionCard')
    const readFiles: string[] = []

    runAnalyzerAdapters({
      ctx: ctxWithEdges([mainFile, cardFile, actionCard], [edge(actionCard.id, 'Navigator')]),
      analyzers: [flutterSemanticAnalyzer],
      readFile: (filePath) => {
        readFiles.push(filePath)
        return ''
      },
    })

    expect(readFiles).toEqual(['lib/main.dart', 'lib/widgets/action_card.dart'])
  })
})
