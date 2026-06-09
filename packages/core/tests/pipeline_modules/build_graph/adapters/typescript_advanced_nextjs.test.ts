/**
 * 카테고리 J — Next.js App Router
 *
 * - app/api/route.ts: GET/POST/PUT/DELETE export
 * - app/page.tsx, app/layout.tsx
 * - server actions ('use server')
 * - Link, useRouter, redirect
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'app/api/route.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('J. Next.js App Router', () => {
  it('J-01: route.ts — export async function GET(req)', () => {
    const r = parse(`
      import { NextResponse } from 'next/server'
      export async function GET(req: Request) {
        return NextResponse.json({ data: [] })
      }
    `)
    const fn = r.nodes.find((n) => n.type === 'function' && n.name === 'GET')
    expect(fn).toBeDefined()
    expect(fn!.exported).toBe(true)
    const json = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'json')
    expect(json).toBeDefined()
    expect(json!.target_specifier).toBe('next/server')
  })

  it('J-02: route.ts — POST with NextRequest', () => {
    const r = parse(`
      import { NextRequest, NextResponse } from 'next/server'
      export async function POST(req: NextRequest) {
        const body = await req.json()
        return NextResponse.json({ ok: true })
      }
    `)
    const post = r.nodes.find((n) => n.type === 'function' && n.name === 'POST')
    expect(post).toBeDefined()
  })

  it('J-03: route.ts — 모든 HTTP 메서드 export', () => {
    const r = parse(`
      import { NextResponse } from 'next/server'
      export async function GET() { return NextResponse.json([]) }
      export async function POST() { return NextResponse.json({}) }
      export async function PUT() { return NextResponse.json({}) }
      export async function DELETE() { return new Response(null, { status: 204 }) }
      export async function PATCH() { return NextResponse.json({}) }
    `)
    const methods = r.nodes
      .filter((n) => n.type === 'function' && ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(n.name ?? ''))
      .map((n) => n.name)
      .sort()
    expect(methods).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
  })

  it('J-04: page.tsx — named export default function (V1 한계 회귀 보호)', () => {
    const r = parse(`
      export default async function Page() {
        return <div>Hello</div>
      }
    `, 'app/page.tsx')
    // V1: default export async function의 노드 처리는 함수 자체로만 (name 'Page' 또는 'default')
    // 어떤 형태든 function 노드 1개 이상 존재
    const fns = r.nodes.filter((n) => n.type === 'function')
    expect(fns.length).toBeGreaterThanOrEqual(1)
  })

  it('J-05: layout.tsx — children prop pattern', () => {
    const r = parse(`
      export default function RootLayout({ children }: { children: React.ReactNode }) {
        return <html><body>{children}</body></html>
      }
    `, 'app/layout.tsx')
    // RootLayout default export 함수 노드
    const fn = r.nodes.find((n) => n.type === 'function')
    expect(fn).toBeDefined()
  })

  it("J-06: server action — 'use server' directive", () => {
    const r = parse(`
      'use server'
      import { db } from '@/db'
      export async function createUser(formData: FormData) {
        await db.insert(/* ... */)
      }
    `, 'app/actions.ts')
    const fn = r.nodes.find((n) => n.type === 'function' && n.name === 'createUser')
    expect(fn).toBeDefined()
  })

  it('J-07: <Link href="/orders" /> — Next.js Link 컴포넌트 (renders edge)', () => {
    const r = parse(`
      import Link from 'next/link'
      export function Nav() {
        return <Link href="/orders">Orders</Link>
      }
    `, 'app/Nav.tsx')
    const e = r.edges.find((edge) => edge.relation === 'renders' && edge.target_symbol === 'Link')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('next/link')
    expect(e!.literal_args).toBe(JSON.stringify([{ href: '/orders' }]))
  })

  it('J-08: useRouter().push("/x") — 함수-scope alias chain resolved (A3)', () => {
    const r = parse(`
      'use client'
      import { useRouter } from 'next/navigation'
      export function Btn() {
        const router = useRouter()
        return <button onClick={() => router.push('/orders')}>Go</button>
      }
    `, 'app/Btn.tsx')
    // useRouter 자체 호출은 잡힘 (top-level import)
    const useRouter = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'useRouter')
    expect(useRouter).toBeDefined()
    expect(useRouter!.target_specifier).toBe('next/navigation')
    // A3 — const router = useRouter() 함수 본문 alias로 router.push specifier resolved
    const push = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'push')
    expect(push).toBeDefined()
    expect(push?.target_specifier).toBe('next/navigation')
    expect(push?.chain_path).toBe('router')
  })

  it('J-09: redirect("/login") — server-side redirect', () => {
    const r = parse(`
      import { redirect } from 'next/navigation'
      export async function GET() {
        redirect('/login')
      }
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'redirect')
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('/login')
    expect(e!.target_specifier).toBe('next/navigation')
  })

  it('J-10: middleware.ts — NextResponse middleware', () => {
    const r = parse(`
      import { NextResponse, NextRequest } from 'next/server'
      export function middleware(req: NextRequest) {
        if (!req.cookies.get('auth')) {
          return NextResponse.redirect(new URL('/login', req.url))
        }
        return NextResponse.next()
      }
      export const config = { matcher: ['/dashboard/:path*'] }
    `, 'middleware.ts')
    const mw = r.nodes.find((n) => n.type === 'function' && n.name === 'middleware')
    expect(mw).toBeDefined()
    const redirect = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'redirect')
    expect(redirect).toBeDefined()
  })
})
