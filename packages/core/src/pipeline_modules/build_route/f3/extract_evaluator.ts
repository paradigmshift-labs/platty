// f3/extract_evaluator — extract template language 평가 (architecture.md §4.3).
// 코어 resolver: ${first_arg}, ${decorator.first_arg}, ${self}, ${file_path → path_pattern},
//                ${parent_path}, ${path}, ${decorator.arg.X}, ${enclosing_class.X.first_arg},
//                ${decorator_name}, ${callee.method}.
// transform pipe: ${expr → uppercase}, ${expr → lowercase}, chain 가능.
// 추후 추가: ${named_arg.X}, ${jsx_attr.X},
//           ${default_export}, ${named_exports}, ${entry.key}, ${entry.value}.

import type { ExtractContext } from '../types.js'
import type { GraphIndex } from '../graph_index.js'
import { normalize } from './path_normalizer.js'
import { resolveAlias } from './alias_resolver.js'
import { runGraphQuery, type GraphQuery, type GraphAdjacency } from '@/pipeline_modules/graph_query/index.js'

const PLACEHOLDER = /\$\{([^}]+)\}/g

/**
 * enclosing_class.X.first_arg 매칭 정규식.
 * 캡처 그룹 1: DecoratorSymbol (예: 'Controller', 'Module', 'Resolver')
 */
const ENCLOSING_CLASS_RE = /^enclosing_class\.([A-Za-z_]\w*)\.first_arg$/

/** transform 함수 레지스트리 */
const TRANSFORMS: Record<string, (s: string) => string> = {
  uppercase: (s) => s.toUpperCase(),
  lowercase: (s) => s.toLowerCase(),
  // chain decorator의 마지막 멤버만 추출. 예: 'TypedRoute.Get' → 'Get', 'Get' → 'Get'.
  // Nestia(TypedRoute.*)나 다른 chain decorator 패턴의 HTTP method 추출에 사용.
  after_last_dot: (s) => {
    const idx = s.lastIndexOf('.')
    return idx === -1 ? s : s.slice(idx + 1)
  },
}

/**
 * placeholder 내부 표현 파싱: 'expr → t1 → t2' → { expr, transforms }
 *
 * NOTE: 'file_path → path_pattern' 은 hardcode 처리로 먼저 잡아야 충돌 안 함.
 * 일반 transform pipe 에서 'path_pattern' 은 미등록 → unknown transform 시 그대로 통과.
 */
function parsePipe(raw: string): { expr: string; transforms: string[] } {
  const parts = raw.split(/\s*→\s*/)
  return { expr: parts[0].trim(), transforms: parts.slice(1).map((t) => t.trim()) }
}

function applyTransforms(value: string | null, transforms: string[]): string | null {
  if (value === null) return null
  let v = value
  for (const t of transforms) {
    const fn = TRANSFORMS[t]
    if (fn) v = fn(v)
    // unknown transform → 그대로 통과 (미래 확장 대비)
  }
  return v
}

export interface ExtractOpts {
  /** path 합성 결과를 path_normalizer.normalize에 통과시킨다. nested 룰에서 true. */
  normalizePath?: boolean
  /**
   * graph 주입 — ${enclosing_class.X.first_arg} 등 그래프 탐색이 필요한
   * placeholder 해석 시 사용. 없으면 그래프 탐색 placeholder 는 null 반환.
   */
  graph?: GraphIndex
}

export function evaluateExtract(
  template: string,
  context: ExtractContext,
  opts: ExtractOpts = {},
): string | null {
  let failed = false
  const result = template.replace(PLACEHOLDER, (_match, raw: string) => {
    const value = resolveExpr(raw.trim(), context, opts.graph)
    if (value === null) {
      failed = true
      return ''
    }
    return value
  })
  if (failed) return null
  return opts.normalizePath ? normalize(result) : result
}

function resolveExpr(expr: string, context: ExtractContext, graph?: GraphIndex): string | null {
  // ── hardcode 처리: file_path → path_pattern (transform pipe 와 구분) ──
  if (expr === 'file_path → path_pattern') {
    return filePathToRoutePath(context.candidate.node.filePath)
  }

  // ── transform pipe 파싱 ──
  const { expr: baseExpr, transforms } = parsePipe(expr)

  // base 표현 해석
  const raw = resolveBase(baseExpr, context, graph)

  // transform 적용
  return applyTransforms(raw, transforms)
}

function resolveBase(expr: string, context: ExtractContext, graph?: GraphIndex): string | null {
  const decoratorArg = /^decorator\.arg\.([A-Za-z_]\w*)$/.exec(expr)
  if (decoratorArg) return findDecoratorNamedArg(context, decoratorArg[1])

  // ${jsx_attr.X} — a JSX element prop, e.g. `<Route path="/x">` → ${jsx_attr.path}. build_graph stores a
  // renders edge's element props in literalArgs as `[{path, element, ...}]` (array) or `{path: ...}`.
  const jsxAttr = /^jsx_attr\.([A-Za-z_]\w*)$/.exec(expr)
  if (jsxAttr) return findJsxAttr(context, jsxAttr[1])

  switch (expr) {
    case 'first_arg':
      return findFirstNonNullArg(context, null)

    case 'decorator.first_arg':
      return findFirstNonNullArg(context, 'decorates')

    case 'self':
      return context.candidate.node.id

    case 'parent_path':
      return context.parentPath ?? null

    case 'path':
      return context.path ?? null

    case 'decorator_name':
      return resolveDecoratorName(context)

    case 'callee.method':
      return resolveCalleeMethod(context)

    case 'entry.key':
      return context.walkEntry?.key ?? null

    case 'entry.value':
      // walkEntry.value가 문자열이면 그대로 사용 (예: 정적 추적된 node id)
      if (typeof context.walkEntry?.value === 'string') return context.walkEntry.value
      // null/위젯 constructor 등 literal로 추출 못한 경우 → self(matched edge sourceId) fallback
      // dart.ts는 MaterialApp(routes: {'/x': () => Widget()})의 위젯 값을 null로 저장
      if (context.walkEntry !== undefined) {
        const edge = context.candidate.matchedEdges[0]
        return edge?.sourceId ?? null
      }
      return null

    default: {
      // ${enclosing_class.DecoratorSymbol.first_arg} 패턴
      const m = ENCLOSING_CLASS_RE.exec(expr)
      if (m) {
        return resolveEnclosingClassFirstArg(context, graph, m[1])
      }
      return null
    }
  }
}

function findDecoratorNamedArg(context: ExtractContext, name: string): string | null {
  for (const edge of context.candidate.matchedEdges) {
    if (edge.relation !== 'decorates') continue
    const args = parseLiteralArgs(edge.literalArgs)
    const value = args?.named?.[name]
    if (typeof value === 'string' && value.length > 0) return value
    if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0]
  }
  return null
}

function parseLiteralArgs(literalArgs: string | null | undefined): { named?: Record<string, unknown> } | null {
  if (!literalArgs) return null
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    if (parsed && typeof parsed === 'object') return parsed as { named?: Record<string, unknown> }
  } catch {
    return null
  }
  return null
}

/** Read a JSX element prop from a matched renders edge's literalArgs (array `[{...}]` or object `{...}`). */
function findJsxAttr(context: ExtractContext, name: string): string | null {
  for (const edge of context.candidate.matchedEdges) {
    if (!edge.literalArgs) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(edge.literalArgs)
    } catch {
      continue
    }
    const props = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown> | undefined
    const value = props?.[name]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/**
 * ${decorator_name} resolver.
 *
 * 1. matchedEdges 에서 첫 번째 'decorates' edge 찾기
 * 2. targetSymbol 가져오기 — null 이면 null 반환
 * 3. aliasMap + standardSet 둘 다 있으면 resolveAlias 호출:
 *    - resolved 가 standard 면 그 standard 반환
 *    - resolved null (cycle / depth) 이면 fallback: raw targetSymbol 반환
 * 4. aliasMap 미주입 시 raw targetSymbol 반환 (fallback)
 */
function resolveDecoratorName(context: ExtractContext): string | null {
  const decEdge = context.candidate.matchedEdges.find((e) => e.relation === 'decorates')
  if (!decEdge) return null
  const targetSymbol = decEdge.targetSymbol
  if (!targetSymbol) return null

  const { aliasMap, standardSet } = context
  if (aliasMap && standardSet) {
    const result = resolveAlias(targetSymbol, aliasMap, standardSet)
    if (result.resolved !== null) return result.resolved
    // fallback: raw targetSymbol (cycle / depth exceeded)
    return targetSymbol
  }

  return targetSymbol
}

/**
 * ${callee.method} resolver.
 *
 * 1. matchedEdges 에서 첫 번째 'calls' edge 찾기
 * 2. targetSymbol 반환 (alias 적용 X — Express callee method 는 wrapper 아님)
 */
function resolveCalleeMethod(context: ExtractContext): string | null {
  const callEdge = context.candidate.matchedEdges.find((e) => e.relation === 'calls')
  if (!callEdge) return null
  return callEdge.targetSymbol ?? null
}

/**
 * ${enclosing_class.<DecoratorSymbol>.first_arg} 해석 알고리즘.
 *
 * 1. candidate.node 의 incoming 'contains' edge → 부모 class 노드 찾기
 * 2. 부모 class 의 outgoing 'decorates' edge 중 targetSymbol === DecoratorSymbol
 * 3. 그 edge 의 firstArg 반환 (없으면 null)
 */
/** Adjacency adapter over build_route's GraphIndex for the shared graph-query interpreter. */
function graphIndexAdjacency(graph: GraphIndex): GraphAdjacency {
  return {
    out: (id) => graph.outgoingEdges(id),
    in: (id) => graph.incomingEdges(id),
  }
}

/**
 * ${enclosing_class.<DecoratorSymbol>.first_arg} — the handler's enclosing class decorator arg (e.g. NestJS
 * @Controller('users') prefix). Expressed as a 2-hop graph query run by the shared bounded interpreter (G1):
 *   handler ←contains← enclosing class →decorates[via DecoratorSymbol]→ read raw firstArg.
 * Behavior-identical to the prior hardcoded walk (zero-drift); see specs/refactor/graph-query-primitive.md.
 */
function resolveEnclosingClassFirstArg(
  context: ExtractContext,
  graph: GraphIndex | undefined,
  decoratorSymbol: string,
): string | null {
  if (!graph) return null
  const query: GraphQuery = {
    steps: [
      { edge: 'contains', direction: 'in' },                              // handler → enclosing class
      { edge: 'decorates', direction: 'out', viaSymbol: decoratorSymbol }, // class → @DecoratorSymbol
    ],
    read: { decorates: 'firstArg' },
  }
  const raw = runGraphQuery(query, context.candidate.node.id, null, graphIndexAdjacency(graph))[0]
  return normalizeDecoratorFirstArg(raw ?? null)
}

function findFirstNonNullArg(
  context: ExtractContext,
  relationFilter: string | null,
): string | null {
  for (const edge of context.candidate.matchedEdges) {
    if (relationFilter && edge.relation !== relationFilter) continue
    const normalized = normalizeDecoratorFirstArg(edge.firstArg)
    if (normalized !== null) return normalized
  }
  return null
}

function normalizeDecoratorFirstArg(firstArg: string | null | undefined): string | null {
  if (firstArg === null || firstArg === undefined) return null
  const objectPathMatch = /(?:^|[,{]\s*)path\s*:\s*(['"])(.*?)\1/.exec(firstArg)
  if (objectPathMatch) return objectPathMatch[2]
  return firstArg
}

/**
 * Next.js App Router / Pages Router 파일 경로 → route path 변환.
 *
 * 공식 컨벤션 (https://nextjs.org/docs/app/building-your-application/routing):
 *
 *   Step 1: Top-level prefix 제거 (app/, pages/, src/routes/, server/api 등)
 *   Step 2: Special filename 제거 (page, route, index, +page, +server + 확장자)
 *   Step 3: 일반 확장자 제거 (.tsx/.ts/.jsx/.js/.mdx/.vue/.svelte/.astro 등)
 *   Step 3b: Nuxt server method suffix 제거 (users/[id].get.ts → users/[id])
 *   Step 4: Intercepting routes 제거
 *           https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes
 *           (.)X, (..)X, (..)(..)X, (...)X → 접두사만 제거, segment 이름은 유지
 *   Step 5: Private folders 제거
 *           https://nextjs.org/docs/app/building-your-application/routing/colocation#private-folders
 *           _name segments → URL에 포함되지 않음
 *   Step 6: Parallel route slots 제거
 *           https://nextjs.org/docs/app/building-your-application/routing/parallel-routes
 *           @name segments → URL에 포함되지 않음
 *   Step 7: Route groups 제거 (normalize() 위임)
 *           https://nextjs.org/docs/app/building-your-application/routing/route-groups
 *           (name) segments → URL에 포함되지 않음
 *   Step 8: Dynamic / catch-all / optional catch-all 변환 (normalize() 위임)
 *           [id] → :id, [...slug] → :slug*, [[...slug]] → :slug?
 *   Step 9: lowercase / 다중 슬래시 / trailing slash / empty → / (normalize() 위임)
 *
 * 예시:
 *   app/(group)/login/page.tsx             → /login
 *   app/@modal/(.)photos/[id]/page.tsx     → /photos/:id
 *   app/_components/page.tsx               → /
 *   app/api/users/route.ts                 → /api/users
 *   pages/about.tsx                        → /about
 */
function filePathToRoutePath(filePath: string): string {
  let p = filePath

  // Step 1: Top-level prefix 제거
  p = p.replace(/^src\/app\//, '/')
  p = p.replace(/^src\/pages\//, '/')
  p = p.replace(/^src\/routes\//, '/')
  p = p.replace(/^server\/api\//, '/api/')
  p = p.replace(/^server\/routes\//, '/')
  p = p.replace(/^app\//, '/')
  p = p.replace(/^pages\//, '/')
  p = p.replace(/^routes\//, '/')

  // Step 2: Special filename 제거 (page|route|index|+page|+server + 확장자)
  p = p.replace(/\/(\+page|\+server|page|route|index)\.(tsx?|jsx?|mjs|cjs|mdx|vue|svelte|astro)$/, '')

  // Step 3: 일반 확장자 제거 (pages router — about.tsx → about)
  p = p.replace(/\.(tsx?|jsx?|mjs|cjs|mdx|vue|svelte|astro)$/, '')

  // Step 3b: Nuxt server method suffix 제거 (users/[id].get.ts → users/[id])
  p = p.replace(/\.(get|post|put|delete|patch|head|options|all)$/i, '')

  // Step 4: Intercepting routes 접두사 제거
  // https://nextjs.org/docs/app/building-your-application/routing/intercepting-routes
  // 폴더 이름 앞에 붙는 접두사를 제거하고 실제 segment 이름만 유지.
  // 예: (.)photos → photos, (..)photo → photo, (...)photo → photo, (..)(..)shop → shop
  // 처리 순서: 복합 패턴((..)(..) 먼저) → 단일 패턴 순서로
  p = p.replace(/\(\.{2}\)\(\.{2}\)/g, '')    // (..)(..) 접두사 제거 (segment 이름은 뒤에 남음)
  p = p.replace(/\(\.{3}\)/g, '')             // (...) 접두사 제거
  p = p.replace(/\(\.{2}\)/g, '')             // (..) 접두사 제거
  p = p.replace(/\(\.\)/g, '')               // (.) 접두사 제거

  // Step 5: Private folders 제거
  // https://nextjs.org/docs/app/building-your-application/routing/colocation#private-folders
  // _name segments → URL에 포함되지 않음 (모든 하위폴더도 opt-out)
  // 단, %5F (URL-encoded underscore) 는 실제 URL에 _ 로 포함되므로 그대로 유지
  p = p.replace(/\/_[^/]*/g, '')

  // Step 6: Parallel route slots 제거
  // https://nextjs.org/docs/app/building-your-application/routing/parallel-routes
  // @name segments → URL에 포함되지 않음
  p = p.replace(/\/@[^/]*/g, '')

  // Step 7~9: Route groups / dynamic / normalize (path_normalizer.normalize 위임)
  return normalize(p)
}
