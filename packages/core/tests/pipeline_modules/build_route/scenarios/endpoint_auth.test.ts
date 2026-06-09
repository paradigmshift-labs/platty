/**
 * build_route — endpoint authorization extraction (Spring @PreAuthorize / NestJS @UseGuards·@Roles).
 * Real-parse (no synthetic edges): build_graph emits the auth annotations as decorates edges;
 * build_route's auth rulebook reads them into entryPoint.metadata.auth.
 *
 * Spec: specs/build_route/endpoint-auth.md
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { JvmAstParserAdapter } from '@/pipeline_modules/build_graph/adapters/jvm_ast.js'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'
import { createGraphIndex } from '@/pipeline_modules/build_route/graph_index.js'
import { runRuleEngine } from '@/pipeline_modules/build_route/f3_run_rule_engine.js'
import { spring } from '@/pipeline_modules/build_route/adapters/spring.js'
import { nestjs } from '@/pipeline_modules/build_route/adapters/nestjs.js'
import { loaded } from '../helpers/graph_builders.js'
import type { CodeNode, CodeEdge } from '@/db/schema/code_graph.js'
import type { RouteAuth } from '@/pipeline_modules/build_route/auth_rulebooks/types.js'

function graphFromParse(parsed: { nodes: any[]; edges: any[] }) {
  const nodes: CodeNode[] = parsed.nodes.map((n) => ({
    id: n.id, repoId: n.repo_id, type: n.type, filePath: n.file_path, name: n.name,
    lineStart: n.line_start, lineEnd: n.line_end, signature: n.signature ?? null,
    exported: n.exported ?? false, isDefaultExport: false, isAsync: n.is_async ?? false,
    isTest: n.is_test ?? false, testType: n.test_type ?? null, docComment: n.jsdoc ?? null,
    parseStatus: n.parse_status ?? 'ok', createdAt: '2026-06-05',
  }) as CodeNode)
  let id = 1
  const edges: CodeEdge[] = parsed.edges.map((e) => ({
    id: id++, repoId: e.repo_id, sourceId: e.source_id, targetId: e.target_id ?? null,
    relation: e.relation, targetSpecifier: e.target_specifier ?? null, targetSymbol: e.target_symbol ?? null,
    firstArg: e.first_arg ?? null, literalArgs: e.literal_args ?? null,
    resolveStatus: e.resolve_status === 'n/a' ? 'pending' : e.resolve_status, confidence: e.confidence ?? null,
    source: e.source ?? 'static', chainPath: e.chain_path ?? null, typeRefSubtype: e.type_ref_subtype ?? null,
    createdAt: '2026-06-05',
  }) as CodeEdge)
  return createGraphIndex({ nodes, edges })
}

function authOf(ep: { metadata: Record<string, unknown> }): RouteAuth | undefined {
  return ep.metadata.auth as RouteAuth | undefined
}

describe('endpoint auth — Spring', () => {
  let jvm: JvmAstParserAdapter
  beforeAll(async () => { jvm = await JvmAstParserAdapter.create() })

  async function run(src: string) {
    const parsed = jvm.parseFile(src, 'src/main/java/com/acme/C.java', 'r1') as { nodes: any[]; edges: any[] }
    return runRuleEngine({ adapters: [loaded(spring)], graph: graphFromParse(parsed), repoId: 'r1' })
  }

  const HEADER = `import org.springframework.web.bind.annotation.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.access.annotation.Secured;
import jakarta.annotation.security.PermitAll;
`

  it('EA-01: @PreAuthorize("hasRole(\'ADMIN\')") + @GetMapping → auth {required, roles:[ADMIN], expression}', async () => {
    const r = await run(`${HEADER}@RestController
@RequestMapping("/api/orders")
class C {
  @PreAuthorize("hasRole('ADMIN')")
  @GetMapping("/{id}")
  public String get() { return "x"; }
}`)
    const ep = r.entryPoints.find((e) => e.httpMethod === 'GET')
    expect(ep, 'GET route extracted').toBeDefined()
    const auth = authOf(ep!)
    expect(auth?.required).toBe(true)
    expect(auth?.scope).toBe('method')
    expect(auth?.expression).toBe("hasRole('ADMIN')")
    expect(auth?.roles).toEqual(['ADMIN'])
    expect(auth?.decorators).toContain('PreAuthorize')
  })

  it('EA-04: @PermitAll → auth.required=false (explicit public)', async () => {
    const r = await run(`${HEADER}@RestController
class C {
  @PermitAll
  @GetMapping("/public")
  public String pub() { return "z"; }
}`)
    const ep = r.entryPoints.find((e) => e.httpMethod === 'GET')
    expect(authOf(ep!)?.required).toBe(false)
  })

  it('EA-03: class-level @Secured (method has none) → inherited scope:class', async () => {
    const r = await run(`${HEADER}@RestController
@Secured("ROLE_ADMIN")
class C {
  @GetMapping("/x")
  public String x() { return "x"; }
}`)
    const ep = r.entryPoints.find((e) => e.httpMethod === 'GET')
    const auth = authOf(ep!)
    expect(auth?.required).toBe(true)
    expect(auth?.scope).toBe('class')
    expect(auth?.roles).toContain('ROLE_ADMIN')
  })

  it('EA-07 (negative): no auth annotation → metadata.auth undefined (no guessing)', async () => {
    const r = await run(`${HEADER}@RestController
class C {
  @GetMapping("/open")
  public String open() { return "o"; }
}`)
    const ep = r.entryPoints.find((e) => e.httpMethod === 'GET')
    expect(ep, 'route still extracted').toBeDefined()
    expect(authOf(ep!)).toBeUndefined()
  })
})

describe('endpoint auth — NestJS', () => {
  const ts = new TypeScriptParserAdapter()
  function run(src: string) {
    const parsed = ts.parseFile(src, 'src/users.controller.ts', 'r1') as { nodes: any[]; edges: any[] }
    return runRuleEngine({ adapters: [loaded(nestjs)], graph: graphFromParse(parsed), repoId: 'r1' })
  }

  it('EA-05: @UseGuards + @Roles(\'admin\',\'moderator\') + @Get → auth {required, roles}', async () => {
    const r = await run(`import { Controller, Get, UseGuards } from '@nestjs/common'
@Controller('users')
export class UsersController {
  @Roles('admin', 'moderator')
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne() {}
}`)
    const ep = r.entryPoints.find((e) => e.httpMethod === 'GET')
    expect(ep, 'GET route extracted').toBeDefined()
    const auth = authOf(ep!)
    expect(auth?.required).toBe(true)
    expect(auth?.roles).toEqual(['admin', 'moderator'])
    expect(auth?.decorators.some((d) => d === 'UseGuards' || d === 'Roles')).toBe(true)
  })

  it('EA-06: @Public() → auth.required=false', async () => {
    const r = await run(`import { Controller, Get } from '@nestjs/common'
@Controller('users')
export class UsersController {
  @Public()
  @Get('health')
  health() {}
}`)
    const ep = r.entryPoints.find((e) => e.httpMethod === 'GET')
    expect(authOf(ep!)?.required).toBe(false)
  })
})
