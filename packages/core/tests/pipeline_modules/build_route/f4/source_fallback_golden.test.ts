import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { CodeEdge, CodeNode } from '@/db/schema/code_graph.js'
import { buildSourceFallbackEntries } from '@/pipeline_modules/build_route/f4_evaluate_source_fallbacks.js'
import type { FrameworkDetectionResult, StackInfoForBuildRoute } from '@/pipeline_modules/build_route/types.js'
import { expectRouteOracle } from '../helpers/route_oracle.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'build-route-golden-'))
  tempDirs.push(dir)
  for (const [filePath, source] of Object.entries(files)) {
    const fullPath = join(dir, filePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, source)
  }
  return dir
}

function node(filePath: string, name: string, type: CodeNode['type'] = 'file'): CodeNode {
  return {
    id: `${REPO}:${filePath}${type === 'file' ? '' : `:${name}`}`,
    repoId: REPO,
    type,
    filePath,
    name,
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
    createdAt: '2026-05-13',
  }
}

function edge(partial: Partial<CodeEdge> & Pick<CodeEdge, 'sourceId' | 'relation'>): CodeEdge {
  return {
    id: Math.floor(Math.random() * 1000000),
    repoId: REPO,
    targetId: null,
    targetSpecifier: null,
    targetSymbol: null,
    chainPath: null,
    firstArg: null,
    literalArgs: null,
    argExpressions: null,
    resolveStatus: 'pending',
    confidence: null,
    typeRefSubtype: null,
    source: 'static',
    createdAt: '2026-05-13',
    ...partial,
  }
}

function detections(framework: string): FrameworkDetectionResult[] {
  return [{ framework, detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }]
}

function run(input: {
  repoPath: string
  framework: StackInfoForBuildRoute['framework']
  detections: FrameworkDetectionResult[]
  graphNodes: CodeNode[]
  graphEdges?: CodeEdge[]
  routingLibs?: string[]
}) {
  return buildSourceFallbackEntries({
    repoPath: input.repoPath,
    repoId: REPO,
    stackInfo: { framework: input.framework, routingLibs: input.routingLibs ?? [] },
    detections: input.detections,
    graphNodes: input.graphNodes,
    graphEdges: input.graphEdges ?? [],
  })
}

describe('source fallback golden route fixtures', () => {
  it('extracts Nestia TypedRoute controllers as api routes', () => {
    const filePath = 'src/users.controller.ts'
    const repoPath = tempRepo({
      [filePath]: `
import { Controller } from '@nestjs/common'
import { TypedRoute } from '@nestia/core'

@Controller('/users')
export class UsersController {
  @TypedRoute.Get('/:id')
  getUser() {}
}
`,
    })
    const file = node(filePath, filePath)
    const handler = node(filePath, 'UsersController.getUser', 'method')
    const entries = run({
      repoPath,
      framework: 'nestjs',
      detections: detections('nestjs'),
      graphNodes: [file, handler],
    })

    expectRouteOracle(entries, [{
      kind: 'api',
      method: 'GET',
      path: '/users/:id',
      handler: handler.id,
    }])
    expect(entries[0].metadata).toMatchObject({ adapterId: 'nestjs_nestia' })
  })

  it('extracts CustomCron jobs only when the wrapper resolves to Cron', () => {
    const filePath = 'src/jobs.ts'
    const file = node(filePath, filePath)
    const customCron = node(filePath, 'CustomCron', 'function')
    const handler = node(filePath, 'JobsService.run', 'method')
    const entries = run({
      repoPath: tempRepo({ [filePath]: 'export function CustomCron() { return Cron("* * * * *") }' }),
      framework: 'nestjs',
      detections: detections('nestjs'),
      graphNodes: [file, customCron, handler],
      graphEdges: [
        edge({ sourceId: customCron.id, relation: 'calls', targetSymbol: 'Cron' }),
        edge({ sourceId: handler.id, relation: 'decorates', targetSymbol: 'CustomCron', firstArg: "'* * * * *'" }),
      ],
    })

    expectRouteOracle(entries, [{
      kind: 'job',
      method: 'SCHEDULE',
      path: 'schedule:CustomCron:JobsService.run',
      handler: handler.id,
    }])
    expect(entries[0].metadata).toMatchObject({
      adapterId: 'nestjs_schedule',
      primitive: 'Cron',
      aliasChain: ['CustomCron', 'Cron'],
    })
  })

  it('extracts Flutter Navigator onGenerateRoute static const switch routes', () => {
    const filePath = 'lib/pages/app_router.dart'
    const repoPath = tempRepo({
      [filePath]: `
class AppRoutes {
  static const home = '/home';
}

Route<dynamic> onGenerateRoute(RouteSettings settings) {
  switch (settings.name) {
    case AppRoutes.home:
      return MaterialPageRoute<dynamic>(builder: (_) => const HomePage());
  }
}
`,
    })
    const file = node(filePath, filePath)
    const entries = run({
      repoPath,
      framework: 'flutter',
      detections: detections('flutter_navigator'),
      graphNodes: [file],
    })

    expectRouteOracle(entries, [{
      kind: 'page',
      path: '/home',
      handler: file.id,
    }])
    expect(entries[0].metadata).toMatchObject({ adapterId: 'flutter_navigator' })
  })

  it('prefixes nested React.lazy route modules with their parent route base', () => {
    const repoPath = tempRepo({
      'src/App.tsx': `
import * as React from 'react'
import { Routes, Route } from 'react-router-dom'
const Dashboard = React.lazy(() => import('./pages/Dashboard'))
export default function App() {
  return <Routes>
    <Route path="/" element={<div />}>
      <Route path="dashboard/*" element={<Dashboard />} />
    </Route>
  </Routes>
}
`,
      'src/pages/Dashboard.tsx': `
import { Routes, Route } from 'react-router-dom'
export default function Dashboard() {
  return <Routes>
    <Route path="/" element={<div />}>
      <Route index element={<div />} />
      <Route path="messages" element={<div />} />
    </Route>
  </Routes>
}
`,
    })
    const app = node('src/App.tsx', 'src/App.tsx')
    const dashboard = node('src/pages/Dashboard.tsx', 'src/pages/Dashboard.tsx')
    const entries = run({
      repoPath,
      framework: 'react_router_v6',
      detections: detections('react_router_v6'),
      graphNodes: [app, dashboard],
    })

    expect(entries.map((entry) => entry.fullPath).sort()).toEqual([
      '/',
      '/dashboard',
      '/dashboard/*',
      '/dashboard/messages',
    ])
  })

  it('extracts TanStack Router createFileRoute screens with file and component evidence', () => {
    const repoPath = join(process.cwd(), 'tests/fixtures/static_analysis/react-tanstack-router-fullcycle/web')
    const filePath = 'src/routes/invoices.tsx'
    const file = node(filePath, filePath)
    const component = node(filePath, 'InvoicesPage', 'function')
    const entries = run({
      repoPath,
      framework: 'react_router_v6',
      detections: detections('react_router_v6'),
      graphNodes: [file, component],
      routingLibs: ['@tanstack/react-router@^1'],
    })

    expectRouteOracle(entries, [{
      kind: 'page',
      path: '/invoices',
      handler: component.id,
    }])
    expect(entries[0].detectionSource).toBe('source:react_tanstack_router')
    expect(entries[0].detectionEvidence).toMatchObject({
      matchedRuleId: 'source_react_tanstack_file_route',
      matchedNodeIds: [file.id, component.id],
    })
  })

  it('extracts TanStack Start server handlers as method-aware API routes', () => {
    const filePath = 'app/routes/api/farcaster/$fid/casts.ts'
    const repoPath = tempRepo({
      [filePath]: `
import { createFileRoute } from '@tanstack/react-router'
import { getFidMessages } from '@/app/server/services/fid'

export const Route = createFileRoute('/api/farcaster/$fid/casts')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        return getFidMessages(params.fid)
      },
      POST: async ({ request }) => {
        return request.json()
      },
    },
  },
})
`,
    })
    const file = node(filePath, filePath)
    const entries = run({
      repoPath,
      framework: 'react_router_v6',
      detections: detections('react_router_v6'),
      graphNodes: [file],
      routingLibs: ['@tanstack/react-router@^1'],
    })

    expectRouteOracle(entries, [
      {
        kind: 'api',
        method: 'GET',
        path: '/api/farcaster/:fid/casts',
        handler: file.id,
      },
      {
        kind: 'api',
        method: 'POST',
        path: '/api/farcaster/:fid/casts',
        handler: file.id,
      },
    ])
    expect(entries.map((entry) => entry.detectionEvidence?.matchedRuleId)).toEqual([
      'source_react_tanstack_server_route',
      'source_react_tanstack_server_route',
    ])
  })

  it('extracts oRPC os.route declarations as API routes with procedure metadata', () => {
    const filePath = 'src/lib/markdown/render.ts'
    const repoPath = tempRepo({
      [filePath]: `
import { os } from '@orpc/server'

export const handler = os
  .route({
    method: 'POST',
    path: '/markdown/render',
  })
  .handler(async ({ input }) => ({ result: input.markdown }))
`,
    })
    const file = node(filePath, filePath)
    const entries = run({
      repoPath,
      framework: 'react_router_v6',
      detections: detections('react_router_v6'),
      graphNodes: [file],
      routingLibs: ['@orpc/server@^1'],
    })

    expectRouteOracle(entries, [
      {
        kind: 'api',
        method: 'POST',
        path: '/markdown/render',
        handler: file.id,
      },
    ])
    expect(entries[0]).toMatchObject({
      detectionSource: 'source:orpc',
      metadata: expect.objectContaining({
        canonicalTarget: 'orpc:markdown.render',
        sourceFallback: 'orpc_server_route',
      }),
      detectionEvidence: expect.objectContaining({
        matchedRuleId: 'source_orpc_server_route',
      }),
    })
  })

  it('splits Next pages API method dispatch routes into method-specific entrypoints', () => {
    const filePath = 'pages/api/pets/[id].ts'
    const repoPath = tempRepo({
      [filePath]: `
export default async function handler(req, res) {
  const { method } = req
  switch (method) {
    case "GET" /* Get a model by its ID */:
      return res.status(200).json({})
    case "PUT" /* Edit a model by its ID */:
      return res.status(200).json({})
    case "DELETE" /* Delete a model by its ID */:
      return res.status(200).json({})
    default:
      return res.status(400).json({})
  }
}
`,
    })
    const file = node(filePath, filePath)
    const entries = run({
      repoPath,
      framework: 'nextjs',
      detections: detections('nextjs'),
      graphNodes: [file],
    })

    expectRouteOracle(entries, [
      { kind: 'api', method: 'GET', path: '/api/pets/:id', handler: file.id },
      { kind: 'api', method: 'PUT', path: '/api/pets/:id', handler: file.id },
      { kind: 'api', method: 'DELETE', path: '/api/pets/:id', handler: file.id },
    ])
  })
})
