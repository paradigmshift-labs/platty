/**
 * ARG-E2E: argExpressions end-to-end pipeline 검증
 *
 * runBuildGraph 전체 파이프라인을 통과한 후 DB에 저장된
 * code_edges.arg_expressions 를 직접 확인한다.
 *
 * Broad snapshot 재생성 없이 작은 인라인 fixture만 사용.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq, and } from 'drizzle-orm'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import * as schema from '@/db/schema/index.js'
import { projects, repositories, repositoryPhaseStatus } from '@/db/schema/core.js'
import { codeEdges } from '@/db/schema/code_graph.js'
import { runBuildGraph } from '@/pipeline_modules/build_graph/index.js'
import type { CallArgExpression } from '@/pipeline_modules/build_graph/types.js'

type DB = ReturnType<typeof drizzle<typeof schema>>

function createDb(): DB {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: './src/db/migrations' })
  return db
}

function makeRepo(db: DB, repoPath: string, opts: { language?: 'typescript' | 'dart' } = {}): string {
  const now = new Date().toISOString()
  db.insert(projects).values({ id: 'p', name: 'p', createdAt: now, updatedAt: now }).run()
  const repoId = 'r1'
  db.insert(repositories)
    .values({
      id: repoId,
      projectId: 'p',
      name: 'r',
      repoPath,
      language: opts.language ?? 'typescript',
      framework: 'nestjs' as const,
      pathAliases: {},
      baseUrl: 'src',
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db.insert(repositoryPhaseStatus)
    .values({
      repositoryId: repoId,
      phase: 'analyze_repo',
      builtAt: now,
      validity: 'fresh',
      confirmedAt: now,
      updatedAt: now,
    })
    .run()
  return repoId
}

function gitInitCommit(dir: string): void {
  execSync('git init -q && git config user.email t@t.t && git config user.name t', { cwd: dir })
  execSync('git add -A && git commit -q -m init --allow-empty', { cwd: dir })
}

describe('ARG-E2E: pipeline 전체 경로 argExpressions 저장 검증', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sdd-arg-e2e-'))
  })

  it('ARG-E2E-01: TS template string → DB에 staticPattern 저장', async () => {
    writeFileSync(
      join(tmp, 'service.ts'),
      `import axios from 'axios'
export async function getUser(id: string) {
  return axios.get(\`/api/users/\${id}\`)
}
`,
    )
    gitInitCommit(tmp)

    const db = createDb()
    const repoId = makeRepo(db, tmp)
    const { completion } = runBuildGraph({ repoId }, db)
    await completion

    const rows = db
      .select()
      .from(codeEdges)
      .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.targetSymbol, 'get')))
      .all()

    const axiosGet = rows.find((r) => r.chainPath?.includes('axios'))
    expect(axiosGet).toBeDefined()

    const exprs = axiosGet!.argExpressions as CallArgExpression[] | null
    expect(exprs).not.toBeNull()
    expect(exprs![0].kind).toBe('template')
    expect(exprs![0].staticPattern).toBe('/api/users/:id')
    expect(exprs![0].identifiers).toContain('id')
  })

  it('ARG-E2E-02: TS string literal → DB에 value 저장', async () => {
    writeFileSync(
      join(tmp, 'service.ts'),
      `import axios from 'axios'
export async function listUsers() {
  return axios.get('/api/users')
}
`,
    )
    gitInitCommit(tmp)

    const db = createDb()
    const repoId = makeRepo(db, tmp)
    const { completion } = runBuildGraph({ repoId }, db)
    await completion

    const rows = db
      .select()
      .from(codeEdges)
      .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.targetSymbol, 'get')))
      .all()

    const axiosGet = rows.find((r) => r.firstArg === '/api/users')
    expect(axiosGet).toBeDefined()

    const exprs = axiosGet!.argExpressions as CallArgExpression[] | null
    expect(exprs).not.toBeNull()
    expect(exprs![0].kind).toBe('string')
    expect(exprs![0].value).toBe('/api/users')
    // firstArg 동작 불변
    expect(axiosGet!.firstArg).toBe('/api/users')
  })

  it('ARG-E2E-03: Dart template string → DB에 staticPattern 저장', async () => {
    writeFileSync(join(tmp, 'pubspec.yaml'), 'name: hello\n')
    mkdirSync(join(tmp, 'lib'), { recursive: true })
    writeFileSync(
      join(tmp, 'lib/api.dart'),
      `import 'package:dio/dio.dart' show Dio;
class ApiService {
  final Dio _dio;
  ApiService(this._dio);
  Future<void> getUser(String id) async {
    await _dio.get('/api/users/\$id');
  }
}
`,
    )
    gitInitCommit(tmp)

    const db = createDb()
    const repoId = makeRepo(db, tmp, { language: 'dart' })
    const { completion } = runBuildGraph({ repoId }, db)
    await completion

    const rows = db
      .select()
      .from(codeEdges)
      .where(and(eq(codeEdges.repoId, repoId), eq(codeEdges.targetSymbol, 'get')))
      .all()

    expect(rows.length).toBeGreaterThan(0)
    const dioGet = rows[0]

    const exprs = dioGet.argExpressions as CallArgExpression[] | null
    expect(exprs).not.toBeNull()
    const templateExpr = exprs!.find((e) => e.kind === 'template')
    expect(templateExpr).toBeDefined()
    expect(templateExpr!.staticPattern).toBe('/api/users/:id')
  })
})
