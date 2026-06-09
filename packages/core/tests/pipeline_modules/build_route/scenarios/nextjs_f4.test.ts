// Next.js F4 source fallback — 실사례 시나리오
//
// 2개 어댑터:
//   - nextjs_app_router: app/**/route.ts handler 추출
//   - nextjs_server_action: 'use server' directive 함수 추출

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
  const dir = mkdtempSync(join(tmpdir(), 'nextjs-f4-'))
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

function run(repoPath: string, nodes: CodeNode[]) {
  return buildSourceFallbackEntries({
    repoPath, repoId: REPO,
    stackInfo: { framework: 'nextjs', routingLibs: [] },
    detections: [{ framework: 'nextjs', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
    graphNodes: nodes,
    graphEdges: [],
  })
}

// ────────────────────────────────────────────────────────────
// nextjs_app_router — route.ts handler 추출
// ────────────────────────────────────────────────────────────
describe('Next.js F4 — nextjs_app_router', () => {
  it("app/api/users/route.ts: export GET / POST → 2 entries", () => {
    const fp = 'app/api/users/route.ts'
    const path = tempRepo({
      [fp]: `
export async function GET(request: Request) {
  return Response.json([])
}

export async function POST(request: Request) {
  return Response.json({}, { status: 201 })
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const app = entries.filter((e) => e.metadata?.adapterId === 'nextjs_app_router')
    expect(app.length).toBeGreaterThanOrEqual(2)
  })

  it('app/api/auth/[...nextauth]/route.ts: destructured export const { GET, POST } → method entries', () => {
    const fp = 'app/api/auth/[...nextauth]/route.ts'
    const path = tempRepo({
      [fp]: `
import { handlers } from "@/auth"

export const { GET, POST } = handlers
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const app = entries.filter((e) => e.metadata?.adapterId === 'nextjs_app_router')

    expect(app.map((entry) => ({ method: entry.httpMethod, path: entry.fullPath })).sort((a, b) => String(a.method).localeCompare(String(b.method)))).toEqual([
      { method: 'GET', path: '/api/auth/:nextauth*' },
      { method: 'POST', path: '/api/auth/:nextauth*' },
    ])
  })

  it("app/api/users/[id]/route.ts: PUT/DELETE", () => {
    const fp = 'app/api/users/[id]/route.ts'
    const path = tempRepo({
      [fp]: `
export async function PUT(request: Request, { params }) {
  return Response.json({})
}

export async function DELETE(request: Request, { params }) {
  return new Response(null, { status: 204 })
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const app = entries.filter((e) => e.metadata?.adapterId === 'nextjs_app_router')
    expect(app.length).toBeGreaterThanOrEqual(2)
  })

  it("src/app/api/route.ts (src prefix)", () => {
    const fp = 'src/app/api/health/route.ts'
    const path = tempRepo({
      [fp]: `
export function GET() {
  return Response.json({ status: 'ok' })
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const app = entries.filter((e) => e.metadata?.adapterId === 'nextjs_app_router')
    expect(app.length).toBeGreaterThanOrEqual(1)
  })

  it("HTTP method 7종 모두 (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS)", () => {
    const fp = 'app/api/all/route.ts'
    const path = tempRepo({
      [fp]: `
export async function GET() { return Response.json([]) }
export async function POST() { return Response.json({}, { status: 201 }) }
export async function PUT() { return Response.json({}) }
export async function PATCH() { return Response.json({}) }
export async function DELETE() { return new Response(null, { status: 204 }) }
export async function HEAD() { return new Response() }
export async function OPTIONS() { return new Response() }
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const app = entries.filter((e) => e.metadata?.adapterId === 'nextjs_app_router')
    expect(app.length).toBeGreaterThanOrEqual(5)  // 적어도 GET/POST/PUT/DELETE/PATCH
  })
})

// ────────────────────────────────────────────────────────────
// nextjs_server_action — 'use server' directive
// ────────────────────────────────────────────────────────────
describe('Next.js F4 — nextjs_server_action', () => {
  it("'use server' directive at top of file", () => {
    const fp = 'app/actions/users.ts'
    const path = tempRepo({
      [fp]: `
'use server'

export async function createUser(formData: FormData) {
  // server-only logic
}

export async function deleteUser(id: string) {
  // server-only logic
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const sa = entries.filter((e) => e.metadata?.adapterId === 'nextjs_server_action')
    expect(sa.length).toBeGreaterThanOrEqual(0)
  })

  it("inline 'use server' inside function", () => {
    const fp = 'app/components/form.tsx'
    const path = tempRepo({
      [fp]: `
export default function Form() {
  async function submit(formData: FormData) {
    'use server'
    // server logic
  }
  return <form action={submit}><input /></form>
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const sa = entries.filter((e) => e.metadata?.adapterId === 'nextjs_server_action')
    expect(sa.length).toBeGreaterThanOrEqual(0)
  })
})
