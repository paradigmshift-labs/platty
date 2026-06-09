import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FLUTTER_ROUTER_PACKAGES,
  LINK_RENDER_ROUTER_PACKAGES,
  NAVIGATION_ROUTER_PACKAGES,
  ROUTER_METHODS,
  flutterRouterForPackage,
  routerForLinkRenderPackage,
  routerForNavigationPackage,
  routerSupportsMethod,
} from '@/pipeline_modules/build_relations/adapters/navigation/packages.js'

const ROUTER_CALL_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/navigation/router_calls.ts',
)
const LINK_RENDER_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/navigation/link_renders.ts',
)
const FLUTTER_ROUTE_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/navigation/flutter_routes.ts',
)

describe('navigation adapter registry', () => {
  it('owns router package and method families from one registry', () => {
    expect(routerForNavigationPackage('next/navigation')).toBe('nextjs')
    expect(routerForNavigationPackage('react-router-dom')).toBe('react_router')
    expect(routerForNavigationPackage('go_router')).toBe('flutter_gorouter')
    expect(routerForLinkRenderPackage('next/link')).toBe('nextjs')
    expect(routerForLinkRenderPackage('next/navigation')).toBeNull()
    expect(flutterRouterForPackage('auto_route')).toBe('flutter_auto_route')
    expect(routerSupportsMethod('nextjs', 'permanentRedirect')).toBe(true)
    expect(routerSupportsMethod('flutter_getx', 'offAllNamed')).toBe(true)
    expect(routerSupportsMethod('react_router', 'offAllNamed')).toBe(false)
    expect(NAVIGATION_ROUTER_PACKAGES.length).toBeGreaterThan(LINK_RENDER_ROUTER_PACKAGES.length)
    expect(FLUTTER_ROUTER_PACKAGES.map(([pkg]) => pkg)).toEqual(expect.arrayContaining(['go_router', 'auto_route']))
    expect(ROUTER_METHODS.map(([router]) => router)).toEqual(expect.arrayContaining(['nextjs', 'flutter_gorouter']))
  })

  it('keeps navigation adapters delegated to the registry', () => {
    const routerCallSource = readFileSync(ROUTER_CALL_SOURCE_PATH, 'utf8')
    const linkRenderSource = readFileSync(LINK_RENDER_SOURCE_PATH, 'utf8')
    const flutterRouteSource = readFileSync(FLUTTER_ROUTE_SOURCE_PATH, 'utf8')

    expect(routerCallSource).toContain('routerForNavigationPackage')
    expect(routerCallSource).toContain('routerSupportsMethod')
    expect(linkRenderSource).toContain('routerForLinkRenderPackage')
    expect(flutterRouteSource).toContain('flutterRouterForPackage')
    expect(flutterRouteSource).toContain('routerSupportsMethod')

    expect(routerCallSource).not.toContain('NAV_PKG_TO_ROUTER')
    expect(routerCallSource).not.toContain('const ROUTER_METHODS')
    expect(linkRenderSource).not.toContain('const ROUTER_PACKAGES')
    expect(flutterRouteSource).not.toContain('const FLUTTER_ROUTER_PACKAGES')
    expect(flutterRouteSource).not.toContain('const ROUTER_METHODS')
  })
})
