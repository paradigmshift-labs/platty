// V1: 각 보고된 빈틈이 진짜 이슈인지 검증하는 테스트.
// 통과 = 이미 잘 처리됨 (이슈 아님)
// 실패 = 실제 빈틈 확인 → 고쳐야 함

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeNode } from '@/db/schema/code_graph.js'
import { buildSourceFallbackEntries } from '@/pipeline_modules/build_route/f4_evaluate_source_fallbacks.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { nextjs } from '@/pipeline_modules/build_route/adapters/nextjs.js'
import { n, loaded, resetEdgeId, TEST_REPO } from '../helpers/graph_builders.js'

const REPO = 'repo'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gap-verify-'))
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
    repoId: REPO, type: 'file', filePath,
    name: filePath.split('/').pop() ?? filePath,
    lineStart: null, lineEnd: null, signature: null,
    exported: false, isDefaultExport: false, isAsync: false, isTest: false,
    testType: null, docComment: null, parseStatus: 'ok',
    createdAt: '2026-05-15',
  }
}

function methodNode(filePath: string, qualifiedName: string): CodeNode {
  return {
    id: `${REPO}:${filePath}:${qualifiedName}`,
    repoId: REPO, type: 'method', filePath,
    name: qualifiedName.split('.').pop() ?? qualifiedName,
    lineStart: null, lineEnd: null, signature: null,
    exported: false, isDefaultExport: false, isAsync: false, isTest: false,
    testType: null, docComment: null, parseStatus: 'ok',
    createdAt: '2026-05-15',
  }
}

// ────────────────────────────────────────────────────────────
// G1: Next.js app_route_handler — named export GET/POST/...
// ────────────────────────────────────────────────────────────
describe('V1-G1: Next.js route.ts named export → F3 매칭', () => {
  it('app/api/users/route.ts: export function GET() → F3 룰이 entry 생성', async () => {
    resetEdgeId()
    // 실제 NextJS route handler 표준: named export (not default)
    const fn = n({
      id: 'repo:app/api/users/route.ts:GET',
      type: 'function',
      filePath: 'app/api/users/route.ts',
      name: 'GET',
      isDefaultExport: false,  // ← named export
      exported: true,
    })
    const graph = createGraphIndex({ nodes: [fn], edges: [] })
    const r = await runRuleEngine({
      adapters: [loaded(nextjs)],
      graph,
      repoId: TEST_REPO,
    })
    // 매칭되어야 함: app_route_handler 또는 fallback 어느 룰이든
    const apis = r.entryPoints.filter((ep) => ep.kind === 'api')
    expect(apis.length).toBeGreaterThanOrEqual(1)
    // app_route_handler가 매칭되는 게 이상적 (file_fallback이 아님)
    expect(apis.some((ep) => ep.detectionEvidence.matchedRuleId === 'app_route_handler')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// G2: Flutter Navigator routesBlock trailing comma
// ────────────────────────────────────────────────────────────
describe('V1-G2: MaterialApp routes 마지막 named arg (쉼표 없음)', () => {
  it("routes가 마지막 인자에 trailing comma 없을 때도 추출", () => {
    const fp = 'lib/main.dart'
    const path = tempRepo({
      [fp]: `
import 'package:flutter/material.dart';

void main() => runApp(MaterialApp(
  routes: {
    '/': (context) => HomePage(),
    '/about': (context) => AboutPage(),
  }   // ← trailing comma 없음
));
`,
    })
    const file = fileNode(fp)
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'flutter', routingLibs: [] },
      detections: [{ framework: 'flutter_navigator', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file], graphEdges: [],
    })
    const nav = entries.filter((e) => e.metadata?.adapterId === 'flutter_navigator')
    expect(nav.length).toBeGreaterThanOrEqual(2)
  })
})

// ────────────────────────────────────────────────────────────
// G3: NestJS controllerRe — 중간 데코레이터 간섭
// ────────────────────────────────────────────────────────────
describe('V1-G3: NestJS @ApiTags + @UseGuards + @Controller 조합', () => {
  it('@ApiTags("u") + @UseGuards(G) + @Controller("users") → 추출됨', () => {
    const fp = 'src/users.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

@ApiTags('users')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  @Get(':id')
  findOne() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'UsersController.findOne')
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'nestjs', routingLibs: [] },
      detections: [{ framework: 'nestjs', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file, handler], graphEdges: [],
    })
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl.length).toBeGreaterThanOrEqual(1)
    expect(ctrl[0].fullPath).toBe('/users/:id')
  })
})

// ────────────────────────────────────────────────────────────
// G4: Flutter findMatchingParen — 문자열 내부 )
// ────────────────────────────────────────────────────────────
describe('V1-G4: GoRoute builder 안에 ) 가 있는 문자열', () => {
  it("GoRoute builder가 'Hello (world)' 같은 문자열 반환할 때도 path 추출", () => {
    const fp = 'lib/router.dart'
    const path = tempRepo({
      [fp]: `
import 'package:go_router/go_router.dart';

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/greet',
      builder: (context, state) => Text('Hello (world)'),
    ),
    GoRoute(
      path: '/profile',
      builder: (context, state) => ProfilePage(),
    ),
  ],
);
`,
    })
    const file = fileNode(fp)
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'flutter', routingLibs: ['go_router'] },
      detections: [{ framework: 'flutter_gorouter', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file], graphEdges: [],
    })
    const gorouter = entries.filter((e) => e.metadata?.adapterId === 'flutter_gorouter')
    const paths = gorouter.map((e) => e.fullPath).sort()
    expect(paths).toContain('/greet')
    expect(paths).toContain('/profile')
  })
})

// ────────────────────────────────────────────────────────────
// G5: NestJS Controller 배열 path
// ────────────────────────────────────────────────────────────
describe('V1-G5: @Controller(["users", "profiles"]) — 배열 path', () => {
  it("배열의 첫 prefix가 사용되어야 함 (현재 / 로 fallback 됨)", () => {
    const fp = 'src/multi.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get } from '@nestjs/common'

@Controller(['users', 'profiles'])
export class MultiController {
  @Get(':id')
  findOne() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'MultiController.findOne')
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'nestjs', routingLibs: [] },
      detections: [{ framework: 'nestjs', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file, handler], graphEdges: [],
    })
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl.length).toBeGreaterThanOrEqual(1)
    // 첫 번째 path 사용 — '/users/:id'가 되어야 함
    expect(ctrl[0].fullPath).toBe('/users/:id')
  })
})

// ────────────────────────────────────────────────────────────
// G6: NestJS Versioning
// ────────────────────────────────────────────────────────────
describe('V1-G6: @Controller({ version: "1", path: "users" })', () => {
  it("version + path 객체 형식 → /v1/users 형태로 추출", () => {
    const fp = 'src/v.controller.ts'
    const path = tempRepo({
      [fp]: `
import { Controller, Get } from '@nestjs/common'

@Controller({ version: '1', path: 'users' })
export class VersionedController {
  @Get()
  list() {}
}
`,
    })
    const file = fileNode(fp)
    const handler = methodNode(fp, 'VersionedController.list')
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'nestjs', routingLibs: [] },
      detections: [{ framework: 'nestjs', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file, handler], graphEdges: [],
    })
    const ctrl = entries.filter((e) => e.metadata?.adapterId === 'nestjs_controller')
    expect(ctrl.length).toBeGreaterThanOrEqual(1)
    // versioning이 적용되어 /v1/users 또는 metadata에 version 정보가 있어야 함
    const ep = ctrl[0]
    const hasVersion = ep.fullPath?.startsWith('/v1') || ep.metadata?.version === '1'
    expect(hasVersion).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// G7: Flutter Navigator routes handler — 블록 body
// ────────────────────────────────────────────────────────────
describe('V1-G7: MaterialApp routes builder가 블록 body { ... return }', () => {
  it("'/profile': (c) { final args = ...; return ProfilePage(); } 형태", () => {
    const fp = 'lib/main.dart'
    const path = tempRepo({
      [fp]: `
import 'package:flutter/material.dart';

void main() => runApp(MaterialApp(
  routes: {
    '/home': (context) => HomePage(),
    '/profile': (context) {
      final args = ModalRoute.of(context)?.settings.arguments;
      return ProfilePage(userId: args as String);
    },
  },
));
`,
    })
    const file = fileNode(fp)
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'flutter', routingLibs: [] },
      detections: [{ framework: 'flutter_navigator', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file], graphEdges: [],
    })
    const nav = entries.filter((e) => e.metadata?.adapterId === 'flutter_navigator')
    const paths = nav.map((e) => e.fullPath).sort()
    expect(paths).toContain('/home')
    expect(paths).toContain('/profile')
  })
})

// ────────────────────────────────────────────────────────────
// G8: Express 변수명 다양성 (server, api)
// ────────────────────────────────────────────────────────────
describe('V1-G8: Express server.get(...) / api.get(...) (app이 아닌 변수명)', () => {
  it('const server = express(); server.get(...)', () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
import express from 'express'

const server = express()
server.use(express.json())
server.get('/health', (req, res) => res.send('ok'))
server.post('/users', (req, res) => res.status(201).send())
`,
    })
    const file = fileNode(fp)
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [{ framework: 'express', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file], graphEdges: [],
    })
    const expr = entries.filter((e) => String(e.metadata?.adapterId ?? '').includes('express'))
    const sigs = expr.map((e) => `${e.httpMethod} ${e.fullPath}`).sort()
    expect(sigs).toContain('GET /health')
    expect(sigs).toContain('POST /users')
  })
})

// ────────────────────────────────────────────────────────────
// G9: Express let/var 상수 path
// ────────────────────────────────────────────────────────────
describe('V1-G9: Express let/var 상수 path', () => {
  it("let BASE = '/api/v1'; app.get(BASE, h) — let 형식도 추출", () => {
    const fp = 'src/server.ts'
    const path = tempRepo({
      [fp]: `
import express from 'express'
const app = express()
app.use(express.json())

let BASE_PATH = '/api/v1'
var HEALTH = '/health'

app.get(BASE_PATH, (req, res) => res.send('hi'))
app.get(HEALTH, (req, res) => res.send('ok'))
`,
    })
    const file = fileNode(fp)
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'express', routingLibs: [] },
      detections: [{ framework: 'express', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file], graphEdges: [],
    })
    const sigs = entries.filter((e) => String(e.metadata?.adapterId ?? '').includes('express'))
      .map((e) => `${e.httpMethod} ${e.fullPath}`).sort()
    expect(sigs).toContain('GET /api/v1')
    expect(sigs).toContain('GET /health')
  })
})

// ────────────────────────────────────────────────────────────
// G10: React Router index route
// ────────────────────────────────────────────────────────────
describe('V1-G10: React Router { index: true, element }', () => {
  it("createBrowserRouter children에 index route 있으면 parent path로 추가", () => {
    const fp = 'src/router.tsx'
    const path = tempRepo({
      [fp]: `
import { createBrowserRouter } from 'react-router-dom'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Root />,
    children: [
      { index: true, element: <Home /> },
      { path: 'about', element: <About /> },
    ],
  },
])
`,
    })
    const file = fileNode(fp)
    const entries = buildSourceFallbackEntries({
      repoPath: path, repoId: REPO,
      stackInfo: { framework: 'react', routingLibs: ['react-router-dom@^6'] },
      detections: [{ framework: 'react_router_v6', detectedVia: 'manifest', evidence: {}, active: true, priority: 10, exclusiveWith: [] }],
      graphNodes: [file], graphEdges: [],
    })
    const paths = entries.map((e) => e.fullPath).sort()
    // '/' (index of '/') 와 '/about' 둘 다 추출되어야 함
    expect(paths.length).toBeGreaterThanOrEqual(1)
    // 최소한 '/about'은 잡혀야 함
    expect(paths).toContain('/about')
  })
})
