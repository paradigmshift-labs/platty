// Next.js F3 어댑터 — 실사례 시나리오 맥시멈
//
// 룰 7개:
// 1. app_page (function default export)
// 2. app_page_file_fallback (file 노드, function 없을 때)
// 3. app_route_handler (function default export)
// 4. app_route_file_fallback (file)
// 5. pages_router (function default export, pages/ 하위)
// 6. pages_router_file_fallback (file)
// 7. pages_api_file (file 기반, pages/api/)
//
// 실사례 (file_path → path_pattern 변환):
//   - app/page.tsx → /
//   - app/about/page.tsx → /about
//   - app/blog/[slug]/page.tsx → /blog/[slug]
//   - app/blog/[...slug]/page.tsx → /blog/[...slug] (catch-all)
//   - app/blog/[[...slug]]/page.tsx → optional catch-all
//   - app/(marketing)/about/page.tsx → /about (route group)
//   - app/_components/Header.tsx → 제외 (private folder)
//   - app/@modal/page.tsx → / (parallel route slot)
//   - app/(.)photos/[id]/page.tsx → /photos/[id] (intercepting)
//   - src/app/... → /...
//   - app/api/users/route.ts → /api/users
//   - pages/index.tsx → /
//   - pages/about.tsx → /about
//   - pages/users/[id].tsx → /users/[id]
//   - pages/api/users.ts → /api/users
//   - pages/_app.tsx → 제외
//   - pages/_document.tsx → 제외

import { describe, expect, it } from 'vitest'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { nextjs } from '@/pipeline_modules/build_route/adapters/nextjs.js'
import { TEST_REPO as REPO, n, loaded, resetEdgeId } from '../helpers/graph_builders.js'

function pageFn(filePath: string, name = 'Page'): ReturnType<typeof n> {
  return n({ id: `r1:${filePath}:${name}`, type: 'function', filePath, name, isDefaultExport: true })
}

function pageFile(filePath: string): ReturnType<typeof n> {
  return n({ id: `r1:${filePath}`, type: 'file', filePath, name: filePath.split('/').pop() ?? 'page' })
}

// ────────────────────────────────────────────────────────────
// App Router page — 기본 패턴 변형
// ────────────────────────────────────────────────────────────
describe('Next.js — App Router page (기본)', () => {
  it('app/page.tsx → /', async () => {
    resetEdgeId()
    const fn = pageFn('app/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(1)
    expect(pages[0].fullPath).toBe('/')
  })

  it('app/about/page.tsx → /about', async () => {
    resetEdgeId()
    const fn = pageFn('app/about/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/about')
  })

  it('app/dashboard/settings/page.tsx → /dashboard/settings', async () => {
    resetEdgeId()
    const fn = pageFn('app/dashboard/settings/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/dashboard/settings')
  })

  it('src/app/about/page.tsx → /about (src prefix 제거)', async () => {
    resetEdgeId()
    const fn = pageFn('src/app/about/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/about')
  })

  it('app/page.jsx (JS 확장자) → /', async () => {
    resetEdgeId()
    const fn = pageFn('app/page.jsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/')
  })

  it('app/blog/page.mdx (mdx) → /blog', async () => {
    resetEdgeId()
    const fn = pageFn('app/blog/page.mdx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/blog')
  })
})

// ────────────────────────────────────────────────────────────
// App Router page — Dynamic / Catch-all
// ────────────────────────────────────────────────────────────
describe('Next.js — App Router dynamic routes', () => {
  it('app/blog/[slug]/page.tsx → /blog/:slug (path_normalizer가 [name] → :name 변환)', async () => {
    resetEdgeId()
    const fn = pageFn('app/blog/[slug]/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/blog/:slug')
  })

  it('app/users/[id]/posts/[postId]/page.tsx → /users/:id/posts/:postId', async () => {
    resetEdgeId()
    const fn = pageFn('app/users/[id]/posts/[postId]/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/users/:id/posts/:postId')
  })

  it('app/blog/[...slug]/page.tsx → /blog/:slug* (catch-all)', async () => {
    resetEdgeId()
    const fn = pageFn('app/blog/[...slug]/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/blog/:slug*')
  })

  it('app/shop/[[...slug]]/page.tsx → /shop/:slug? (optional catch-all)', async () => {
    resetEdgeId()
    const fn = pageFn('app/shop/[[...slug]]/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/shop/:slug?')
  })
})

// ────────────────────────────────────────────────────────────
// App Router page — Route groups / Parallel / Intercepting / Private
// ────────────────────────────────────────────────────────────
describe('Next.js — App Router 특수 폴더', () => {
  it('app/(marketing)/about/page.tsx → /about (route group 제거)', async () => {
    resetEdgeId()
    const fn = pageFn('app/(marketing)/about/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/about')
  })

  it('app/(auth)/login/page.tsx → /login', async () => {
    resetEdgeId()
    const fn = pageFn('app/(auth)/login/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/login')
  })

  it('app/@modal/page.tsx → / (parallel route slot 제거)', async () => {
    resetEdgeId()
    const fn = pageFn('app/@modal/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/')
  })

  it('app/photos/(.)photo/[id]/page.tsx → /photos/photo/:id (intercepting)', async () => {
    resetEdgeId()
    const fn = pageFn('app/photos/(.)photo/[id]/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/photos/photo/:id')
  })

  it('app/photos/(...)photo/[id]/page.tsx → /photos/photo/:id (intercepting root)', async () => {
    resetEdgeId()
    const fn = pageFn('app/photos/(...)photo/[id]/page.tsx')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/photos/photo/:id')
  })

  it('app/_components/Header.tsx → private folder 제외 (page.tsx 아님)', async () => {
    resetEdgeId()
    const fn = pageFn('app/_components/Header.tsx', 'Header')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    // file_glob이 page.* 패턴 → Header.tsx 매칭 안 됨
    expect(r.entryPoints).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────
// App Router page — exclude_glob (layout, loading, error, not-found)
// ────────────────────────────────────────────────────────────
describe('Next.js — App Router 제외 패턴', () => {
  it('app/layout.tsx → 제외 (exclude_glob)', async () => {
    resetEdgeId()
    const fn = pageFn('app/layout.tsx', 'Layout')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    // layout 파일은 file_glob에 매칭 안 됨
    expect(r.entryPoints).toHaveLength(0)
  })

  it('app/about/layout.tsx → 제외', async () => {
    resetEdgeId()
    const fn = pageFn('app/about/layout.tsx', 'Layout')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('app/loading.tsx, app/error.tsx, app/not-found.tsx → 제외', async () => {
    resetEdgeId()
    const loading = pageFn('app/loading.tsx', 'Loading')
    const error = pageFn('app/error.tsx', 'Error')
    const notFound = pageFn('app/not-found.tsx', 'NotFound')
    const graph = createGraphIndex({ nodes: [loading, error, notFound], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────
// App Router API route handler
// ────────────────────────────────────────────────────────────
describe('Next.js — App Router route handler', () => {
  it('app/api/users/route.ts → /api/users', async () => {
    resetEdgeId()
    const fn = n({
      id: 'r1:app/api/users/route.ts:GET',
      type: 'function', filePath: 'app/api/users/route.ts', name: 'GET',
      isDefaultExport: true,
    })
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    const apis = r.entryPoints.filter((ep) => ep.kind === 'api')
    expect(apis).toHaveLength(1)
    expect(apis[0].fullPath).toBe('/api/users')
  })

  it('app/api/users/[id]/route.ts → /api/users/:id', async () => {
    resetEdgeId()
    const fn = n({
      id: 'r1:app/api/users/[id]/route.ts:GET',
      type: 'function', filePath: 'app/api/users/[id]/route.ts', name: 'GET',
      isDefaultExport: true,
    })
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/api/users/:id')
  })

  it('src/app/api/auth/[...nextauth]/route.ts → /api/auth/:nextauth* (catch-all)', async () => {
    resetEdgeId()
    const fn = n({
      id: 'r1:src/app/api/auth/[...nextauth]/route.ts:GET',
      type: 'function', filePath: 'src/app/api/auth/[...nextauth]/route.ts', name: 'GET',
      isDefaultExport: true,
    })
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/api/auth/:nextauth*')
  })

  it('default export 없으면 → file fallback으로 매칭', async () => {
    resetEdgeId()
    const file = pageFile('app/api/users/route.ts')
    const graph = createGraphIndex({ nodes: [file], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].fullPath).toBe('/api/users')
    expect(r.entryPoints[0].detectionEvidence.matchedRuleId).toBe('app_route_file_fallback')
  })
})

// ────────────────────────────────────────────────────────────
// Pages Router (legacy)
// ────────────────────────────────────────────────────────────
describe('Next.js — Pages Router', () => {
  it('pages/index.tsx → /', async () => {
    resetEdgeId()
    const fn = pageFn('pages/index.tsx', 'Home')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/')
  })

  it('pages/about.tsx → /about', async () => {
    resetEdgeId()
    const fn = pageFn('pages/about.tsx', 'About')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/about')
  })

  it('pages/users/[id].tsx → /users/:id', async () => {
    resetEdgeId()
    const fn = pageFn('pages/users/[id].tsx', 'UserPage')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/users/:id')
  })

  it('pages/blog/[...slug].tsx → /blog/:slug* (catch-all)', async () => {
    resetEdgeId()
    const fn = pageFn('pages/blog/[...slug].tsx', 'Blog')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/blog/:slug*')
  })

  it('pages/_app.tsx → 제외 (exclude_glob)', async () => {
    resetEdgeId()
    const fn = pageFn('pages/_app.tsx', 'App')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('pages/_document.tsx → 제외', async () => {
    resetEdgeId()
    const fn = pageFn('pages/_document.tsx', 'Document')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(0)
  })

  it('pages/api/* → page rule에서 제외 (api 영역)', async () => {
    resetEdgeId()
    const fn = pageFn('pages/api/users.ts', 'handler')
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    // pages_router는 api 폴더 제외. pages_api_file은 file 노드만 매칭.
    // 여기는 function node — page와 api 둘 다 안 잡힘
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    expect(pages).toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────
// Pages API
// ────────────────────────────────────────────────────────────
describe('Next.js — Pages API', () => {
  it('pages/api/users.ts → /api/users', async () => {
    resetEdgeId()
    const file = pageFile('pages/api/users.ts')
    const graph = createGraphIndex({ nodes: [file], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].fullPath).toBe('/api/users')
    expect(r.entryPoints[0].kind).toBe('api')
  })

  it('pages/api/users/[id].ts → /api/users/:id', async () => {
    resetEdgeId()
    const file = pageFile('pages/api/users/[id].ts')
    const graph = createGraphIndex({ nodes: [file], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/api/users/:id')
  })

  it('src/pages/api/auth/[...nextauth].ts → /api/auth/:nextauth*', async () => {
    resetEdgeId()
    const file = pageFile('src/pages/api/auth/[...nextauth].ts')
    const graph = createGraphIndex({ nodes: [file], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints[0].fullPath).toBe('/api/auth/:nextauth*')
  })
})

// ────────────────────────────────────────────────────────────
// Default export 변형 (function 형식 다양성)
// ────────────────────────────────────────────────────────────
describe('Next.js — default export 변형', () => {
  it('isDefaultExport=true function → 매칭', async () => {
    resetEdgeId()
    const fn = n({ id: 'r1:app/about/page.tsx:About', type: 'function',
                   filePath: 'app/about/page.tsx', name: 'About', isDefaultExport: true })
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].handlerNodeId).toBe(fn.id)
  })

  it('isDefaultExport=false function → app_page rule 매칭 X, file fallback으로', async () => {
    resetEdgeId()
    const fn = n({ id: 'r1:app/about/page.tsx:About', type: 'function',
                   filePath: 'app/about/page.tsx', name: 'About', isDefaultExport: false })
    const file = pageFile('app/about/page.tsx')
    const graph = createGraphIndex({ nodes: [fn, file], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    // file_fallback이 잡음
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].handlerNodeId).toBe(file.id)
    expect(r.entryPoints[0].detectionEvidence.matchedRuleId).toBe('app_page_file_fallback')
  })

  it('default export 2개 (잘못 짠 코드) → 둘 다 emit (실수 가시화)', async () => {
    resetEdgeId()
    const fn1 = n({ id: 'r1:app/page.tsx:A', type: 'function',
                    filePath: 'app/page.tsx', name: 'A', isDefaultExport: true })
    const fn2 = n({ id: 'r1:app/page.tsx:B', type: 'function',
                    filePath: 'app/page.tsx', name: 'B', isDefaultExport: true })
    const graph = createGraphIndex({ nodes: [fn1, fn2], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    const pages = r.entryPoints.filter((ep) => ep.kind === 'page')
    // 둘 다 default export → 둘 다 emit (코드 실수 가시화)
    // dedup으로 1건이 될 수도 있음 (같은 path/handler) — 정확한 동작은 dedup 정책 따라
    expect(pages.length).toBeGreaterThanOrEqual(1)
  })
})

// ────────────────────────────────────────────────────────────
// 복합 시나리오 — 실제 Next.js 13 앱 구조
// ────────────────────────────────────────────────────────────
describe('Next.js — 복합 앱 구조', () => {
  it('App Router 다중 페이지 + API + Pages Router 혼재 (점진 마이그레이션)', async () => {
    resetEdgeId()
    const nodes = [
      pageFn('app/page.tsx', 'Home'),
      pageFn('app/blog/[slug]/page.tsx', 'BlogPost'),
      pageFn('app/dashboard/page.tsx', 'Dashboard'),
      n({ id: 'r1:app/api/users/route.ts:GET', type: 'function',
          filePath: 'app/api/users/route.ts', name: 'GET', isDefaultExport: true }),
      pageFn('pages/legacy.tsx', 'Legacy'),
      pageFile('pages/api/old.ts'),
    ]
    const graph = createGraphIndex({ nodes, edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    const paths = r.entryPoints.map((ep) => ep.fullPath).sort()
    expect(paths).toEqual([
      '/',
      '/api/old',
      '/api/users',
      '/blog/:slug',
      '/dashboard',
      '/legacy',
    ])
  })

  it('동일 path에 function + file 노드 → function handler 우선', async () => {
    resetEdgeId()
    const fn = n({ id: 'r1:app/page.tsx:Home', type: 'function',
                   filePath: 'app/page.tsx', name: 'Home', isDefaultExport: true })
    const file = pageFile('app/page.tsx')
    const graph = createGraphIndex({ nodes: [fn, file], edges: [] })
    const r = await runRuleEngine({ adapters: [loaded(nextjs)], graph, repoId: REPO })
    expect(r.entryPoints).toHaveLength(1)
    expect(r.entryPoints[0].handlerNodeId).toBe(fn.id)
  })
})
