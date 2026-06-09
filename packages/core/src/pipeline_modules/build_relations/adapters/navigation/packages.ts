export const NAVIGATION_ROUTER_PACKAGES = [
  ['next/link', 'nextjs'],
  ['next/navigation', 'nextjs'],
  ['next/router', 'nextjs'],
  ['next/server', 'nextjs'],
  ['react-router-dom', 'react_router'],
  ['react-router', 'react_router'],
  ['@tanstack/react-router', 'tanstack_router'],
  ['wouter', 'wouter'],
  ['go_router', 'flutter_gorouter'],
  ['get', 'flutter_getx'],
  ['flutter_beamer', 'flutter_beamer'],
  ['auto_route', 'flutter_auto_route'],
] as const

export const LINK_RENDER_ROUTER_PACKAGES = [
  ['next/link', 'nextjs'],
  ['react-router-dom', 'react_router'],
  ['react-router', 'react_router'],
  ['@tanstack/react-router', 'tanstack_router'],
  ['wouter', 'wouter'],
] as const

export const FLUTTER_ROUTER_PACKAGES = [
  ['go_router', 'flutter_gorouter'],
  ['get', 'flutter_getx'],
  ['auto_route', 'flutter_auto_route'],
  ['flutter_beamer', 'flutter_beamer'],
] as const

export const ROUTER_METHODS = [
  ['nextjs', ['push', 'replace', 'redirect', 'permanentRedirect', 'prefetch']],
  ['react_router', ['push', 'replace', 'navigate']],
  ['tanstack_router', ['navigate', 'redirect']],
  ['wouter', ['setLocation', 'navigate']],
  ['flutter_gorouter', ['go', 'push', 'goNamed', 'replace', 'pushNamed']],
  ['flutter_navigator', ['pushNamed', 'popAndPushNamed', 'pushReplacementNamed']],
  ['flutter_getx', ['toNamed', 'to', 'off', 'offAll', 'offNamed', 'offAllNamed', 'offAndToNamed']],
  ['flutter_beamer', ['beamToNamed', 'beamTo', 'beamToReplacementNamed']],
  ['flutter_auto_route', ['push', 'replace', 'navigate', 'navigateTo', 'pushNamed', 'replaceNamed', 'navigateNamed']],
] as const

const NAVIGATION_ROUTER_PACKAGE_MAP = new Map<string, string>(NAVIGATION_ROUTER_PACKAGES)
const LINK_RENDER_ROUTER_PACKAGE_MAP = new Map<string, string>(LINK_RENDER_ROUTER_PACKAGES)
const FLUTTER_ROUTER_PACKAGE_MAP = new Map<string, string>(FLUTTER_ROUTER_PACKAGES)
const ROUTER_METHOD_MAP = new Map<string, Set<string>>(
  ROUTER_METHODS.map(([router, methods]) => [router, new Set<string>(methods)]),
)

export function routerForNavigationPackage(pkg: string | null | undefined): string | null {
  return pkg ? NAVIGATION_ROUTER_PACKAGE_MAP.get(pkg) ?? null : null
}

export function routerForLinkRenderPackage(pkg: string | null | undefined): string | null {
  return pkg ? LINK_RENDER_ROUTER_PACKAGE_MAP.get(pkg) ?? null : null
}

export function flutterRouterForPackage(pkg: string | null | undefined): string | null {
  return pkg ? FLUTTER_ROUTER_PACKAGE_MAP.get(pkg) ?? null : null
}

export function routerSupportsMethod(router: string | null | undefined, method: string | null | undefined): boolean {
  if (!router || !method) return false
  return ROUTER_METHOD_MAP.get(router)?.has(method) ?? false
}
