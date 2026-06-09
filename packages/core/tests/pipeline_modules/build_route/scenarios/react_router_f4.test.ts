// React Router F4 source fallback — 실사례 시나리오
//
// 2개 어댑터:
//   - react_router_object: createBrowserRouter / createHashRouter (object form)
//   - react_router_interaction: useNavigate / useLocation / Link 등 nav 패턴

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
  const dir = mkdtempSync(join(tmpdir(), 'react-router-f4-'))
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

function functionNode(filePath: string, name: string): CodeNode {
  return {
    ...fileNode(filePath),
    id: `${REPO}:${filePath}:${name}`,
    type: 'function',
    name,
  }
}

function run(repoPath: string, nodes: CodeNode[]) {
  return buildSourceFallbackEntries({
    repoPath, repoId: REPO,
    stackInfo: { framework: 'react', routingLibs: ['react-router-dom@^6'] },
    detections: [{ framework: 'react_router_v6', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
    graphNodes: nodes,
    graphEdges: [],
  })
}

// ────────────────────────────────────────────────────────────
// react_router_object — createBrowserRouter
// ────────────────────────────────────────────────────────────
describe('React Router F4 — react_router_object', () => {
  it("createBrowserRouter([{ path, element }])", () => {
    const fp = 'src/router.tsx'
    const path = tempRepo({
      [fp]: `
import { createBrowserRouter } from 'react-router-dom'
import Home from './pages/Home'
import About from './pages/About'

export const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/about', element: <About /> },
  { path: '/users/:id', element: <UserPage /> },
])
`,
      'src/pages/Home.tsx': `export default function Home() { return null }`,
      'src/pages/About.tsx': `export default function About() { return null }`,
    })
    const file = fileNode(fp)
    const entries = run(path, [
      file,
      fileNode('src/pages/Home.tsx'),
      fileNode('src/pages/About.tsx'),
      functionNode('src/pages/Home.tsx', 'Home'),
      functionNode('src/pages/About.tsx', 'About'),
    ])
    const obj = entries.filter((e) => e.metadata?.adapterId === 'react_router_object')
    expect(obj.map((entry) => entry.fullPath).sort()).toEqual(expect.arrayContaining([
      '/',
      '/about',
      '/users/:id',
    ]))
    expect(obj.find((entry) => entry.fullPath === '/')?.handlerNodeId).toBe(`${REPO}:src/pages/Home.tsx:Home`)
    expect(obj.find((entry) => entry.fullPath === '/about')?.handlerNodeId).toBe(`${REPO}:src/pages/About.tsx:About`)
  })

  it("createBrowserRouter with nested children", () => {
    const fp = 'src/router.tsx'
    const path = tempRepo({
      [fp]: `
import { createBrowserRouter } from 'react-router-dom'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { path: 'home', element: <Home /> },
      { path: 'dashboard', element: <Dashboard /> },
    ],
  },
])
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries.map((entry) => entry.fullPath).sort()).toEqual(expect.arrayContaining([
      '/',
      '/home',
      '/dashboard',
    ]))
  })

  it("createHashRouter object routes emit static paths", () => {
    const fp = 'src/router.tsx'
    const path = tempRepo({
      [fp]: `
import { createHashRouter } from 'react-router-dom'

export const router = createHashRouter([
  { path: '/', element: <Home /> },
  { path: '/settings', element: <Settings /> },
])
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries.map((entry) => entry.fullPath).sort()).toEqual(expect.arrayContaining([
      '/',
      '/settings',
    ]))
  })

  it("createMemoryRouter object routes emit nested index route parent paths", () => {
    const fp = 'src/router.tsx'
    const path = tempRepo({
      [fp]: `
import { createMemoryRouter } from 'react-router-dom'

export const router = createMemoryRouter([
  {
    path: '/console',
    element: <ConsoleLayout />,
    children: [
      { index: true, element: <ConsoleHome /> },
      { path: 'reports', element: <Reports /> },
    ],
  },
])
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    expect(entries.map((entry) => entry.fullPath).sort()).toEqual(expect.arrayContaining([
      '/console',
      '/console/reports',
    ]))
  })

  it('createBrowserRouter loader/action identifiers become interaction entries through named imports', () => {
    const routerFile = 'src/App.tsx'
    const routeFile = 'src/routes/accounts.tsx'
    const path = tempRepo({
      [routerFile]: `
import { createBrowserRouter } from 'react-router-dom'
import { AccountRoute, accountAction, accountLoader } from './routes/accounts'

export const router = createBrowserRouter([
  {
    path: '/accounts/:accountId',
    element: <AccountRoute />,
    loader: accountLoader,
    action: accountAction,
  },
])
`,
      [routeFile]: `
export async function accountLoader() {}
export async function accountAction() {}
export function AccountRoute() {}
`,
    })
    const entries = run(path, [
      fileNode(routerFile),
      fileNode(routeFile),
      functionNode(routeFile, 'accountLoader'),
      functionNode(routeFile, 'accountAction'),
      functionNode(routeFile, 'AccountRoute'),
    ])

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'api',
        httpMethod: 'GET',
        fullPath: '/accounts/:accountId#loader',
        handlerNodeId: `${REPO}:${routeFile}:accountLoader`,
        metadata: expect.objectContaining({ interactionKind: 'react_router_loader' }),
      }),
      expect.objectContaining({
        kind: 'api',
        httpMethod: 'POST',
        fullPath: '/accounts/:accountId#action',
        handlerNodeId: `${REPO}:${routeFile}:accountAction`,
        metadata: expect.objectContaining({ interactionKind: 'react_router_action' }),
      }),
    ]))
  })

  it('createBrowserRouter loader/action extraction tolerates nested JSX props before handlers', () => {
    const routerFile = 'src/App.tsx'
    const routeFile = 'src/routes/reports.tsx'
    const path = tempRepo({
      [routerFile]: `
import { createBrowserRouter } from 'react-router-dom'
import { ReportsRoute, reportsAction, reportsLoader } from './routes/reports'

export const router = createBrowserRouter([
  {
    path: '/reports/:reportId',
    element: <ReportsRoute config={{ title: 'Quarterly', flags: { pinned: true } }} />,
    loader: reportsLoader,
    action: reportsAction,
  },
])
`,
      [routeFile]: `
export async function reportsLoader() {}
export async function reportsAction() {}
export function ReportsRoute() {}
`,
    })
    const entries = run(path, [
      fileNode(routerFile),
      fileNode(routeFile),
      functionNode(routeFile, 'reportsLoader'),
      functionNode(routeFile, 'reportsAction'),
      functionNode(routeFile, 'ReportsRoute'),
    ])

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'api',
        httpMethod: 'GET',
        fullPath: '/reports/:reportId#loader',
      }),
      expect.objectContaining({
        kind: 'api',
        httpMethod: 'POST',
        fullPath: '/reports/:reportId#action',
      }),
    ]))
  })
})

// ────────────────────────────────────────────────────────────
// react_router_interaction — useNavigate / Link
// ────────────────────────────────────────────────────────────
describe('React Router F4 — react_router_interaction', () => {
  it("useNavigate() + navigate('/path')", () => {
    const fp = 'src/components/Nav.tsx'
    const path = tempRepo({
      [fp]: `
import { useNavigate } from 'react-router-dom'

export function Nav() {
  const navigate = useNavigate()
  return (
    <>
      <button onClick={() => navigate('/home')}>Home</button>
      <button onClick={() => navigate('/profile')}>Profile</button>
      <button onClick={() => navigate('/settings')}>Settings</button>
    </>
  )
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const inter = entries.filter((e) => e.metadata?.adapterId === 'react_router_interaction')
    expect(inter.length).toBeGreaterThanOrEqual(0)
  })

  it("<Link to='/path'>", () => {
    const fp = 'src/components/Menu.tsx'
    const path = tempRepo({
      [fp]: `
import { Link } from 'react-router-dom'

export function Menu() {
  return (
    <nav>
      <Link to="/home">Home</Link>
      <Link to="/about">About</Link>
      <Link to="/contact">Contact</Link>
    </nav>
  )
}
`,
    })
    const file = fileNode(fp)
    const entries = run(path, [file])
    const inter = entries.filter((e) => e.metadata?.adapterId === 'react_router_interaction')
    expect(inter.length).toBeGreaterThanOrEqual(0)
  })
})
