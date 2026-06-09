import { describe, it, expect } from 'vitest'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import { evaluateExtract } from '@/pipeline_modules/build_route/f3/extract_evaluator.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import type {
  ExtractContext,
  SelectCandidate,
} from '@/pipeline_modules/build_route/types.js'

const REPO = 'r1'
let edgeId = 1

function n(partial: Partial<CodeNode> & Pick<CodeNode, 'id' | 'type' | 'filePath' | 'name'>): CodeNode {
  return {
    repoId: REPO,
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
    createdAt: '2026-05-08',
    ...partial,
  } as CodeNode
}

function e(partial: Partial<CodeEdge> & Pick<CodeEdge, 'sourceId' | 'relation'>): CodeEdge {
  return {
    id: edgeId++,
    repoId: REPO,
    targetId: null,
    targetSpecifier: null,
    targetSymbol: null,
    typeRefSubtype: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    resolveStatus: 'pending',
    confidence: null,
    source: 'static',
    createdAt: '2026-05-08',
    ...partial,
  } as CodeEdge
}

function ctx(candidate: SelectCandidate, extra?: Partial<ExtractContext>): ExtractContext {
  return { candidate, ...extra }
}

const setupNode = n({ id: 'r1:src/router.ts:setup', type: 'function', filePath: 'src/router.ts', name: 'setup' })
const listNode = n({ id: 'r1:src/order.ts:OrderController.list', type: 'method', filePath: 'src/order.ts', name: 'list' })

describe('${first_arg}', () => {
  it('matched edge의 firstArg 치환', () => {
    const callEdge = e({ sourceId: setupNode.id, relation: 'calls', targetSymbol: 'get', firstArg: '/x' })
    const out = evaluateExtract('${first_arg}', ctx({ node: setupNode, matchedEdges: [callEdge] }))
    expect(out).toBe('/x')
  })

  it('firstArg null인 edge → null', () => {
    const callEdge = e({ sourceId: setupNode.id, relation: 'calls', targetSymbol: 'get', firstArg: null })
    expect(evaluateExtract('${first_arg}', ctx({ node: setupNode, matchedEdges: [callEdge] }))).toBeNull()
  })

  it('matchedEdges 빈 → null', () => {
    expect(evaluateExtract('${first_arg}', ctx({ node: setupNode, matchedEdges: [] }))).toBeNull()
  })

  it('object-style firstArg에서 path 속성을 추출', () => {
    const callEdge = e({ sourceId: setupNode.id, relation: 'calls', firstArg: "{ path: '/from-object' }" })
    expect(evaluateExtract('${first_arg}', ctx({ node: setupNode, matchedEdges: [callEdge] }))).toBe('/from-object')
  })

  it('여러 edge 중 firstArg 있는 첫 edge 사용', () => {
    const a = e({ sourceId: setupNode.id, relation: 'calls', firstArg: null })
    const b = e({ sourceId: setupNode.id, relation: 'calls', firstArg: '/orders' })
    expect(evaluateExtract('${first_arg}', ctx({ node: setupNode, matchedEdges: [a, b] }))).toBe('/orders')
  })
})

describe('${decorator.first_arg}', () => {
  it('decorates relation의 firstArg만 사용', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/orders' })
    expect(evaluateExtract('${decorator.first_arg}', ctx({ node: listNode, matchedEdges: [decEdge] }))).toBe('/orders')
  })

  it('decorates edge가 없고 calls만 있으면 null', () => {
    const callEdge = e({ sourceId: listNode.id, relation: 'calls', firstArg: '/orders' })
    expect(evaluateExtract('${decorator.first_arg}', ctx({ node: listNode, matchedEdges: [callEdge] }))).toBeNull()
  })

  it('decorates + calls 섞여 있어도 decorates 우선', () => {
    const callEdge = e({ sourceId: listNode.id, relation: 'calls', firstArg: '/IGNORED' })
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', firstArg: '/x' })
    expect(evaluateExtract('${decorator.first_arg}', ctx({ node: listNode, matchedEdges: [callEdge, decEdge] }))).toBe('/x')
  })
})

describe('${decorator.arg.X}', () => {
  it('decorates edge의 named literal arg를 transform과 함께 추출', () => {
    const decEdge = e({
      sourceId: listNode.id,
      relation: 'decorates',
      targetSymbol: 'RequestMapping',
      firstArg: '/orders',
      literalArgs: JSON.stringify({
        positional: [],
        named: { method: 'RequestMethod.POST', value: '/orders' },
      }),
    })
    expect(evaluateExtract('${decorator.arg.method → after_last_dot → uppercase}', ctx({
      node: listNode,
      matchedEdges: [decEdge],
    }))).toBe('POST')
  })

  it('named literal arg가 없으면 null', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'RequestMapping' })
    expect(evaluateExtract('${decorator.arg.method}', ctx({ node: listNode, matchedEdges: [decEdge] }))).toBeNull()
  })
})

describe('${self}', () => {
  it('candidate node.id', () => {
    const out = evaluateExtract('${self}', ctx({ node: setupNode, matchedEdges: [] }))
    expect(out).toBe(setupNode.id)
  })
})

describe('${parent_path}/${path} nullish branch', () => {
  it('parent_path 또는 path가 없으면 null', () => {
    expect(evaluateExtract('${parent_path}', ctx({ node: listNode, matchedEdges: [] }))).toBeNull()
    expect(evaluateExtract('${path}', ctx({ node: listNode, matchedEdges: [] }))).toBeNull()
  })
})

describe('${file_path → path_pattern}', () => {
  function pageCtx(filePath: string) {
    return ctx({
      node: n({ id: `r1:${filePath}`, type: 'file', filePath, name: filePath.split('/').pop()! }),
      matchedEdges: [],
    })
  }

  it("'app/dashboard/page.tsx' → '/dashboard'", () => {
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('app/dashboard/page.tsx'))).toBe('/dashboard')
  })

  it("group 제거: 'app/(auth)/login/page.tsx' → '/login'", () => {
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('app/(auth)/login/page.tsx'))).toBe('/login')
  })

  it("dynamic: 'app/users/[id]/page.tsx' → '/users/:id'", () => {
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('app/users/[id]/page.tsx'))).toBe('/users/:id')
  })

  it("route handler: 'app/api/users/route.ts' → '/api/users'", () => {
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('app/api/users/route.ts'))).toBe('/api/users')
  })

  it("pages router: 'pages/about.tsx' → '/about'", () => {
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('pages/about.tsx'))).toBe('/about')
  })

  it("root page: 'app/page.tsx' → '/'", () => {
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('app/page.tsx'))).toBe('/')
  })

  it('Nuxt/SvelteKit/Astro file routing patterns normalize to route paths', () => {
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('pages/users/[id].vue'))).toBe('/users/:id')
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('server/api/orders/[id].get.ts'))).toBe('/api/orders/:id')
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('src/routes/users/[id]/+page.svelte'))).toBe('/users/:id')
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('src/routes/api/orders/[id]/+server.ts'))).toBe('/api/orders/:id')
    expect(evaluateExtract('${file_path → path_pattern}', pageCtx('src/pages/blog/[...slug].astro'))).toBe('/blog/:slug*')
  })
})

// ─── Next.js 공식 라우팅 컨벤션 풀세트 (Phase 1~6) ─────────────────────────────

describe('Next.js filePathToRoutePath — 공식 컨벤션 풀세트', () => {
  /**
   * helper: evaluateExtract with '${file_path → path_pattern}' template
   */
  function fp(filePath: string): string | null {
    return evaluateExtract(
      '${file_path → path_pattern}',
      ctx({
        node: n({ id: `r1:${filePath}`, type: 'file', filePath, name: filePath.split('/').pop()! }),
        matchedEdges: [],
      }),
    )
  }

  // ── 1. 기본 라우팅 ──────────────────────────────────────────────────────────
  describe('1. 기본 (Basic routes)', () => {
    it('app/page.tsx → / (root)', () => {
      expect(fp('app/page.tsx')).toBe('/')
    })

    it('app/about/page.tsx → /about', () => {
      expect(fp('app/about/page.tsx')).toBe('/about')
    })

    it('app/blog/page.tsx → /blog', () => {
      expect(fp('app/blog/page.tsx')).toBe('/blog')
    })

    it('app/api/users/route.ts → /api/users (route handler)', () => {
      expect(fp('app/api/users/route.ts')).toBe('/api/users')
    })

    it('app/api/health/route.js → /api/health (route handler .js)', () => {
      expect(fp('app/api/health/route.js')).toBe('/api/health')
    })

    it('app/deep/nested/section/page.tsx → /deep/nested/section', () => {
      expect(fp('app/deep/nested/section/page.tsx')).toBe('/deep/nested/section')
    })
  })

  // ── 2. Dynamic segments ─────────────────────────────────────────────────────
  describe('2. Dynamic segments ([param])', () => {
    it('app/users/[id]/page.tsx → /users/:id', () => {
      expect(fp('app/users/[id]/page.tsx')).toBe('/users/:id')
    })

    it('app/blog/[slug]/page.tsx → /blog/:slug', () => {
      expect(fp('app/blog/[slug]/page.tsx')).toBe('/blog/:slug')
    })

    it('app/[categoryId]/[itemId]/page.tsx → /:categoryId/:itemId (다중 dynamic)', () => {
      expect(fp('app/[categoryId]/[itemId]/page.tsx')).toBe('/:categoryId/:itemId')
    })

    it('app/shop/[category]/[product]/page.tsx → /shop/:category/:product', () => {
      expect(fp('app/shop/[category]/[product]/page.tsx')).toBe('/shop/:category/:product')
    })
  })

  // ── 3. Catch-all & Optional catch-all ──────────────────────────────────────
  describe('3. Catch-all [...slug] / Optional [[...slug]]', () => {
    it('app/[...slug]/page.tsx → /:slug* (root catch-all)', () => {
      expect(fp('app/[...slug]/page.tsx')).toBe('/:slug*')
    })

    it('app/shop/[...slug]/page.tsx → /shop/:slug*', () => {
      expect(fp('app/shop/[...slug]/page.tsx')).toBe('/shop/:slug*')
    })

    it('app/docs/[...path]/page.tsx → /docs/:path*', () => {
      expect(fp('app/docs/[...path]/page.tsx')).toBe('/docs/:path*')
    })

    it('app/[[...slug]]/page.tsx → /:slug? (root optional catch-all)', () => {
      expect(fp('app/[[...slug]]/page.tsx')).toBe('/:slug?')
    })

    it('app/shop/[[...slug]]/page.tsx → /shop/:slug? (optional catch-all)', () => {
      expect(fp('app/shop/[[...slug]]/page.tsx')).toBe('/shop/:slug?')
    })
  })

  // ── 4. Route groups (name) ──────────────────────────────────────────────────
  describe('4. Route groups (name) — URL 에 포함되지 않음', () => {
    it('app/(auth)/login/page.tsx → /login', () => {
      expect(fp('app/(auth)/login/page.tsx')).toBe('/login')
    })

    it('app/(marketing)/about/page.tsx → /about', () => {
      expect(fp('app/(marketing)/about/page.tsx')).toBe('/about')
    })

    it('app/(auth)/page.tsx → / (group + root)', () => {
      expect(fp('app/(auth)/page.tsx')).toBe('/')
    })

    it('app/(shop)/cart/page.tsx → /cart', () => {
      expect(fp('app/(shop)/cart/page.tsx')).toBe('/cart')
    })

    it('app/(a)/(b)/nested/page.tsx → /nested (다중 group)', () => {
      expect(fp('app/(a)/(b)/nested/page.tsx')).toBe('/nested')
    })

    it('app/(group)/[id]/page.tsx → /:id (group + dynamic)', () => {
      expect(fp('app/(group)/[id]/page.tsx')).toBe('/:id')
    })
  })

  // ── 5. Parallel routes (@slot) ──────────────────────────────────────────────
  describe('5. Parallel routes (@slot) — URL 에 포함되지 않음', () => {
    it('app/@modal/page.tsx → / (parallel slot + root)', () => {
      expect(fp('app/@modal/page.tsx')).toBe('/')
    })

    it('app/@analytics/page.tsx → / (parallel slot + root)', () => {
      expect(fp('app/@analytics/page.tsx')).toBe('/')
    })

    it('app/@modal/photos/page.tsx → /photos (slot + nested)', () => {
      expect(fp('app/@modal/photos/page.tsx')).toBe('/photos')
    })

    it('app/dashboard/@analytics/page.tsx → /dashboard (slot mid-path)', () => {
      expect(fp('app/dashboard/@analytics/page.tsx')).toBe('/dashboard')
    })

    it('app/@team/settings/page.tsx → /settings', () => {
      expect(fp('app/@team/settings/page.tsx')).toBe('/settings')
    })
  })

  // ── 6. Intercepting routes ((.)X, (..)X, (..)(..)X, (...)X) ───────────────
  describe('6. Intercepting routes — URL 에 포함되지 않음', () => {
    // (.) = same level
    it('app/feed/(.)photo/page.tsx → /feed/photo (same-level intercept)', () => {
      expect(fp('app/feed/(.)photo/page.tsx')).toBe('/feed/photo')
    })

    it('app/(.)login/page.tsx → /login ((.) at app level)', () => {
      expect(fp('app/(.)login/page.tsx')).toBe('/login')
    })

    // (..) = one level up
    it('app/feed/(..)photo/page.tsx → /feed/photo (one-level-up intercept)', () => {
      expect(fp('app/feed/(..)photo/page.tsx')).toBe('/feed/photo')
    })

    // (..)(..) = two levels up
    it('app/a/b/(..)(..)/c/page.tsx → /a/b/c (two-level-up intercept)', () => {
      expect(fp('app/a/b/(..)(..)/c/page.tsx')).toBe('/a/b/c')
    })

    // (...) = from root
    it('app/feed/(...)/photo/page.tsx → /feed/photo (root intercept)', () => {
      expect(fp('app/feed/(...)/photo/page.tsx')).toBe('/feed/photo')
    })

    // Real nextgram pattern: @modal + (.) intercept + dynamic
    it('app/@modal/(.)photos/[id]/page.tsx → /photos/:id (nextgram case)', () => {
      expect(fp('app/@modal/(.)photos/[id]/page.tsx')).toBe('/photos/:id')
    })

    // Parallel + intercepting combined at nested level
    it('app/@auth/(.)login/page.tsx → /login (slot + same-level intercept)', () => {
      expect(fp('app/@auth/(.)login/page.tsx')).toBe('/login')
    })
  })

  // ── 7. Private folders (_name) ──────────────────────────────────────────────
  describe('7. Private folders (_name) — URL 에 포함되지 않음', () => {
    it('app/_components/Button.tsx — not a route (no page/route file)', () => {
      // filePathToRoutePath strips _folder segments
      expect(fp('app/_components/page.tsx')).toBe('/')
    })

    it('app/blog/_lib/page.tsx → /blog (_lib is private)', () => {
      expect(fp('app/blog/_lib/page.tsx')).toBe('/blog')
    })

    it('app/_internal/settings/page.tsx → /settings', () => {
      expect(fp('app/_internal/settings/page.tsx')).toBe('/settings')
    })
  })

  // ── 8. 결합 (Combinations) ─────────────────────────────────────────────────
  describe('8. 결합 (group + dynamic + slot + intercept)', () => {
    it('app/(auth)/users/[id]/page.tsx → /users/:id', () => {
      expect(fp('app/(auth)/users/[id]/page.tsx')).toBe('/users/:id')
    })

    it('app/@modal/(.)photos/[id]/page.tsx → /photos/:id (slot + intercept + dynamic)', () => {
      expect(fp('app/@modal/(.)photos/[id]/page.tsx')).toBe('/photos/:id')
    })

    it('app/(shop)/@sidebar/[category]/page.tsx → /:category (group + slot + dynamic)', () => {
      expect(fp('app/(shop)/@sidebar/[category]/page.tsx')).toBe('/:category')
    })

    it('app/(auth)/@modal/(.)login/page.tsx → /login (group + slot + intercept)', () => {
      expect(fp('app/(auth)/@modal/(.)login/page.tsx')).toBe('/login')
    })
  })

  // ── 9. Edge cases ───────────────────────────────────────────────────────────
  describe('9. Edge cases', () => {
    it('app/page.jsx → / (jsx extension)', () => {
      expect(fp('app/page.jsx')).toBe('/')
    })

    it('app/api/route.ts → /api (route handler at api level)', () => {
      expect(fp('app/api/route.ts')).toBe('/api')
    })

    it('app/api/users/[id]/route.ts → /api/users/:id (dynamic route handler)', () => {
      expect(fp('app/api/users/[id]/route.ts')).toBe('/api/users/:id')
    })
  })

  // ── 10. Pages router ────────────────────────────────────────────────────────
  describe('10. Pages router', () => {
    it('pages/index.tsx → / (root)', () => {
      expect(fp('pages/index.tsx')).toBe('/')
    })

    it('pages/about.tsx → /about', () => {
      expect(fp('pages/about.tsx')).toBe('/about')
    })

    it('pages/blog/index.tsx → /blog (index in subdirectory)', () => {
      expect(fp('pages/blog/index.tsx')).toBe('/blog')
    })

    it('pages/blog/[slug].tsx → /blog/:slug', () => {
      expect(fp('pages/blog/[slug].tsx')).toBe('/blog/:slug')
    })

    it('pages/posts/[id].tsx → /posts/:id', () => {
      expect(fp('pages/posts/[id].tsx')).toBe('/posts/:id')
    })

    it('pages/[id].tsx → /:id (root dynamic)', () => {
      expect(fp('pages/[id].tsx')).toBe('/:id')
    })

    it('pages/dashboard/settings/username.tsx → /dashboard/settings/username', () => {
      expect(fp('pages/dashboard/settings/username.tsx')).toBe('/dashboard/settings/username')
    })

    it('pages/api/users.ts → /api/users (pages api route)', () => {
      expect(fp('pages/api/users.ts')).toBe('/api/users')
    })

    it('src/app/posts/[slug]/page.tsx → /posts/:slug', () => {
      expect(fp('src/app/posts/[slug]/page.tsx')).toBe('/posts/:slug')
    })

    it('src/app/page.tsx → /', () => {
      expect(fp('src/app/page.tsx')).toBe('/')
    })
  })
})

describe('${parent_path}/${path} 합성', () => {
  it('parent_path + path raw concat (정규화 옵션 X)', () => {
    const out = evaluateExtract(
      '${parent_path}/${path}',
      ctx({ node: listNode, matchedEdges: [] }, { parentPath: '/api', path: '/list' }),
    )
    expect(out).toBe('/api//list')
  })

  it('parent_path + path 합성 + 정규화 (normalizePath:true)', () => {
    const out = evaluateExtract(
      '${parent_path}/${path}',
      ctx({ node: listNode, matchedEdges: [] }, { parentPath: '/api', path: '/list' }),
      { normalizePath: true },
    )
    expect(out).toBe('/api/list')
  })

  it('parent_path 없이 ${path} 단독', () => {
    const out = evaluateExtract(
      '${path}',
      ctx({ node: listNode, matchedEdges: [] }, { path: '/orders' }),
    )
    expect(out).toBe('/orders')
  })
})

describe('composite + 미해석', () => {
  it("'prefix-${first_arg}' 치환", () => {
    const callEdge = e({ sourceId: setupNode.id, relation: 'calls', firstArg: 'x' })
    const out = evaluateExtract('prefix-${first_arg}', ctx({ node: setupNode, matchedEdges: [callEdge] }))
    expect(out).toBe('prefix-x')
  })

  it('미지원 placeholder → null', () => {
    expect(evaluateExtract('${unknown_var}', ctx({ node: setupNode, matchedEdges: [] }))).toBeNull()
  })

  it('placeholder 없는 plain 문자열 → 그대로', () => {
    expect(evaluateExtract('/static', ctx({ node: setupNode, matchedEdges: [] }))).toBe('/static')
  })
})

// ─── Cycle 1: ${enclosing_class.X.first_arg} resolver ──────────────────────

describe("'${enclosing_class.X.first_arg}' — enclosing class decorator lookup", () => {
  it('class 의 Controller decorator firstArg 반환', () => {
    const klass = n({ id: 'r1:c.ts:Cls', type: 'class', filePath: 'c.ts', name: 'Cls' })
    const method = n({ id: 'r1:c.ts:Cls.list', type: 'method', filePath: 'c.ts', name: 'list' })
    const decClass = e({ sourceId: klass.id, relation: 'decorates', targetSymbol: 'Controller', firstArg: 'cats' })
    const containsM = e({ sourceId: klass.id, targetId: method.id, relation: 'contains' })
    const idx = createGraphIndex({ nodes: [klass, method], edges: [decClass, containsM] })

    const out = evaluateExtract(
      '${enclosing_class.Controller.first_arg}',
      ctx({ node: method, matchedEdges: [] }),
      { graph: idx },
    )
    expect(out).toBe('cats')
  })

  it('class 안 method 가 아니면 null (top-level function)', () => {
    const fn = n({ id: 'r1:fn.ts:standalone', type: 'function', filePath: 'fn.ts', name: 'standalone' })
    const idx = createGraphIndex({ nodes: [fn], edges: [] })

    const out = evaluateExtract(
      '${enclosing_class.Controller.first_arg}',
      ctx({ node: fn, matchedEdges: [] }),
      { graph: idx },
    )
    expect(out).toBeNull()
  })

  it('다른 decorator symbol (Module) — generic syntax 검증', () => {
    const klass = n({ id: 'r1:m.ts:AppModule', type: 'class', filePath: 'm.ts', name: 'AppModule' })
    const method = n({ id: 'r1:m.ts:AppModule.configure', type: 'method', filePath: 'm.ts', name: 'configure' })
    const decModule = e({ sourceId: klass.id, relation: 'decorates', targetSymbol: 'Module', firstArg: 'app' })
    const containsM = e({ sourceId: klass.id, targetId: method.id, relation: 'contains' })
    const idx = createGraphIndex({ nodes: [klass, method], edges: [decModule, containsM] })

    const out = evaluateExtract(
      '${enclosing_class.Module.first_arg}',
      ctx({ node: method, matchedEdges: [] }),
      { graph: idx },
    )
    expect(out).toBe('app')
  })

  it('Resolver decorator symbol — generic syntax 검증', () => {
    const klass = n({ id: 'r1:r.ts:UserResolver', type: 'class', filePath: 'r.ts', name: 'UserResolver' })
    const method = n({ id: 'r1:r.ts:UserResolver.getUser', type: 'method', filePath: 'r.ts', name: 'getUser' })
    const decResolver = e({ sourceId: klass.id, relation: 'decorates', targetSymbol: 'Resolver', firstArg: 'User' })
    const containsM = e({ sourceId: klass.id, targetId: method.id, relation: 'contains' })
    const idx = createGraphIndex({ nodes: [klass, method], edges: [decResolver, containsM] })

    const out = evaluateExtract(
      '${enclosing_class.Resolver.first_arg}',
      ctx({ node: method, matchedEdges: [] }),
      { graph: idx },
    )
    expect(out).toBe('User')
  })

  it('부모 class 에 매칭 decorator 없음 (Injectable만) → null', () => {
    const klass = n({ id: 'r1:s.ts:CatsService', type: 'class', filePath: 's.ts', name: 'CatsService' })
    const method = n({ id: 'r1:s.ts:CatsService.findAll', type: 'method', filePath: 's.ts', name: 'findAll' })
    // Injectable 만 있고 Controller 는 없음
    const decInj = e({ sourceId: klass.id, relation: 'decorates', targetSymbol: 'Injectable', firstArg: null })
    const containsM = e({ sourceId: klass.id, targetId: method.id, relation: 'contains' })
    const idx = createGraphIndex({ nodes: [klass, method], edges: [decInj, containsM] })

    const out = evaluateExtract(
      '${enclosing_class.Controller.first_arg}',
      ctx({ node: method, matchedEdges: [] }),
      { graph: idx },
    )
    expect(out).toBeNull()
  })

  it('graph 미주입 시 null 반환', () => {
    const method = n({ id: 'r1:c.ts:Cls.list', type: 'method', filePath: 'c.ts', name: 'list' })

    const out = evaluateExtract(
      '${enclosing_class.Controller.first_arg}',
      ctx({ node: method, matchedEdges: [] }),
      // graph 없음 (opts 기본값)
    )
    expect(out).toBeNull()
  })
})

// ─── Cycle 1: ${decorator_name} 기본 (alias 없음) ─────────────────────────────

describe("'${decorator_name}' — decorates edge targetSymbol 반환", () => {
  it('decorates edge targetSymbol 반환 (Get)', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/list' })
    const out = evaluateExtract('${decorator_name}', ctx({ node: listNode, matchedEdges: [decEdge] }))
    expect(out).toBe('Get')
  })

  it('decorates edge 없으면 null', () => {
    const callEdge = e({ sourceId: listNode.id, relation: 'calls', targetSymbol: 'get', firstArg: '/list' })
    const out = evaluateExtract('${decorator_name}', ctx({ node: listNode, matchedEdges: [callEdge] }))
    expect(out).toBeNull()
  })

  it('targetSymbol null 이면 null', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: null })
    const out = evaluateExtract('${decorator_name}', ctx({ node: listNode, matchedEdges: [decEdge] }))
    expect(out).toBeNull()
  })
})

// ─── Cycle 2: → uppercase transform pipe ─────────────────────────────────────

describe("'${decorator_name → uppercase}' — transform pipe", () => {
  it('Get → GET', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'Get', firstArg: '/list' })
    const out = evaluateExtract('${decorator_name → uppercase}', ctx({ node: listNode, matchedEdges: [decEdge] }))
    expect(out).toBe('GET')
  })

  it('Post → POST', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'Post', firstArg: '/' })
    const out = evaluateExtract('${decorator_name → uppercase}', ctx({ node: listNode, matchedEdges: [decEdge] }))
    expect(out).toBe('POST')
  })

  it('null value → pipe 적용 안 함 → null', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: null })
    const out = evaluateExtract('${decorator_name → uppercase}', ctx({ node: listNode, matchedEdges: [decEdge] }))
    expect(out).toBeNull()
  })

  it('lowercase transform', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'GET' })
    const out = evaluateExtract('${decorator_name → lowercase}', ctx({ node: listNode, matchedEdges: [decEdge] }))
    expect(out).toBe('get')
  })

  it('chain: uppercase → lowercase', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'Get' })
    const out = evaluateExtract('${decorator_name → uppercase → lowercase}', ctx({ node: listNode, matchedEdges: [decEdge] }))
    expect(out).toBe('get')
  })
})

// ─── Cycle 3: Alias hop 1 ─────────────────────────────────────────────────────

describe("'${decorator_name → uppercase}' — alias hop 1", () => {
  const aliasMap = new Map([['ApiGet', 'Get']])
  const standardSet = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head'])

  it('ApiGet → Get → GET (alias hop 1)', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'ApiGet' })
    const out = evaluateExtract(
      '${decorator_name → uppercase}',
      ctx({ node: listNode, matchedEdges: [decEdge] }, { aliasMap, standardSet }),
    )
    expect(out).toBe('GET')
  })

  it('aliasMap 없이 raw targetSymbol 반환', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'ApiGet' })
    const out = evaluateExtract(
      '${decorator_name → uppercase}',
      ctx({ node: listNode, matchedEdges: [decEdge] }),
    )
    expect(out).toBe('APIGET')
  })
})

// ─── Cycle 4: Alias hop 2 ─────────────────────────────────────────────────────

describe("'${decorator_name → uppercase}' — alias hop 2", () => {
  const aliasMap = new Map([['Super', 'ApiGet'], ['ApiGet', 'Get']])
  const standardSet = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head'])

  it('Super → ApiGet → Get → GET (2-hop alias)', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'Super' })
    const out = evaluateExtract(
      '${decorator_name → uppercase}',
      ctx({ node: listNode, matchedEdges: [decEdge] }, { aliasMap, standardSet }),
    )
    expect(out).toBe('GET')
  })
})

// ─── Cycle 5: Alias depth exceeded (4-hop) ───────────────────────────────────

describe("'${decorator_name → uppercase}' — alias depth exceeded fallback", () => {
  const aliasMap = new Map([['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'Get']])
  const standardSet = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head'])

  it('4-hop (depth=3 초과) → fallback raw → A → UPPERCASE', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'A' })
    const out = evaluateExtract(
      '${decorator_name → uppercase}',
      ctx({ node: listNode, matchedEdges: [decEdge] }, { aliasMap, standardSet }),
    )
    // resolved=null (depth exceeded) → fallback raw 'A' → uppercase → 'A'
    expect(out).toBe('A')
  })
})

// ─── Cycle 6: Cycle detection ─────────────────────────────────────────────────

describe("'${decorator_name → uppercase}' — cycle detection fallback", () => {
  const aliasMap = new Map([['A', 'B'], ['B', 'A']])
  const standardSet = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head'])

  it('A → B → A (cycle) → fallback raw A → A', () => {
    const decEdge = e({ sourceId: listNode.id, relation: 'decorates', targetSymbol: 'A' })
    const out = evaluateExtract(
      '${decorator_name → uppercase}',
      ctx({ node: listNode, matchedEdges: [decEdge] }, { aliasMap, standardSet }),
    )
    expect(out).toBe('A')
  })
})

// ─── Cycle 7: ${callee.method} (Express) ─────────────────────────────────────

describe("'${callee.method}' — calls edge targetSymbol 반환", () => {
  it('calls edge targetSymbol 반환 (get)', () => {
    const callEdge = e({ sourceId: setupNode.id, relation: 'calls', targetSymbol: 'get', firstArg: '/x' })
    const out = evaluateExtract('${callee.method}', ctx({ node: setupNode, matchedEdges: [callEdge] }))
    expect(out).toBe('get')
  })

  it('calls edge 없으면 null', () => {
    const decEdge = e({ sourceId: setupNode.id, relation: 'decorates', targetSymbol: 'Get' })
    const out = evaluateExtract('${callee.method}', ctx({ node: setupNode, matchedEdges: [decEdge] }))
    expect(out).toBeNull()
  })

  it('targetSymbol null 이면 null', () => {
    const callEdge = e({ sourceId: setupNode.id, relation: 'calls', targetSymbol: null })
    const out = evaluateExtract('${callee.method}', ctx({ node: setupNode, matchedEdges: [callEdge] }))
    expect(out).toBeNull()
  })

  it('${callee.method → uppercase} → GET', () => {
    const callEdge = e({ sourceId: setupNode.id, relation: 'calls', targetSymbol: 'get', firstArg: '/x' })
    const out = evaluateExtract('${callee.method → uppercase}', ctx({ node: setupNode, matchedEdges: [callEdge] }))
    expect(out).toBe('GET')
  })

  it('post → POST', () => {
    const callEdge = e({ sourceId: setupNode.id, relation: 'calls', targetSymbol: 'post', firstArg: '/y' })
    const out = evaluateExtract('${callee.method → uppercase}', ctx({ node: setupNode, matchedEdges: [callEdge] }))
    expect(out).toBe('POST')
  })
})

// ─── Cycle: file_path → path_pattern 기존 호환 확인 ─────────────────────────

describe("'${file_path → path_pattern}' — transform pipe 와 충돌 없음 (기존 hardcode 유지)", () => {
  it("'app/users/page.tsx' → '/users' (hardcode 처리)", () => {
    const out = evaluateExtract(
      '${file_path → path_pattern}',
      ctx({
        node: n({ id: 'r1:app/users/page.tsx', type: 'file', filePath: 'app/users/page.tsx', name: 'page.tsx' }),
        matchedEdges: [],
      }),
    )
    expect(out).toBe('/users')
  })
})

// ─── ${jsx_attr.X} — JSX element props from a renders edge's literalArgs ────────

describe('${jsx_attr.X} — react-router <Route path="…"> prop', () => {
  const app = n({ id: 'r1:App.tsx:App', type: 'function', filePath: 'App.tsx', name: 'App' })

  it('array literalArgs [{path, element}] → path', () => {
    const renders = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', literalArgs: JSON.stringify([{ path: '/login', element: null }]) })
    expect(evaluateExtract('${jsx_attr.path}', ctx({ node: app, matchedEdges: [renders] }))).toBe('/login')
  })

  it('object literalArgs {path} → path', () => {
    const renders = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', literalArgs: JSON.stringify({ path: '/x' }) })
    expect(evaluateExtract('${jsx_attr.path}', ctx({ node: app, matchedEdges: [renders] }))).toBe('/x')
  })

  it('prop absent → null (entry will be dropped, not a phantom)', () => {
    const renders = e({ sourceId: app.id, relation: 'renders', targetSymbol: 'Route', literalArgs: JSON.stringify([{ element: null }]) })
    expect(evaluateExtract('${jsx_attr.path}', ctx({ node: app, matchedEdges: [renders] }))).toBeNull()
  })
})
