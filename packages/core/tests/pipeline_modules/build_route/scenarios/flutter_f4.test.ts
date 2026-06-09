// Flutter F4 source fallback — 실사례 시나리오 맥시멈
//
// 5개 어댑터:
//   - flutter_gorouter (supersede_framework): GoRoute 중첩 path 축적, 상수 path
//   - flutter_navigator: onGenerateRoute switch
//   - flutter_getx: GetPage(name: ...)
//   - flutter_auto_route: @AutoRoute(path: ...)
//   - flutter_beamer: BeamLocation.pathBlueprints

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeNode } from '@/db/schema/code_graph.js'
import { buildSourceFallbackEntries } from '@/pipeline_modules/build_route/f4_evaluate_source_fallbacks.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'flutter-f4-'))
  tempDirs.push(dir)
  for (const [filePath, source] of Object.entries(files)) {
    const fullPath = join(dir, filePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, source)
  }
  return dir
}

function fileNode(filePath: string): CodeNode {
  return {
    id: `${REPO}:${filePath}`,
    repoId: REPO,
    type: 'file',
    filePath,
    name: filePath.split('/').pop() ?? filePath,
    lineStart: null, lineEnd: null, signature: null,
    exported: false, isDefaultExport: false, isAsync: false, isTest: false,
    testType: null, docComment: null, parseStatus: 'ok',
    createdAt: '2026-05-15',
  }
}

function classNode(filePath: string, name: string): CodeNode {
  return {
    ...fileNode(filePath),
    id: `${REPO}:${filePath}:${name}`,
    type: 'class',
    name,
  }
}

function run(repoPath: string, nodes: CodeNode[], framework: 'flutter' | 'flutter_gorouter' | 'flutter_navigator' | 'flutter_getx' | 'flutter_auto_route' | 'flutter_beamer' = 'flutter') {
  return buildSourceFallbackEntries({
    repoPath, repoId: REPO,
    stackInfo: { framework: 'flutter', routingLibs: [] },
    detections: [{ framework, detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
    graphNodes: nodes,
    graphEdges: [],
  })
}

// ────────────────────────────────────────────────────────────
// flutter_gorouter — 중첩 path 축적
// ────────────────────────────────────────────────────────────
describe('Flutter F4 — flutter_gorouter (중첩 path)', () => {
  it("GoRoute(path: '/parent', routes: [GoRoute(path: 'child')]) → /parent/child", () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
import 'package:go_router/go_router.dart';

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomePage(),
      routes: [
        GoRoute(
          path: 'users',
          builder: (context, state) => const UsersPage(),
          routes: [
            GoRoute(
              path: ':id',
              builder: (context, state) => const UserDetailPage(),
            ),
          ],
        ),
      ],
    ),
  ],
);
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'UsersPage'), classNode(fp, 'UserDetailPage')], 'flutter_gorouter')
    const gorouter = entries.filter((e) => e.metadata?.adapterId === 'flutter_gorouter')
    const paths = gorouter.map((e) => e.fullPath).sort()
    expect(paths).toEqual(['/', '/users', '/users/:id'])
    expect(gorouter.map((e) => e.metadata?.routeResolution)).toEqual([
      'table_resolved',
      'table_resolved',
      'table_resolved',
    ])
  })

  it("ShellRoute + GoRoute 혼합 (ShellRoute는 path 없음)", () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
final router = GoRouter(
  routes: [
    ShellRoute(
      builder: (context, state, child) => Scaffold(body: child),
      routes: [
        GoRoute(path: '/home', builder: (c, s) => HomePage()),
        GoRoute(path: '/profile', builder: (c, s) => ProfilePage()),
      ],
    ),
  ],
);
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage')], 'flutter_gorouter')
    const gorouter = entries.filter((e) => e.metadata?.adapterId === 'flutter_gorouter')
    expect(gorouter.map((e) => e.fullPath).sort()).toEqual(['/home', '/profile'])
  })

  it("AppRoutes 상수 클래스 + GoRoute(path: AppRoutes.home)", () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
class AppRoutes {
  static const home = '/home';
  static const profile = '/profile';
}

final router = GoRouter(
  routes: [
    GoRoute(path: AppRoutes.home, builder: (c, s) => HomePage()),
    GoRoute(path: AppRoutes.profile, builder: (c, s) => ProfilePage()),
  ],
);
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage')], 'flutter_gorouter')
    const gorouter = entries.filter((e) => e.metadata?.adapterId === 'flutter_gorouter')
    expect(gorouter.map((e) => e.fullPath).sort()).toEqual(['/home', '/profile'])
  })
})

// ────────────────────────────────────────────────────────────
// flutter_navigator — onGenerateRoute switch
// ────────────────────────────────────────────────────────────
describe('Flutter F4 — flutter_navigator (onGenerateRoute)', () => {
  it("switch (settings.name) { case '/home': ... } → /home", () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
Route<dynamic> onGenerateRoute(RouteSettings settings) {
  switch (settings.name) {
    case '/home':
      return MaterialPageRoute(builder: (_) => HomePage());
    case '/profile':
      return MaterialPageRoute(builder: (_) => ProfilePage());
    case '/settings':
      return MaterialPageRoute(builder: (_) => SettingsPage());
  }
  return null;
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage'), classNode(fp, 'SettingsPage')], 'flutter_navigator')
    const nav = entries.filter((e) => e.metadata?.adapterId === 'flutter_navigator')
    expect(nav.map((e) => e.fullPath).sort()).toEqual(['/home', '/profile', '/settings'])
    expect(nav.every((e) => e.metadata?.routeResolution === 'table_resolved')).toBe(true)
  })

  it("static const + onGenerateRoute switch (실사례)", () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
class AppRoutes {
  static const home = '/home';
  static const profile = '/profile';
}

Route<dynamic> onGenerateRoute(RouteSettings settings) {
  switch (settings.name) {
    case AppRoutes.home:
      return MaterialPageRoute(builder: (_) => HomePage());
    case AppRoutes.profile:
      return MaterialPageRoute(builder: (_) => ProfilePage());
  }
  return null;
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage')], 'flutter_navigator')
    const nav = entries.filter((e) => e.metadata?.adapterId === 'flutter_navigator')
    expect(nav.map((e) => e.fullPath).sort()).toEqual(['/home', '/profile'])
  })

  it('case block with intermediate statements before return still resolves the screen (heroines onGenerateRoute)', () => {
    // The real-repo gap: a local var / argument-cast statement BETWEEN `case ...:` and `return MaterialPageRoute`.
    // The old regex assumed `case X: return PageRoute(...)` adjacency, so it dropped any case with a middle line.
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
class AppRoutes {
  static const home = '/home';
  static const profile = '/profile';
  static const shop = '/shop';
}

Route<dynamic> onGenerateRoute(RouteSettings settings) {
  switch (settings.name) {
    case AppRoutes.home:
      return MaterialPageRoute(builder: (_) => HomePage());
    case AppRoutes.profile:
      final args = settings.arguments as ProfileArgs;
      final userId = args.userId;
      return MaterialPageRoute(builder: (_) => ProfilePage(userId: userId));
    case '/shop':
      final ctx = readContext();
      return CupertinoPageRoute(builder: (_) => ShopPage());
  }
  return null;
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage'), classNode(fp, 'ShopPage')], 'flutter_navigator')
    const nav = entries.filter((e) => e.metadata?.adapterId === 'flutter_navigator')
    // all three screens must resolve — including the two whose `return` is preceded by local-var statements
    expect(nav.map((e) => e.fullPath).sort()).toEqual(['/home', '/profile', '/shop'])
  })

  it('a COMMENTED-OUT onGenerateRoute case is NOT extracted as a live screen', () => {
    // gap-check found /ad-debugger-page falsely extracted because its case is commented out in heroines.
    // The block parser must run on comment-stripped source.
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
class AppRoutes {
  static const home = '/home';
  static const debug = '/debug';
}
Route<dynamic> onGenerateRoute(RouteSettings settings) {
  switch (settings.name) {
    case AppRoutes.home:
      return MaterialPageRoute(builder: (_) => HomePage());
    // case AppRoutes.debug:
    //   return MaterialPageRoute(builder: (_) => DebugPage());
  }
  return null;
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'DebugPage')], 'flutter_navigator')
    const nav = entries.filter((e) => e.metadata?.adapterId === 'flutter_navigator')
    expect(nav.map((e) => e.fullPath).sort()).toEqual(['/home']) // /debug is commented out → must NOT appear
  })

  it('a case with a LONG multi-statement builder block (>400 chars before return) still resolves the screen', () => {
    // gap-check found /webview-page MISSED: its builder is `(_) { <many statements>; return WebviewPage(...); }`,
    // exceeding the builder regex char cap so the screen path was never resolved.
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
class AppRoutes {
  static const home = '/home';
  static const webview = '/webview';
}
Route<dynamic> onGenerateRoute(RouteSettings settings) {
  switch (settings.name) {
    case AppRoutes.home:
      return MaterialPageRoute(builder: (_) => HomePage());
    case AppRoutes.webview:
      return MaterialPageRoute(
        builder: (_) {
          final args = (settings.arguments as PageArgument).args as String;
          final parsed = RoutingDomain.parseUrl(args) ?? (null, null, null);
          final queryMap = RoutingDomain.extractQueryMap(parsed);
          final canPop = bool.tryParse(queryMap['canPop'] ?? 'true');
          final isEdgeToEdge = bool.tryParse(queryMap['isEdgeToEdge'] ?? 'false');
          final hostPadding = computeWebviewHostContainerPaddingFromConfig(canPop, isEdgeToEdge);
          return WebviewPage(url: args, canPop: canPop, isEdgeToEdge: isEdgeToEdge, padding: hostPadding);
        },
      );
  }
  return null;
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'WebviewPage')], 'flutter_navigator')
    const nav = entries.filter((e) => e.metadata?.adapterId === 'flutter_navigator')
    expect(nav.map((e) => e.fullPath).sort()).toEqual(['/home', '/webview'])
  })

  it('MaterialApp routes map resolves literal and constant keys', () => {
    const fp = 'lib/app.dart'
    const path = tempRepo({
      [fp]: `
class AppRoutes {
  static const home = '/home';
}

MaterialApp(
  routes: {
    AppRoutes.home: (_) => const HomePage(),
    '/profile': (_) {
      return ProfilePage();
    },
  },
);
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage')], 'flutter_navigator')
    const nav = entries.filter((e) => e.metadata?.adapterId === 'flutter_navigator')
    expect(nav.map((e) => ({
      path: e.fullPath,
      handler: e.handlerNodeId,
      resolution: e.metadata?.routeResolution,
    })).sort((a, b) => String(a.path).localeCompare(String(b.path)))).toEqual([
      { path: '/home', handler: `${REPO}:${fp}:HomePage`, resolution: 'table_resolved' },
      { path: '/profile', handler: `${REPO}:${fp}:ProfilePage`, resolution: 'table_resolved' },
    ])
  })
})

// ────────────────────────────────────────────────────────────
// flutter_getx — GetPage
// ────────────────────────────────────────────────────────────
describe('Flutter F4 — flutter_getx', () => {
  it("GetPage(name: '/home', page: () => HomePage())", () => {
    const fp = 'lib/routes.dart'
    const path = tempRepo({
      [fp]: `
import 'package:get/get.dart';

final routes = [
  GetPage(name: '/home', page: () => HomePage()),
  GetPage(name: '/profile', page: () => ProfilePage()),
  GetPage(name: '/settings', page: () => SettingsPage()),
];
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage'), classNode(fp, 'SettingsPage')], 'flutter_getx')
    const getx = entries.filter((e) => e.metadata?.adapterId === 'flutter_getx')
    expect(getx.map((e) => e.fullPath).sort()).toEqual(['/home', '/profile', '/settings'])
  })

  it("GetPage with named parameter '/user/:id'", () => {
    const fp = 'lib/routes.dart'
    const path = tempRepo({
      [fp]: `
final routes = [
  GetPage(name: '/user/:id', page: () => UserPage()),
];
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'UserPage')], 'flutter_getx')
    const getx = entries.filter((e) => e.metadata?.adapterId === 'flutter_getx')
    expect(getx.map((e) => e.fullPath)).toEqual(['/user/:id'])
  })

  it('GetPage resolves route name constants', () => {
    const fp = 'lib/routes.dart'
    const path = tempRepo({
      [fp]: `
class Routes {
  static const home = '/home';
  static const profile = '/profile';
}

final routes = [
  GetPage(name: Routes.home, page: () => HomePage()),
  GetPage(name: Routes.profile, page: () => ProfilePage()),
];
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage')], 'flutter_getx')
    const getx = entries.filter((e) => e.metadata?.adapterId === 'flutter_getx')
    expect(getx.map((e) => e.fullPath).sort()).toEqual(['/home', '/profile'])
    expect(getx.every((e) => e.metadata?.routeResolution === 'table_resolved')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// flutter_auto_route — @AutoRoute / @RoutePage
// ────────────────────────────────────────────────────────────
describe('Flutter F4 — flutter_auto_route', () => {
  it("AutoRoute config (path 명시)", () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
import 'package:auto_route/auto_route.dart';

@AutoRouterConfig()
class AppRouter extends \$AppRouter {
  @override
  List<AutoRoute> get routes => [
    AutoRoute(path: '/home', page: HomeRoute.page),
    AutoRoute(path: '/profile', page: ProfileRoute.page),
  ];
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage')], 'flutter_auto_route')
    const ar = entries.filter((e) => e.metadata?.adapterId === 'flutter_auto_route')
    expect(ar.map((e) => e.fullPath).sort()).toEqual(['/home', '/profile'])
  })

  it('AutoRoute resolves path constants and generated route pages', () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
class AppRoutes {
  static const orders = '/orders';
}

@AutoRouterConfig()
class AppRouter extends $AppRouter {
  @override
  List<AutoRoute> get routes => [
    AutoRoute(path: AppRoutes.orders, page: OrdersRoute.page),
  ];
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'OrdersPage')], 'flutter_auto_route')
    const ar = entries.filter((e) => e.metadata?.adapterId === 'flutter_auto_route')
    expect(ar.map((e) => ({
      path: e.fullPath,
      handler: e.handlerNodeId,
      resolution: e.metadata?.routeResolution,
    }))).toEqual([
      { path: '/orders', handler: `${REPO}:${fp}:OrdersPage`, resolution: 'table_resolved' },
    ])
  })
})

// ────────────────────────────────────────────────────────────
// flutter_beamer — BeamLocation
// ────────────────────────────────────────────────────────────
describe('Flutter F4 — flutter_beamer', () => {
  it("BeamLocation pathBlueprints", () => {
    const fp = 'lib/locations.dart'
    const path = tempRepo({
      [fp]: `
class HomeLocation extends BeamLocation<BeamState> {
  @override
  List<String> get pathBlueprints => ['/', '/home'];
  @override
  List<BeamPage> buildPages(BuildContext context, BeamState state) => [
    const BeamPage(key: ValueKey('home'), child: HomePage()),
  ];
}

class ProfileLocation extends BeamLocation<BeamState> {
  @override
  List<String> get pathBlueprints => ['/profile', '/profile/:id'];
  @override
  List<BeamPage> buildPages(BuildContext context, BeamState state) => [
    const BeamPage(key: ValueKey('profile'), child: ProfilePage()),
  ];
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file, classNode(fp, 'HomePage'), classNode(fp, 'ProfilePage')], 'flutter_beamer')
    const beamer = entries.filter((e) => e.metadata?.adapterId === 'flutter_beamer')
    expect(beamer.map((e) => e.fullPath).sort()).toEqual(['/', '/home', '/profile', '/profile/:id'])
    expect(beamer.find((e) => e.fullPath === '/home')?.handlerNodeId).toBe(`${REPO}:${fp}:HomePage`)
    expect(beamer.find((e) => e.fullPath === '/profile/:id')?.handlerNodeId).toBe(`${REPO}:${fp}:ProfilePage`)
    expect(beamer.every((e) => e.metadata?.routeResolution === 'table_resolved')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// 거부 케이스
// ────────────────────────────────────────────────────────────
describe('Flutter F4 — 거부 케이스', () => {
  it('flutter framework 비활성 → 0건', () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
final router = GoRouter(routes: [
  GoRoute(path: '/home', builder: (c, s) => HomePage()),
]);
`,
    })
    const file = fileNode(fp)
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [{ framework: 'express', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file],
      graphEdges: [],
    })
    expect(entries.filter((e) => String(e.metadata?.adapterId ?? '').startsWith('flutter'))).toHaveLength(0)
  })
})
