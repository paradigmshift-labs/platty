import { describe, expect, it } from 'vitest'

import { flutterSemanticAnalyzer } from '@/pipeline_modules/build_route/analyzers/semantic/flutter/index.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type { AnalyzerContext } from '@/pipeline_modules/build_route/types.js'
import type { CodeNode } from '@/db/schema/code_graph.js'

const repoId = 'r1'

function node(id: string, filePath: string, name: string, type: CodeNode['type'] = 'class'): CodeNode {
  return {
    id,
    repoId,
    type,
    filePath,
    name,
  } as CodeNode
}

function ctx(graphNodes: CodeNode[]): AnalyzerContext {
  return {
    repoPath: '/repo',
    repoId,
    stackInfo: { framework: 'flutter', routingLibs: [], entrypointFiles: [] },
    detections: [],
    graphNodes,
    graph: createGraphIndex({ nodes: graphNodes, edges: [] }),
  }
}

describe('flutterSemanticAnalyzer', () => {
  it('considers semantic navigation files under lib even when the filename is not *_page.dart', () => {
    const graphNodes = [
      node('r1:lib/widgets/home/home_shell.dart', 'lib/widgets/home/home_shell.dart', 'lib/widgets/home/home_shell.dart', 'file'),
      node('r1:lib/pages/home/home_state.g.dart', 'lib/pages/home/home_state.g.dart', 'lib/pages/home/home_state.g.dart', 'file'),
      node('r1:test/home_shell_test.dart', 'test/home_shell_test.dart', 'test/home_shell_test.dart', 'file'),
    ]

    expect(flutterSemanticAnalyzer.candidateFiles(ctx(graphNodes))).toEqual([
      'lib/widgets/home/home_shell.dart',
    ])
  })

  it('extracts bottom tab entries from a TabBarView that references a widget list variable', () => {
    const graphNodes = [
      node('r1:lib/widgets/home/home_shell.dart', 'lib/widgets/home/home_shell.dart', 'lib/widgets/home/home_shell.dart', 'file'),
      node('r1:lib/widgets/home/home_shell.dart:CommunityPage', 'lib/widgets/home/home_shell.dart', 'CommunityPage'),
      node('r1:lib/widgets/home/home_shell.dart:BoardPage', 'lib/widgets/home/home_shell.dart', 'BoardPage'),
      node('r1:lib/widgets/home/home_shell.dart:ProfilePage', 'lib/widgets/home/home_shell.dart', 'ProfilePage'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/widgets/home/home_shell.dart',
      fileNodeId: 'r1:lib/widgets/home/home_shell.dart',
      source: `
        class HomePage extends StatefulWidget {}
        class _HomePageState extends State<HomePage> {
          int currentIndex = 0;
          final List<Widget> bodys = [
            const CommunityPage(),
            const BoardPage(),
            const ProfilePage(),
          ];

          Widget build(BuildContext context) {
            return Scaffold(
              body: TabBarView(children: bodys),
              bottomNavigationBar: BottomAppBar(child: Row(children: [])),
            );
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.suspected).toEqual([])
    expect(result.entryPoints.map((entry) => ({
      fullPath: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
      source: entry.detectionSource,
      navigationKind: entry.metadata.navigationKind,
    }))).toEqual([
      {
        fullPath: 'internal://home/community',
        handlerNodeId: 'r1:lib/widgets/home/home_shell.dart:CommunityPage',
        source: 'semantic:flutter',
        navigationKind: 'bottom_nav',
      },
      {
        fullPath: 'internal://home/board',
        handlerNodeId: 'r1:lib/widgets/home/home_shell.dart:BoardPage',
        source: 'semantic:flutter',
        navigationKind: 'bottom_nav',
      },
      {
        fullPath: 'internal://home/profile',
        handlerNodeId: 'r1:lib/widgets/home/home_shell.dart:ProfilePage',
        source: 'semantic:flutter',
        navigationKind: 'bottom_nav',
      },
    ])
  })

  it('marks semantic navigation ambiguous when a child component cannot be resolved in the graph', () => {
    const graphNodes = [
      node('r1:lib/home.dart', 'lib/home.dart', 'lib/home.dart', 'file'),
      node('r1:lib/home.dart:FeedPage', 'lib/home.dart', 'FeedPage'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/home.dart',
      fileNodeId: 'r1:lib/home.dart',
      source: `
        class HomePage extends StatefulWidget {}
        class _HomePageState extends State<HomePage> {
          final List<Widget> pages = [
            const FeedPage(),
            const MissingPage(),
          ];

          Widget build(BuildContext context) {
            return Scaffold(
              body: TabBarView(children: pages),
              bottomNavigationBar: BottomAppBar(child: Row(children: [])),
            );
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.entryPoints.map((entry) => entry.fullPath)).toEqual(['internal://home/feed'])
    expect(result.suspected).toEqual([
      {
        nodeId: 'r1:lib/home.dart',
        adapter: 'flutter_semantic',
        reason: 'semantic_navigation_ambiguous',
        contextHint: 'file',
      },
    ])
  })

  it('uses GetX and hooks widget base classes as semantic parent pages', () => {
    const graphNodes = [
      node('r1:lib/home.dart', 'lib/home.dart', 'lib/home.dart', 'file'),
      node('r1:lib/home.dart:FeedPage', 'lib/home.dart', 'FeedPage'),
      node('r1:lib/home.dart:StorePage', 'lib/home.dart', 'StorePage'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/home.dart',
      fileNodeId: 'r1:lib/home.dart',
      source: `
        class MainShell extends GetView<HomeController> {
          final pages = [
            const FeedPage(),
            const StorePage(),
          ];

          Widget build(BuildContext context) {
            return Scaffold(
              body: PageView(children: pages),
              bottomNavigationBar: BottomNavigationBar(items: [
                BottomNavigationBarItem(icon: Icon(Icons.home), label: 'Feed'),
                BottomNavigationBarItem(icon: Icon(Icons.store), label: 'Store'),
              ]),
            );
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.entryPoints.map((entry) => entry.fullPath)).toEqual([
      'internal://main-shell/feed',
      'internal://main-shell/store',
    ])
  })

  it('extracts internal entries from Navigator.push route builders', () => {
    const graphNodes = [
      node('r1:lib/home.dart', 'lib/home.dart', 'lib/home.dart', 'file'),
      node('r1:lib/home.dart:HomePage', 'lib/home.dart', 'HomePage'),
      node('r1:lib/detail.dart:DetailPage', 'lib/detail.dart', 'DetailPage'),
      node('r1:lib/search.dart:SearchPage', 'lib/search.dart', 'SearchPage'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/home.dart',
      fileNodeId: 'r1:lib/home.dart',
      source: `
        class HomePage extends StatelessWidget {
          Widget build(BuildContext context) {
            return Column(children: [
              TextButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const DetailPage()),
                ),
                child: const Text('Detail'),
              ),
              TextButton(
                onPressed: () {
                  Navigator.of(context).push(PageRouteBuilder(
                    transitionsBuilder: (_, animation, __, child) =>
                      FadeTransition(opacity: animation, child: child),
                    pageBuilder: (_, __, ___) => SearchPage(),
                  ));
                },
                child: const Text('Search'),
              ),
            ]);
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.suspected).toEqual([])
    expect(result.entryPoints.map((entry) => ({
      fullPath: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
      navigationKind: entry.metadata.navigationKind,
      evidence: entry.metadata.evidence,
    }))).toEqual([
      {
        fullPath: 'internal://navigator/home/detail',
        handlerNodeId: 'r1:lib/detail.dart:DetailPage',
        navigationKind: 'navigator_push',
        evidence: expect.arrayContaining(['navigator_push', 'route_builder']),
      },
      {
        fullPath: 'internal://navigator/home/search',
        handlerNodeId: 'r1:lib/search.dart:SearchPage',
        navigationKind: 'navigator_push',
        evidence: expect.arrayContaining(['navigator_push', 'route_builder']),
      },
    ])
  })

  it('extracts internal entries from Flutter dialog and bottom sheet builders', () => {
    const graphNodes = [
      node('r1:lib/home.dart', 'lib/home.dart', 'lib/home.dart', 'file'),
      node('r1:lib/home.dart:HomePage', 'lib/home.dart', 'HomePage'),
      node('r1:lib/dialogs.dart:ConfirmDialog', 'lib/dialogs.dart', 'ConfirmDialog'),
      node('r1:lib/sheets.dart:FilterSheet', 'lib/sheets.dart', 'FilterSheet'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/home.dart',
      fileNodeId: 'r1:lib/home.dart',
      source: `
        class HomePage extends StatelessWidget {
          Widget build(BuildContext context) {
            return Column(children: [
              TextButton(
                onPressed: () => showDialog(
                  context: context,
                  builder: (_) => const ConfirmDialog(),
                ),
                child: const Text('Confirm'),
              ),
              TextButton(
                onPressed: () => showModalBottomSheet(
                  context: context,
                  builder: (_) {
                    return FilterSheet();
                  },
                ),
                child: const Text('Filter'),
              ),
            ]);
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.suspected).toEqual([])
    expect(result.entryPoints.map((entry) => ({
      fullPath: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
      navigationKind: entry.metadata.navigationKind,
      evidence: entry.metadata.evidence,
    }))).toEqual([
      {
        fullPath: 'internal://dialog/home/confirm-dialog',
        handlerNodeId: 'r1:lib/dialogs.dart:ConfirmDialog',
        navigationKind: 'dialog',
        evidence: expect.arrayContaining(['modal_builder']),
      },
      {
        fullPath: 'internal://bottom-sheet/home/filter-sheet',
        handlerNodeId: 'r1:lib/sheets.dart:FilterSheet',
        navigationKind: 'bottom_sheet',
        evidence: expect.arrayContaining(['modal_builder']),
      },
    ])
  })

  it('extracts TYPED modal builders (showModalBottomSheet<void> / showDialog<bool>)', () => {
    // heroines uses `showModalBottomSheet<bool>(...)` / `showModalBottomSheet<void>(...)`. The callee regex must
    // allow an optional <Type> between the name and `(` (like the Navigator.push route-ctor already does), else
    // every typed modal screen is silently dropped.
    const graphNodes = [
      node('r1:lib/home.dart', 'lib/home.dart', 'lib/home.dart', 'file'),
      node('r1:lib/home.dart:HomePage', 'lib/home.dart', 'HomePage'),
      node('r1:lib/dialogs.dart:ConfirmDialog', 'lib/dialogs.dart', 'ConfirmDialog'),
      node('r1:lib/sheets.dart:FilterSheet', 'lib/sheets.dart', 'FilterSheet'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/home.dart',
      fileNodeId: 'r1:lib/home.dart',
      source: `
        class HomePage extends StatelessWidget {
          Widget build(BuildContext context) {
            return Column(children: [
              TextButton(
                onPressed: () => showDialog<bool>(
                  context: context,
                  builder: (_) => const ConfirmDialog(),
                ),
                child: const Text('Confirm'),
              ),
              TextButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  builder: (_) {
                    return FilterSheet();
                  },
                ),
                child: const Text('Filter'),
              ),
            ]);
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.entryPoints.map((entry) => entry.metadata.navigationKind).sort()).toEqual(['bottom_sheet', 'dialog'])
    expect(result.entryPoints.map((entry) => entry.handlerNodeId).sort()).toEqual([
      'r1:lib/dialogs.dart:ConfirmDialog',
      'r1:lib/sheets.dart:FilterSheet',
    ])
  })

  it('does not promote a Scaffold-only widget without navigation evidence', () => {
    const graphNodes = [
      node('r1:lib/stat_card.dart', 'lib/stat_card.dart', 'lib/stat_card.dart', 'file'),
      node('r1:lib/stat_card.dart:StatCard', 'lib/stat_card.dart', 'StatCard'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/stat_card.dart',
      fileNodeId: 'r1:lib/stat_card.dart',
      source: `
        class StatCard extends StatelessWidget {
          Widget build(BuildContext context) {
            return Scaffold(body: Text('Stats'));
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.entryPoints).toEqual([])
    expect(result.suspected).toEqual([])
  })

  it('does not promote nested list item builders inside tab children', () => {
    const graphNodes = [
      node('r1:lib/network.dart', 'lib/network.dart', 'lib/network.dart', 'file'),
      node('r1:lib/network.dart:NetworkPage', 'lib/network.dart', 'NetworkPage'),
      node('r1:lib/network.dart:NetworkCallTile', 'lib/network.dart', 'NetworkCallTile'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/network.dart',
      fileNodeId: 'r1:lib/network.dart',
      source: `
        class NetworkPage extends StatelessWidget {
          Widget build(BuildContext context) {
            return Scaffold(
              body: TabBarView(children: [
                ListView.builder(
                  itemBuilder: (context, index) {
                    return NetworkCallTile();
                  },
                ),
              ]),
            );
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.entryPoints).toEqual([])
    expect(result.suspected).toEqual([])
  })

  it('skips single-child PageView wrappers', () => {
    const graphNodes = [
      node('r1:lib/profile.dart', 'lib/profile.dart', 'lib/profile.dart', 'file'),
      node('r1:lib/profile.dart:ProfilePage', 'lib/profile.dart', 'ProfilePage'),
      node('r1:lib/profile.dart:ProfileDetailsPage', 'lib/profile.dart', 'ProfileDetailsPage'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/profile.dart',
      fileNodeId: 'r1:lib/profile.dart',
      source: `
        class ProfilePage extends StatelessWidget {
          Widget build(BuildContext context) {
            return PageView(children: [
              const ProfileDetailsPage(),
            ]);
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.entryPoints).toEqual([])
    expect(result.suspected).toEqual([])
  })

  it('extracts rootNavigator and navigatorKey push builders', () => {
    const graphNodes = [
      node('r1:lib/admin.dart', 'lib/admin.dart', 'lib/admin.dart', 'file'),
      node('r1:lib/admin.dart:AdminPage', 'lib/admin.dart', 'AdminPage'),
      node('r1:lib/details.dart:RootDetailPage', 'lib/details.dart', 'RootDetailPage'),
      node('r1:lib/details.dart:KeyDetailPage', 'lib/details.dart', 'KeyDetailPage'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/admin.dart',
      fileNodeId: 'r1:lib/admin.dart',
      source: `
        final navigatorKey = GlobalKey<NavigatorState>();
        class AdminPage extends StatelessWidget {
          Widget build(BuildContext context) {
            return Column(children: [
              TextButton(
                onPressed: () => Navigator.of(context, rootNavigator: true).push(
                  MaterialPageRoute(builder: (_) => const RootDetailPage()),
                ),
                child: const Text('Root'),
              ),
              TextButton(
                onPressed: () => navigatorKey.currentState?.push(
                  PageRouteBuilder(pageBuilder: (_, __, ___) => KeyDetailPage()),
                ),
                child: const Text('Key'),
              ),
            ]);
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.suspected).toEqual([])
    expect(result.entryPoints.map((entry) => ({
      fullPath: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
      navigationKind: entry.metadata.navigationKind,
      routeResolution: entry.metadata.routeResolution,
    }))).toEqual([
      {
        fullPath: 'internal://navigator/admin/root-detail',
        handlerNodeId: 'r1:lib/details.dart:RootDetailPage',
        navigationKind: 'navigator_push',
        routeResolution: 'constructor_inferred',
      },
      {
        fullPath: 'internal://navigator/admin/key-detail',
        handlerNodeId: 'r1:lib/details.dart:KeyDetailPage',
        navigationKind: 'navigator_push',
        routeResolution: 'constructor_inferred',
      },
    ])
  })

  it('extracts package navigation calls with direct page constructors', () => {
    const graphNodes = [
      node('r1:lib/home.dart', 'lib/home.dart', 'lib/home.dart', 'file'),
      node('r1:lib/home.dart:HomePage', 'lib/home.dart', 'HomePage'),
      node('r1:lib/go.dart:GoDetailPage', 'lib/go.dart', 'GoDetailPage'),
      node('r1:lib/get.dart:GetDetailPage', 'lib/get.dart', 'GetDetailPage'),
      node('r1:lib/auto.dart:AutoDetailRoute', 'lib/auto.dart', 'AutoDetailRoute'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/home.dart',
      fileNodeId: 'r1:lib/home.dart',
      source: `
        class HomePage extends StatelessWidget {
          Widget build(BuildContext context) {
            return Column(children: [
              TextButton(onPressed: () => context.push(GoDetailPage()), child: const Text('Go')),
              TextButton(onPressed: () => Get.to(() => GetDetailPage()), child: const Text('Get')),
              TextButton(onPressed: () => AutoRouter.of(context).push(AutoDetailRoute()), child: const Text('Auto')),
            ]);
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.suspected).toEqual([])
    expect(result.entryPoints.map((entry) => ({
      fullPath: entry.fullPath,
      handlerNodeId: entry.handlerNodeId,
      navigationKind: entry.metadata.navigationKind,
      routeResolution: entry.metadata.routeResolution,
      evidence: entry.metadata.evidence,
    }))).toEqual([
      {
        fullPath: 'internal://navigator/home/go-detail',
        handlerNodeId: 'r1:lib/go.dart:GoDetailPage',
        navigationKind: 'navigator_push',
        routeResolution: 'constructor_inferred',
        evidence: expect.arrayContaining(['extension_navigation']),
      },
      {
        fullPath: 'internal://navigator/home/get-detail',
        handlerNodeId: 'r1:lib/get.dart:GetDetailPage',
        navigationKind: 'navigator_push',
        routeResolution: 'constructor_inferred',
        evidence: expect.arrayContaining(['package_navigation']),
      },
      {
        fullPath: 'internal://navigator/home/auto-detail-route',
        handlerNodeId: 'r1:lib/auto.dart:AutoDetailRoute',
        navigationKind: 'navigator_push',
        routeResolution: 'constructor_inferred',
        evidence: expect.arrayContaining(['package_navigation']),
      },
    ])
  })

  it('marks dynamic named routes and route factories as suspected', () => {
    const graphNodes = [
      node('r1:lib/home.dart', 'lib/home.dart', 'lib/home.dart', 'file'),
      node('r1:lib/home.dart:HomePage', 'lib/home.dart', 'HomePage'),
    ]
    const result = flutterSemanticAnalyzer.analyzeFile({
      filePath: 'lib/home.dart',
      fileNodeId: 'r1:lib/home.dart',
      source: `
        class HomePage extends StatelessWidget {
          Widget build(BuildContext context) {
            final route = remoteConfig.getString('next_route');
            final factory = routeFactories[route];
            return Column(children: [
              TextButton(onPressed: () => context.goNamed(route), child: const Text('Named')),
              TextButton(onPressed: () => navigatorKey.currentState?.push(factory!(context)), child: const Text('Factory')),
            ]);
          }
        }
      `,
    }, ctx(graphNodes))

    expect(result.entryPoints).toEqual([])
    expect(result.suspected).toEqual([
      {
        nodeId: 'r1:lib/home.dart',
        adapter: 'flutter_semantic',
        reason: 'semantic_navigation_ambiguous',
        contextHint: 'file',
      },
    ])
  })
})
