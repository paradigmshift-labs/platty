/**
 * build_relations navigation / external_link 시나리오 테스트
 * SOT: specs/build_relations/architecture.md §5.3 §5.4
 * 시나리오: REL-S04, REL-S05, REL-S17, REL-S18, REL-S19, REL-S20, REL-S21
 *           REL-N05, REL-N06, REL-N13
 */

import { describe, it, expect } from 'vitest'
import type { BuildRelationsInputs, SourceFallback } from '@/pipeline_modules/build_relations/types.js'
import { buildSemanticIndex } from '@/pipeline_modules/build_relations/semantic_index.js'
import { extractCandidates } from '@/pipeline_modules/build_relations/candidates/index.js'
import { resolveCandidates } from '@/pipeline_modules/build_relations/resolvers/index.js'
import { normalizeRelations } from '@/pipeline_modules/build_relations/normalize_relations.js'
import type { CodeNodeLike, CodeEdgeLike, ModelLookup } from '@/pipeline_modules/build_relations/types.js'

// ── helpers ──────────────────────────────────────────────

const REPO_ID = 'repo_nav'

function makeInputs(partial: {
  nodes: CodeNodeLike[]
  edges: CodeEdgeLike[]
  models?: ModelLookup[]
  repoPath?: string
  entryPoints?: BuildRelationsInputs['entryPoints']
}): BuildRelationsInputs {
  return {
    repoId: REPO_ID,
    repoPath: partial.repoPath ?? null,
    includeTestSources: false,
    nodes: partial.nodes,
    edges: partial.edges,
    models: partial.models ?? [],
    entryPoints: partial.entryPoints,
  }
}

let edgeId = 2000
function makeNode(id: string, opts: Partial<CodeNodeLike> = {}): CodeNodeLike {
  return {
    id,
    repoId: REPO_ID,
    type: 'method',
    name: id.split(':').pop() ?? id,
    filePath: 'src/component.tsx',
    lineStart: 1,
    lineEnd: 10,
    isTest: false,
    parseStatus: 'ok',
    ...opts,
  }
}

function makeEdge(sourceId: string, relation: string, opts: Partial<CodeEdgeLike> = {}): CodeEdgeLike {
  return {
    id: edgeId++,
    repoId: REPO_ID,
    sourceId,
    targetId: null,
    relation,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'resolved',
    confidence: null,
    source: 'static',
    ...opts,
  }
}

function runPipeline(inputs: BuildRelationsInputs, sourceFallback?: Partial<SourceFallback>) {
  const index = buildSemanticIndex(inputs)
  const candidates = extractCandidates(inputs, index)
  const extracted = resolveCandidates(
    candidates,
    index,
    { resolveConstant: () => null, ...sourceFallback },
  )
  return normalizeRelations(extracted)
}

// ── REL-S04: Next.js Link ─────────────────────────────────

describe('REL-S04: Next.js <Link href="/profile">', () => {
  it('next/link import + Link renders edge → navigation link /profile', () => {
    const compNode = makeNode(`${REPO_ID}:src/nav.tsx:NavBar`)

    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'next/link', targetSymbol: 'Link' }),
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'Link',
        firstArg: '/profile',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('navigation')
    expect(result[0].target).toBe('/profile')
    expect(result[0].operation).toBe('link')
    expect(result[0].canonicalTarget).toBe('screen:/profile')
    expect(result[0].payload).toMatchObject({ router: 'nextjs', adapter: 'link_render' })
  })
})

describe('Next.js server-side redirect navigation', () => {
  it('permanentRedirect("/welcome") from next/navigation resolves to navigation', () => {
    const actionNode = makeNode(`${REPO_ID}:app/signup/actions.ts:createWorkspace`, { filePath: 'app/signup/actions.ts' })

    const edges = [
      makeEdge(actionNode.id, 'imports', { targetSpecifier: 'next/navigation', targetSymbol: 'permanentRedirect' }),
      makeEdge(actionNode.id, 'calls', { targetSymbol: 'permanentRedirect', firstArg: '/welcome' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [actionNode], edges }))

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'navigation',
        operation: 'permanentRedirect',
        target: '/welcome',
        canonicalTarget: 'screen:/welcome',
        payload: expect.objectContaining({ router: 'nextjs', adapter: 'router_call' }),
      }),
    ])
  })
})

describe('React Wouter navigation', () => {
  it('wouter Link href renders edge resolves to navigation', () => {
    const compNode = makeNode(`${REPO_ID}:src/App.tsx:HomePage`)

    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'wouter', targetSymbol: 'Link' }),
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'Link',
        firstArg: '/accounts',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'navigation',
        operation: 'link',
        target: '/accounts',
        canonicalTarget: 'screen:/accounts',
        payload: expect.objectContaining({ router: 'wouter', adapter: 'link_render' }),
      }),
    ])
  })

  it('wouter useLocation setter call resolves to navigation', () => {
    const compNode = makeNode(`${REPO_ID}:src/App.tsx:HomePage`)

    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'wouter', targetSymbol: 'useLocation' }),
      makeEdge(compNode.id, 'calls', { targetSymbol: 'useLocation' }),
      makeEdge(compNode.id, 'calls', { targetSymbol: 'setLocation', firstArg: '/accounts' }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'navigation',
        operation: 'setLocation',
        target: '/accounts',
        canonicalTarget: 'screen:/accounts',
        payload: expect.objectContaining({ router: 'wouter', adapter: 'router_call' }),
      }),
    ])
  })
})

describe('Next/React static target constants', () => {
  it('Link renders edge with a route constant resolves through source fallback', () => {
    const compNode = makeNode(`${REPO_ID}:src/nav.tsx:NavBar`)

    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'next/link', targetSymbol: 'Link' }),
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'Link',
        firstArg: 'ROUTES.orders',
      }),
    ]

    const result = runPipeline(
      makeInputs({ nodes: [compNode], edges }),
      { resolveConstant: ({ identifier }) => identifier === 'ROUTES.orders' ? '/orders' : null },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/orders',
      canonicalTarget: 'screen:/orders',
      confidence: 'medium',
      payload: { router: 'nextjs', adapter: 'link_render' },
    })
  })

  it('lowercase anchor renders edge with an external constant resolves through source fallback', () => {
    const compNode = makeNode(`${REPO_ID}:src/footer.tsx:Footer`)

    const edges = [
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'a',
        firstArg: 'EXTERNAL_LINKS.support',
      }),
    ]

    const result = runPipeline(
      makeInputs({ nodes: [compNode], edges }),
      {
        resolveConstant: ({ identifier, allowedScopes }) => {
          expect(allowedScopes).toEqual(['external'])
          return identifier === 'EXTERNAL_LINKS.support' ? 'mailto:support@example.com' : null
        },
      },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'mailto:support@example.com',
      canonicalTarget: 'external:mailto:support@example.com',
      operation: 'link',
      payload: { scheme: 'mailto', adapter: 'html_external_link' },
    })
  })

  it('window.location.href assignment edge resolves as browser external link', () => {
    const compNode = makeNode(`${REPO_ID}:src/home.tsx:Home`)

    const edges = [
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'assign',
        chainPath: 'window.location',
        firstArg: 'https://seller.example.com',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'https://seller.example.com',
      canonicalTarget: 'external:https://seller.example.com',
      operation: 'open',
      payload: { scheme: 'https', adapter: 'browser_external_link', receiver: 'window.location' },
    })
  })
})

describe('Next/React link render adapter graph trace', () => {
  it('react-router-dom Link renders edge resolves internal route', () => {
    const compNode = makeNode(`${REPO_ID}:src/nav.tsx:NavBar`)
    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'react-router-dom', targetSymbol: 'Link' }),
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'Link',
        firstArg: '/settings',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/settings',
      operation: 'link',
      payload: { router: 'react_router', adapter: 'link_render' },
    })
  })

  it('react-router-dom Navigate renders edge resolves redirect route', () => {
    const compNode = makeNode(`${REPO_ID}:src/guard.tsx:AuthGuard`)
    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'react-router-dom', targetSymbol: 'Navigate' }),
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'Navigate',
        firstArg: '/login',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/login',
      operation: 'redirect',
      payload: { router: 'react_router', adapter: 'link_render' },
    })
  })

  it('does not emit Link renders without a router import', () => {
    const compNode = makeNode(`${REPO_ID}:src/nav.tsx:NavBar`)
    const edges = [
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'Link',
        firstArg: '/settings',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))
    expect(result.filter((r) => r.kind === 'navigation')).toHaveLength(0)
  })
})

// ── REL-S17: Flutter GoRouter context.go ─────────────────

describe('REL-S17: Flutter GoRouter context.go("/profile")', () => {
  it('go_router import + context.go("/profile") → navigation go /profile flutter_gorouter', () => {
    const widgetNode = makeNode(`${REPO_ID}:lib/nav.dart:goProfile`, { filePath: 'lib/nav.dart' })

    const edges = [
      makeEdge(widgetNode.id, 'imports', { targetSpecifier: 'go_router', targetSymbol: 'GoRouter' }),
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: 'go',
        chainPath: 'context',
        firstArg: '/profile',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [widgetNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('navigation')
    expect(result[0].target).toBe('/profile')
    expect(result[0].operation).toBe('go')
    expect(result[0].canonicalTarget).toBe('screen:/profile')
    expect(result[0].payload).toMatchObject({ router: 'flutter_gorouter', adapter: 'router_call' })
  })
})

// ── REL-S18: Flutter GetX Get.toNamed ────────────────────

describe('REL-S18: Flutter GetX Get.toNamed("/settings")', () => {
  it('get import + Get.toNamed("/settings") → navigation toNamed /settings flutter_getx', () => {
    const widgetNode = makeNode(`${REPO_ID}:lib/settings.dart:goSettings`, { filePath: 'lib/settings.dart' })

    const edges = [
      makeEdge(widgetNode.id, 'imports', { targetSpecifier: 'get', targetSymbol: 'Get' }),
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: 'toNamed',
        chainPath: 'Get',
        firstArg: '/settings',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [widgetNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('navigation')
    expect(result[0].target).toBe('/settings')
    expect(result[0].operation).toBe('toNamed')
    expect(result[0].canonicalTarget).toBe('screen:/settings')
    expect(result[0].payload).toMatchObject({ router: 'flutter_getx' })
  })
})

describe('fixture: Flutter router receiver anchors without import specifier', () => {
  it.each([
    ['context', 'push', '/profile', 'flutter_gorouter'],
    ['Navigator', 'pushNamed', '/profile', 'flutter_navigator'],
    ['Get', 'offAllNamed', '/settings', 'flutter_getx'],
    ['context.router', 'pushNamed', '/details', 'flutter_auto_route'],
    ['AutoRouter.of()', 'replaceNamed', '/settings', 'flutter_auto_route'],
    ['Beamer.of()', 'beamToReplacementNamed', '/settings', 'flutter_beamer'],
  ])('%s.%s("%s") → navigation %s', (chainPath, method, target, router) => {
    const widgetNode = makeNode(`${REPO_ID}:lib/main.dart:${router}:${method}`, { filePath: 'lib/main.dart' })

    const edges = [
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: method,
        chainPath,
        firstArg: target,
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [widgetNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target,
      operation: method,
      canonicalTarget: `screen:${target}`,
      payload: { router, target_path: target, adapter: 'router_call' },
    })
  })
})

describe('Flutter route definition and wrapper adapters', () => {
  it('go_router GoRoute literal path defines a navigation target', () => {
    const routeNode = makeNode(`${REPO_ID}:lib/router.dart:router`, { filePath: 'lib/router.dart' })
    const edges = [
      makeEdge(routeNode.id, 'imports', { targetSpecifier: 'go_router', targetSymbol: 'GoRoute' }),
      makeEdge(routeNode.id, 'calls', {
        targetSymbol: 'GoRoute',
        literalArgs: '[{"path":"/profile","builder":null}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [routeNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/profile',
      operation: 'route_definition',
      canonicalTarget: 'screen:/profile',
      payload: {
        router: 'flutter_gorouter',
        adapter: 'flutter_route_definition',
        component: 'GoRoute',
      },
    })
  })

  it('go_router redirect guard string defines a redirect navigation target', () => {
    const repoPath = `${process.cwd()}/tests/fixtures/static_analysis/flutter-gorouter-guard-fullcycle/app`
    const fileNode = makeNode(`${REPO_ID}:lib/main.dart`, { type: 'file', name: 'lib/main.dart', filePath: 'lib/main.dart' })
    const dashboardNode = makeNode(`${REPO_ID}:lib/pages/dashboard_page.dart:DashboardPage`, {
      type: 'class',
      name: 'DashboardPage',
      filePath: 'lib/pages/dashboard_page.dart',
    })

    const result = runPipeline(makeInputs({
      repoPath,
      nodes: [fileNode, dashboardNode],
      edges: [],
      entryPoints: [{
        id: 'entry-dashboard',
        repoId: REPO_ID,
        nodeId: dashboardNode.id,
        kind: 'page',
        routePath: '/dashboard',
      }],
    }))

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceNodeId: dashboardNode.id,
        kind: 'navigation',
        target: '/login?from=${state.uri.path}',
        operation: 'redirect',
        canonicalTarget: 'screen:/login?from=${state.uri.path}',
        payload: expect.objectContaining({
          router: 'flutter_gorouter',
          adapter: 'flutter_gorouter_redirect',
          route_path: '/dashboard',
        }),
        evidenceNodeIds: [fileNode.id, 'entry:entry-dashboard'],
      }),
    ]))
  })

  it('GetPage name property defines a GetX navigation target', () => {
    const routeNode = makeNode(`${REPO_ID}:lib/pages.dart:pages`, { filePath: 'lib/pages.dart' })
    const edges = [
      makeEdge(routeNode.id, 'imports', { targetSpecifier: 'get', targetSymbol: 'GetPage' }),
      makeEdge(routeNode.id, 'calls', {
        targetSymbol: 'GetPage',
        literalArgs: '[{"name":"/settings","page":null}]',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [routeNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/settings',
      operation: 'route_definition',
      payload: { router: 'flutter_getx', adapter: 'flutter_route_definition' },
    })
  })

  it('AutoRoute firstArg path defines an auto_route navigation target', () => {
    const routeNode = makeNode(`${REPO_ID}:lib/app_router.dart:routes`, { filePath: 'lib/app_router.dart' })
    const edges = [
      makeEdge(routeNode.id, 'imports', { targetSpecifier: 'auto_route', targetSymbol: 'AutoRoute' }),
      makeEdge(routeNode.id, 'calls', {
        targetSymbol: 'AutoRoute',
        firstArg: '/details',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [routeNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/details',
      operation: 'route_definition',
      payload: { router: 'flutter_auto_route', adapter: 'flutter_route_definition' },
    })
  })

  it('caller to semantic wrapper follows wrapper router call one hop', () => {
    const buttonNode = makeNode(`${REPO_ID}:lib/profile_button.dart:onTap`, { filePath: 'lib/profile_button.dart' })
    const wrapperNode = makeNode(`${REPO_ID}:lib/nav_helpers.dart:openProfile`, { filePath: 'lib/nav_helpers.dart' })
    const edges = [
      makeEdge(wrapperNode.id, 'imports', { targetSpecifier: 'go_router', targetSymbol: 'GoRouter' }),
      makeEdge(wrapperNode.id, 'calls', {
        targetSymbol: 'go',
        chainPath: 'context',
        firstArg: '/profile',
      }),
      makeEdge(buttonNode.id, 'calls', {
        targetId: wrapperNode.id,
        targetSymbol: 'openProfile',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [buttonNode, wrapperNode], edges }))
    const rel = result.find((r) => (
      r.sourceNodeId === buttonNode.id
      && r.kind === 'navigation'
      && r.target === '/profile'
    ))

    expect(rel).toMatchObject({
      operation: 'wrapper_call',
      canonicalTarget: 'screen:/profile',
      payload: {
        router: 'flutter_gorouter',
        adapter: 'flutter_navigation_wrapper',
        wrapper: 'openProfile',
        wrapped_method: 'go',
      },
    })
  })

  it('does not emit route definitions for unresolvable dynamic paths', () => {
    const routeNode = makeNode(`${REPO_ID}:lib/router.dart:router`, { filePath: 'lib/router.dart' })
    const edges = [
      makeEdge(routeNode.id, 'imports', { targetSpecifier: 'go_router', targetSymbol: 'GoRoute' }),
      makeEdge(routeNode.id, 'calls', {
        targetSymbol: 'GoRoute',
        firstArg: 'profilePath',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [routeNode], edges }))
    expect(result.filter((r) => r.kind === 'navigation')).toHaveLength(0)
  })
})

// ── REL-S19: Flutter BottomNavigation constant fallback ───

describe('REL-S19: Flutter BottomNavigationBar with constant fallback', () => {
  it('context.go(_routes) + go_router + BottomNavigationBar render + fallback → navigation bottom_nav', () => {
    const widgetNode = makeNode(`${REPO_ID}:lib/shell.dart:Shell`, { filePath: 'lib/shell.dart' })

    const edges = [
      makeEdge(widgetNode.id, 'imports', { targetSpecifier: 'go_router', targetSymbol: 'GoRouter' }),
      makeEdge(widgetNode.id, 'renders', { targetSymbol: 'BottomNavigationBar' }),
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: 'go',
        chainPath: 'context',
        firstArg: '_routes',
      }),
    ]

    const result = runPipeline(
      makeInputs({ nodes: [widgetNode], edges }),
      { resolveConstant: ({ identifier }) => identifier === '_routes' ? '/home' : null },
    )

    const rel = result.find((r) => r.kind === 'navigation')
    expect(rel).toBeDefined()
    expect(rel?.target).toBe('/home')
    expect(rel?.canonicalTarget).toBe('screen:/home')
    expect(rel?.payload).toMatchObject({ surface: 'bottom_nav', adapter: 'router_call' })
  })
})

// ── REL-S05: HTML anchor external link ───────────────────

describe('REL-S05: <a href="https://example.com/help">', () => {
  it('a renders edge with external URL → external_link', () => {
    const compNode = makeNode(`${REPO_ID}:src/footer.tsx:Footer`)

    const edges = [
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'a',
        firstArg: 'https://example.com/help',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('external_link')
    expect(result[0].target).toBe('https://example.com/help')
    expect(result[0].canonicalTarget).toBe('external:https://example.com/help')
    expect(result[0].payload).toMatchObject({ scheme: 'https', adapter: 'html_external_link' })
  })
})

describe('HTML/React external link adapter', () => {
  it('area mailto href emits external_link with mailto scheme', () => {
    const compNode = makeNode(`${REPO_ID}:src/contact.tsx:ContactMap`)
    const edges = [
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'area',
        firstArg: 'mailto:support@example.com',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'mailto:support@example.com',
      operation: 'link',
      canonicalTarget: 'external:mailto:support@example.com',
      payload: { scheme: 'mailto', adapter: 'html_external_link', component: 'area' },
    })
  })

  it('Next Link with external URL emits external_link rather than navigation', () => {
    const compNode = makeNode(`${REPO_ID}:src/footer.tsx:DocsLink`)
    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'next/link', targetSymbol: 'Link' }),
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'Link',
        firstArg: 'https://docs.example.com/start',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result.filter((r) => r.kind === 'navigation')).toHaveLength(0)
    expect(result.filter((r) => r.kind === 'external_link')).toHaveLength(1)
    expect(result[0]).toMatchObject({
      target: 'https://docs.example.com/start',
      payload: { scheme: 'https', adapter: 'react_external_link', component: 'Link' },
    })
  })

  it('internal anchor href is not treated as external_link', () => {
    const compNode = makeNode(`${REPO_ID}:src/footer.tsx:InternalAnchor`)
    const edges = [
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'a',
        firstArg: '/terms',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))
    expect(result.filter((r) => r.kind === 'external_link')).toHaveLength(0)
  })
})

describe('Browser external link adapter', () => {
  it('window.open external URL emits external_link', () => {
    const compNode = makeNode(`${REPO_ID}:src/help.tsx:openHelp`)
    const edges = [
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'open',
        chainPath: 'window',
        firstArg: 'https://help.example.com',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'https://help.example.com',
      operation: 'open',
      canonicalTarget: 'external:https://help.example.com',
      payload: { adapter: 'browser_external_link', receiver: 'window' },
    })
  })

  it('location.assign external URL emits external_link', () => {
    const compNode = makeNode(`${REPO_ID}:src/redirect.ts:redirectToDocs`)
    const edges = [
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'assign',
        chainPath: 'location',
        firstArg: 'https://docs.example.com',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'https://docs.example.com',
      payload: { adapter: 'browser_external_link', receiver: 'location' },
    })
  })

  it('window.open internal route is not treated as external_link', () => {
    const compNode = makeNode(`${REPO_ID}:src/help.tsx:openInternal`)
    const edges = [
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'open',
        chainPath: 'window',
        firstArg: '/help',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))
    expect(result.filter((r) => r.kind === 'external_link')).toHaveLength(0)
  })
})

describe('Mobile deep link custom scheme adapter', () => {
  it('custom app scheme in anchor emits external_link', () => {
    const compNode = makeNode(`${REPO_ID}:src/mobile.tsx:OpenApp`)
    const edges = [
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'a',
        firstArg: 'myapp://orders/123',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'myapp://orders/123',
      canonicalTarget: 'external:myapp://orders/123',
      payload: { scheme: 'myapp', adapter: 'html_external_link' },
    })
  })

  it('custom app scheme in url_launcher emits external_link', () => {
    const widgetNode = makeNode(`${REPO_ID}:lib/deeplink.dart:openOrder`, { filePath: 'lib/deeplink.dart' })
    const edges = [
      makeEdge(widgetNode.id, 'imports', { targetSpecifier: 'url_launcher', targetSymbol: 'launchUrl' }),
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: 'launchUrl',
        firstArg: 'myapp://orders/123',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [widgetNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'myapp://orders/123',
      payload: { scheme: 'myapp', adapter: 'url_launcher' },
    })
  })

  it('unsafe javascript href is not emitted as external_link', () => {
    const compNode = makeNode(`${REPO_ID}:src/mobile.tsx:UnsafeLink`)
    const edges = [
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'a',
        firstArg: 'javascript:alert(1)',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))
    expect(result.filter((r) => r.kind === 'external_link')).toHaveLength(0)
  })
})

// ── REL-S20: url_launcher tel: ───────────────────────────

describe('REL-S20: launchUrl(Uri.parse("tel:1234567890"))', () => {
  it('url_launcher import + launchUrl("tel:1234567890") → external_link tel', () => {
    const widgetNode = makeNode(`${REPO_ID}:lib/contact.dart:callPhone`, { filePath: 'lib/contact.dart' })

    const edges = [
      makeEdge(widgetNode.id, 'imports', { targetSpecifier: 'url_launcher', targetSymbol: 'launchUrl' }),
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: 'launchUrl',
        chainPath: null,
        firstArg: 'tel:1234567890',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [widgetNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('external_link')
    expect(result[0].target).toBe('tel:1234567890')
    expect(result[0].canonicalTarget).toBe('external:tel:1234567890')
    expect(result[0].payload).toMatchObject({ scheme: 'tel', adapter: 'url_launcher' })
  })
})

// ── REL-S21: intent:// deep link ─────────────────────────

describe('REL-S21: intent:// deep link', () => {
  it('url_launcher + launchUrl("intent://...") → external_link intent', () => {
    const widgetNode = makeNode(`${REPO_ID}:lib/qr.dart:openScanner`, { filePath: 'lib/qr.dart' })

    const edges = [
      makeEdge(widgetNode.id, 'imports', { targetSpecifier: 'url_launcher', targetSymbol: 'launchUrl' }),
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: 'launchUrl',
        chainPath: null,
        firstArg: 'intent://scan/#Intent;scheme=zxing;end',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [widgetNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('external_link')
    expect(result[0].payload).toMatchObject({ scheme: 'intent' })
  })
})

// ── REL-N05: dynamic route no-emit ───────────────────────

describe('REL-N05: dynamic route argument — no-emit', () => {
  it('router.push(nextPath) unresolvable identifier → no navigation', () => {
    const compNode = makeNode(`${REPO_ID}:src/nav.tsx:navigate`, { filePath: 'src/nav.tsx' })

    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'next/router', targetSymbol: 'useRouter' }),
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: 'nextPath',  // unresolvable identifier
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))
    expect(result.filter((r) => r.kind === 'navigation')).toHaveLength(0)
  })
})

describe('graph resolved route arguments', () => {
  it('router.push(nextPath) uses argExpressions.resolved before source fallback', () => {
    const compNode = makeNode(`${REPO_ID}:src/nav.tsx:navigate`, { filePath: 'src/nav.tsx' })

    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'next/router', targetSymbol: 'useRouter' }),
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: null,
        argExpressions: [{
          index: 0,
          kind: 'identifier',
          raw: 'nextPath',
          resolution: 'static',
          resolved: { index: 0, kind: 'string', raw: "'/dashboard/products'", value: '/dashboard/products', resolution: 'static' },
        }],
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/dashboard/products',
      operation: 'push',
      confidence: 'high',
    })
  })
})

// ── REL-N06: Link with external URL → external_link ──────

describe('REL-N06: <Link href="https://external.com"> → external_link not navigation', () => {
  it('react-router-dom import + Link with external URL → external_link row', () => {
    const compNode = makeNode(`${REPO_ID}:src/footer.tsx:ExternalLink`)

    const edges = [
      makeEdge(compNode.id, 'imports', {
        targetSpecifier: 'react-router-dom', targetSymbol: 'Link',
      }),
      makeEdge(compNode.id, 'renders', {
        targetSymbol: 'Link',
        firstArg: 'https://external.com/page',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result.filter((r) => r.kind === 'navigation')).toHaveLength(0)
    expect(result.filter((r) => r.kind === 'external_link')).toHaveLength(1)
    expect(result[0].target).toBe('https://external.com/page')
    expect(result[0].payload).toMatchObject({ adapter: 'react_external_link' })
  })
})

// ── REL-N13: Flutter dynamic route no-emit ───────────────

describe('REL-N13: Flutter dynamic route identifier — no-emit', () => {
  it('context.go(routePath) unresolvable → no navigation', () => {
    const widgetNode = makeNode(`${REPO_ID}:lib/nav.dart:dynNav`, { filePath: 'lib/nav.dart' })

    const edges = [
      makeEdge(widgetNode.id, 'imports', { targetSpecifier: 'go_router', targetSymbol: 'GoRouter' }),
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: 'go',
        chainPath: 'context',
        firstArg: 'routePath',  // unresolvable identifier
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [widgetNode], edges }))
    expect(result.filter((r) => r.kind === 'navigation')).toHaveLength(0)
  })
})

describe('real project regressions: router/navigation variants', () => {
  it('router.push("/dashboard/products") with useRouter call but missing import specifier emits Next navigation', () => {
    const compNode = makeNode(`${REPO_ID}:src/context/RunAsContext.tsx:RunAsProvider`, {
      filePath: 'src/context/RunAsContext.tsx',
    })
    const edges = [
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'useRouter',
        chainPath: null,
      }),
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: '/dashboard/products',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/dashboard/products',
      operation: 'push',
      canonicalTarget: 'screen:/dashboard/products',
      payload: { router: 'nextjs' },
    })
  })

  it('Navigator.of(context).pushNamed(AppRoutes.friendListPage) emits Flutter navigation', () => {
    const widgetNode = makeNode(`${REPO_ID}:lib/pages/profile/widget/profile_status_widget.dart:onTap`, {
      filePath: 'lib/pages/profile/widget/profile_status_widget.dart',
    })
    const edges = [
      makeEdge(widgetNode.id, 'calls', {
        targetSymbol: 'pushNamed',
        chainPath: 'Navigator.of()',
        firstArg: 'AppRoutes.friendListPage',
      }),
    ]

    const result = runPipeline(
      makeInputs({ nodes: [widgetNode], edges }),
      { resolveConstant: ({ identifier }) => identifier === 'AppRoutes.friendListPage' ? '/friend-list' : null },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'navigation',
      target: '/friend-list',
      operation: 'pushNamed',
      canonicalTarget: 'screen:/friend-list',
      payload: { router: 'flutter_navigator' },
    })
  })

  it('router.push("https://abr.ge/czeb2a") emits external_link instead of dropping the edge', () => {
    const compNode = makeNode(`${REPO_ID}:src/page.tsx:goExternal`, {
      filePath: 'src/page.tsx',
    })
    const edges = [
      makeEdge(compNode.id, 'imports', { targetSpecifier: 'next/navigation', targetSymbol: 'useRouter' }),
      makeEdge(compNode.id, 'calls', {
        targetSymbol: 'push',
        chainPath: 'router',
        firstArg: 'https://abr.ge/czeb2a',
      }),
    ]

    const result = runPipeline(makeInputs({ nodes: [compNode], edges }))

    expect(result.filter((r) => r.kind === 'navigation')).toHaveLength(0)
    expect(result.filter((r) => r.kind === 'external_link')).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'external_link',
      target: 'https://abr.ge/czeb2a',
      operation: 'open',
      payload: { adapter: 'router_external_link', method: 'push', router: 'nextjs' },
    })
  })
})
