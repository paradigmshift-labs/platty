// rule-engine.md §3 — 모든 어댑터 공통 path 정규화 (string -> string pure)

const COLON_PARAM = /:[A-Za-z_][A-Za-z0-9_]*[?*]?/g
const CATCHALL_OPTIONAL = /\[\[\.\.\.([A-Za-z0-9_]+)\]\]/g
const CATCHALL = /\[\.\.\.([A-Za-z0-9_]+)\]/g
const NEXT_DYNAMIC = /\[([A-Za-z0-9_]+)\]/g
const VUE_DYNAMIC = /<([A-Za-z0-9_]+)>/g
const OPENAPI_DYNAMIC = /\{([A-Za-z0-9_]+)\}/g
const GROUP = /\([^)]*\)/g
const MULTI_SLASH = /\/+/g

export function normalize(rawPath: string): string {
  let p = rawPath.trim()
  p = p.replace(/\\/g, '/')
  p = p.replace(MULTI_SLASH, '/')

  p = p.replace(CATCHALL_OPTIONAL, ':$1?')
  p = p.replace(CATCHALL, ':$1*')
  p = p.replace(NEXT_DYNAMIC, ':$1')
  p = p.replace(VUE_DYNAMIC, ':$1')
  p = p.replace(OPENAPI_DYNAMIC, ':$1')

  const params: string[] = []
  p = p.replace(COLON_PARAM, (m) => {
    const idx = params.length
    params.push(m)
    return `__platty_param_${idx}__`
  })
  p = p.toLowerCase()
  p = p.replace(/__platty_param_(\d+)__/g, (_, idx: string) => params[Number(idx)])

  p = p.replace(GROUP, '')
  p = p.replace(MULTI_SLASH, '/')

  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  if (p === '' || p === '/') return '/'
  if (!p.startsWith('/')) p = '/' + p
  return p
}

export function join(parent: string | null | undefined, child: string): string {
  if (!parent) return normalize(child)
  const c = child.startsWith('/') ? child.slice(1) : child
  return normalize(parent + '/' + c)
}
