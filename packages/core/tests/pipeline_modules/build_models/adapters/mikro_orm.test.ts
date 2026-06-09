import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { MikroOrmGraphAdapter } from '@/pipeline_modules/build_models/adapters/mikro_orm.js'

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const PROJ_ID = 'proj_test'
const REPO_ID = 'repo_test'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function seedDb(db: DB): void {
  db.insert(projects).values({ id: PROJ_ID, name: 'Test' }).run()
  db.insert(repositories).values({
    id: REPO_ID,
    projectId: PROJ_ID,
    name: 'test-repo',
    repoPath: '/mock/repo',
  }).run()
}

function addClassNode(db: DB, opts: {
  id: string
  name: string
  filePath?: string
  lineStart?: number
  lineEnd?: number
  docComment?: string
}): void {
  db.insert(codeNodes).values({
    id: opts.id,
    repoId: REPO_ID,
    type: 'class',
    name: opts.name,
    filePath: opts.filePath ?? 'src/entities/entity.ts',
    lineStart: opts.lineStart ?? 1,
    lineEnd: opts.lineEnd ?? 20,
    docComment: opts.docComment ?? null,
    exported: true,
  }).run()
}

function addPropertyNode(db: DB, opts: {
  id: string
  name: string
  filePath?: string
  lineStart?: number
}): void {
  db.insert(codeNodes).values({
    id: opts.id,
    repoId: REPO_ID,
    type: 'property',
    name: opts.name,
    filePath: opts.filePath ?? 'src/entities/entity.ts',
    lineStart: opts.lineStart ?? 5,
    exported: false,
  }).run()
}

// @Entity decorates edge
function addEntityDecorator(db: DB, classNodeId: string, firstArg: string | null = null): void {
  db.insert(codeEdges).values({
    repoId: REPO_ID,
    sourceId: classNodeId,
    targetId: null,
    relation: 'decorates',
    targetSymbol: 'Entity',
    firstArg,
    resolveStatus: 'resolved',
    source: 'static',
  }).run()
}

// contains edge: class → property
function addContainsEdge(db: DB, classNodeId: string, propNodeId: string): void {
  db.insert(codeEdges).values({
    repoId: REPO_ID,
    sourceId: classNodeId,
    targetId: propNodeId,
    relation: 'contains',
    resolveStatus: 'resolved',
    source: 'static',
  }).run()
}

// property decorator edge
function addPropertyDecorator(db: DB, propNodeId: string, decoratorName: string, firstArg: string | null = null): void {
  db.insert(codeEdges).values({
    repoId: REPO_ID,
    sourceId: propNodeId,
    targetId: null,
    relation: 'decorates',
    targetSymbol: decoratorName,
    firstArg,
    resolveStatus: 'pending',
    source: 'static',
  }).run()
}

function addTypeRefEdge(db: DB, propNodeId: string, targetName: string): void {
  db.insert(codeEdges).values({
    repoId: REPO_ID,
    sourceId: propNodeId,
    targetId: `${REPO_ID}:${targetName.toLowerCase()}.ts:${targetName}`,
    relation: 'type_ref',
    targetSymbol: targetName,
    resolveStatus: 'resolved',
    source: 'static',
  }).run()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MikroOrmGraphAdapter', () => {
  // TC#1 — @Entity() + @PrimaryKey() + @Property() 기본
  it('TC#1: @Entity() + @PrimaryKey() + @Property() → ModelRaw 1개, fields 2개', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.id`, name: 'id', lineStart: 5 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.id`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.id`, 'PrimaryKey')

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.name`, name: 'name', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.name`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.name`, 'Property')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    const model = result[0]
    expect(model.name).toBe('User')
    expect(model.fields).toHaveLength(2)
    expect(model.fields.find(f => f.name === 'id')?.primary).toBe(true)
    expect(model.fields.find(f => f.name === 'name')?.primary).toBe(false)
  })

  // TC#2 — @Entity({ tableName: 'orders' }) → table_name='orders'
  it('TC#2: @Entity({ tableName: "orders" }) → table_name="orders"', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:order.ts:Order`, name: 'Order' })
    addEntityDecorator(db, `${REPO_ID}:order.ts:Order`, '{"tableName":"orders"}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].table_name).toBe('orders')
  })

  // TC#3 — @Entity({ collection: 'users' }) MongoDB용 → table_name='users'
  it('TC#3: @Entity({ collection: "users" }) MongoDB용 → table_name="users"', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`, '{"collection":"users"}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].table_name).toBe('users')
  })

  // TC#4 — @Entity() → toSnakeCasePlural fallback
  it('TC#4: @Entity() → User→users, OrderItem→order_items fallback', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addClassNode(db, { id: `${REPO_ID}:order_item.ts:OrderItem`, name: 'OrderItem', filePath: 'order_item.ts' })
    addEntityDecorator(db, `${REPO_ID}:order_item.ts:OrderItem`)

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const user = result.find(m => m.name === 'User')
    const orderItem = result.find(m => m.name === 'OrderItem')
    expect(user?.table_name).toBe('users')
    expect(orderItem?.table_name).toBe('order_items')
  })

  // TC#5 — @Property({ type: 'varchar', nullable: true }) → String, nullable=true
  it('TC#5: @Property({ type: "varchar", nullable: true }) → String, nullable=true', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.email`, name: 'email', lineStart: 6 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.email`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.email`, 'Property', '{"type":"varchar","nullable":true}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'email')!
    expect(field.type).toBe('String')
    expect(field.nullable).toBe(true)
  })

  // TC#6 — @PrimaryKey() → primary=true, nullable=false
  it('TC#6: @PrimaryKey() → primary=true, nullable=false', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.id`, name: 'id', lineStart: 5 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.id`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.id`, 'PrimaryKey')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'id')!
    expect(field.primary).toBe(true)
    expect(field.nullable).toBe(false)
  })

  // TC#7 — @Enum() → type='String'
  it('TC#7: @Enum() → type="String"', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.role`, name: 'role', lineStart: 9 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.role`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.role`, 'Enum')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'role')!
    expect(field.type).toBe('String')
    expect(field.primary).toBe(false)
  })

  // TC#8 — @SerializedPrimaryKey() → type='String', primary=false
  it('TC#8: @SerializedPrimaryKey() → type="String", primary=false (내부용)', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User._id`, name: '_id', lineStart: 5 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User._id`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User._id`, 'SerializedPrimaryKey')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === '_id')!
    expect(field.type).toBe('String')
    expect(field.primary).toBe(false)
  })

  // TC#9 — @ManyToOne → manyToOne, target 추출
  it('TC#9: @ManyToOne(() => User) → manyToOne, target_model="User"', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:order.ts:Order`, name: 'Order' })
    addEntityDecorator(db, `${REPO_ID}:order.ts:Order`)

    addPropertyNode(db, { id: `${REPO_ID}:order.ts:Order.user`, name: 'user', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:order.ts:Order`, `${REPO_ID}:order.ts:Order.user`)
    addPropertyDecorator(db, `${REPO_ID}:order.ts:Order.user`, 'ManyToOne', '() => User')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'user')!
    expect(rel.type).toBe('manyToOne')
    expect(rel.target_model).toBe('User')
    // MikroORM은 @JoinColumn 없어도 manyToOne 쪽이 FK 소유 — fk_fields는 없음
    expect(rel.fk_fields).toBeUndefined()
  })

  // TC#10 — @OneToMany → oneToMany
  it('TC#10: @OneToMany(() => Post, ...) → oneToMany', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.posts`, name: 'posts', lineStart: 10 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.posts`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.posts`, 'OneToMany', '() => Post')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'posts')!
    expect(rel.type).toBe('oneToMany')
    expect(rel.target_model).toBe('Post')
    expect(rel.fk_fields).toBeUndefined()
  })

  // TC#11 — @OneToOne → oneToOne
  it('TC#11: @OneToOne(() => Profile) → oneToOne', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.profile`, name: 'profile', lineStart: 12 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.profile`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.profile`, 'OneToOne', '() => Profile')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'profile')!
    expect(rel.type).toBe('oneToOne')
    expect(rel.target_model).toBe('Profile')
  })

  // TC#12 — @ManyToMany → manyToMany
  it('TC#12: @ManyToMany(() => Tag) → manyToMany', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:post.ts:Post`, name: 'Post' })
    addEntityDecorator(db, `${REPO_ID}:post.ts:Post`)

    addPropertyNode(db, { id: `${REPO_ID}:post.ts:Post.tags`, name: 'tags', lineStart: 10 })
    addContainsEdge(db, `${REPO_ID}:post.ts:Post`, `${REPO_ID}:post.ts:Post.tags`)
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.tags`, 'ManyToMany', '() => Tag')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'tags')!
    expect(rel.type).toBe('manyToMany')
    expect(rel.target_model).toBe('Tag')
    expect(rel.fk_fields).toBeUndefined()
  })

  // TC#13 — @Entity 없는 일반 class → 결과에 미포함
  it('TC#13: @Entity 없는 class → 결과에 미포함', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:service.ts:UserService`, name: 'UserService' })
    // decorates edge 없음

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(0)
  })

  // TC#14 — 빈 엔티티 → fields=[], relations=[]
  it('TC#14: @Entity() 빈 엔티티 → fields=[], relations=[], 에러 없음', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:empty.ts:EmptyEntity`, name: 'EmptyEntity' })
    addEntityDecorator(db, `${REPO_ID}:empty.ts:EmptyEntity`)
    // 프로퍼티 없음

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(0)
    expect(result[0].relations).toHaveLength(0)
  })

  // TC#15 — 복수 entity (User, Order, Product) → 3개
  it('TC#15: 복수 entity 3개 → ModelRaw 3개', async () => {
    const db = createTestDb()
    seedDb(db)

    for (const name of ['User', 'Order', 'Product']) {
      const id = `${REPO_ID}:${name.toLowerCase()}.ts:${name}`
      addClassNode(db, { id, name, filePath: `${name.toLowerCase()}.ts` })
      addEntityDecorator(db, id)
    }

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(3)
    expect(result.map(m => m.name).sort()).toEqual(['Order', 'Product', 'User'])
  })

  // TC#16 — @Property({ unique: true }) → unique=true
  it('TC#16: @Property({ unique: true }) → unique=true', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.email`, name: 'email', lineStart: 6 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.email`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.email`, 'Property', '{"unique":true}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'email')!
    expect(field.unique).toBe(true)
  })

  // TC#17 — @Property({ default: 'active' }) → default='active'
  it("TC#17: @Property({ default: 'active' }) → default='active'", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.status`, name: 'status', lineStart: 10 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.status`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.status`, 'Property', '{"default":"active"}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'status')!
    expect(field.default).toBe('active')
  })

  // TC#18 — doc_comment 있는 entity → comment=doc_comment
  it('TC#18: doc_comment 있는 entity → comment=doc_comment 값', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, {
      id: `${REPO_ID}:user.ts:User`,
      name: 'User',
      docComment: '사용자 엔티티',
    })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].comment).toBe('사용자 엔티티')
  })

  // TC#19 — 람다 파싱 실패 → target_model='unknown' + 경고
  it('TC#19: 람다 파싱 실패 → target_model="unknown" + 경고 출력', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:post.ts:Post`, name: 'Post' })
    addEntityDecorator(db, `${REPO_ID}:post.ts:Post`)

    addPropertyNode(db, { id: `${REPO_ID}:post.ts:Post.rel`, name: 'rel', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:post.ts:Post`, `${REPO_ID}:post.ts:Post.rel`)
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.rel`, 'ManyToOne', 'invalid_lambda_str')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'rel')!
    expect(rel.target_model).toBe('unknown')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // TC#20 — 같은 entity에 @Property + @ManyToOne 각각 정상 분류
  it('TC#20: 같은 entity에 @Property + @ManyToOne 각각 정상 분류', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.name`, name: 'name', lineStart: 6 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.name`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.name`, 'Property')

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.team`, name: 'team', lineStart: 9 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.team`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.team`, 'ManyToOne', '() => Team')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].fields).toHaveLength(1)
    expect(result[0].relations).toHaveLength(1)
    expect(result[0].fields[0].name).toBe('name')
    expect(result[0].relations[0].name).toBe('team')
  })

  // TC#21 — SQL Injection repoId → 빈 결과, DB 오염 없음
  it('TC#21: SQL Injection repoId → 빈 결과 반환, DB 오염 없음', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    const maliciousRepoId = "'; DROP TABLE code_nodes; --"

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, maliciousRepoId)

    expect(result).toHaveLength(0)

    const adapter2 = new MikroOrmGraphAdapter()
    const result2 = await adapter2.queryFromGraph(db, REPO_ID)
    expect(result2).toHaveLength(1)
  })

  // TC#22 — code_nodes 비어있음 → [] 반환, throw 없음
  it('TC#22: code_nodes 비어있음 → [] 반환, throw 없음', async () => {
    const db = createTestDb()
    seedDb(db)

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(0)
  })

  // TC#23 — entity 존재 + contains 엣지 없음 → fields=[], relations=[]
  it('TC#23: entity 존재 + contains 엣지 없음 → fields=[], relations=[]', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)
    // contains 엣지 없음

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(0)
    expect(result[0].relations).toHaveLength(0)
  })

  // TC#24 — @Entity({ tableName: '' }) 빈 문자열 → fallback
  it("TC#24: @Entity({ tableName: '' }) 빈 문자열 → toSnakeCasePlural fallback", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`, '{"tableName":""}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].table_name).toBe('users')
  })

  // TC#25 — orm / strategy 속성 확인
  it('TC#25: orm="mikro-orm", strategy="graph-query" 확인', () => {
    const adapter = new MikroOrmGraphAdapter()
    expect(adapter.orm).toBe('mikro-orm')
    expect(adapter.strategy).toBe('graph-query')
  })

  // TC#26 — @Property({ type: 'text' }) → type='String'
  it("TC#26: @Property({ type: 'text' }) → type='String'", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:post.ts:Post`, name: 'Post' })
    addEntityDecorator(db, `${REPO_ID}:post.ts:Post`)

    addPropertyNode(db, { id: `${REPO_ID}:post.ts:Post.body`, name: 'body', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:post.ts:Post`, `${REPO_ID}:post.ts:Post.body`)
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.body`, 'Property', '{"type":"text"}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'body')!
    expect(field.type).toBe('String')
  })

  // TC#27 — @Property({ type: 'boolean' }) → type='Boolean'
  it("TC#27: @Property({ type: 'boolean' }) → type='Boolean'", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.active`, name: 'active', lineStart: 10 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.active`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.active`, 'Property', '{"type":"boolean"}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'active')!
    expect(field.type).toBe('Boolean')
  })

  // TC#28 — @OneToMany inverse 측 람다 2개 인자 → target 정상 추출
  it('TC#28: @OneToMany(() => Post, post => post.user) → target_model="Post"', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.posts`, name: 'posts', lineStart: 11 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.posts`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.posts`, 'OneToMany', '() => Post')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'posts')!
    expect(rel.target_model).toBe('Post')
    expect(rel.type).toBe('oneToMany')
  })

  // TC#29 — @PrimaryKey + @Property 함께 있는 entity → fields에 모두 포함
  it('TC#29: @PrimaryKey + @Property 혼합 entity → fields 정상 파싱', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:article.ts:Article`, name: 'Article' })
    addEntityDecorator(db, `${REPO_ID}:article.ts:Article`)

    addPropertyNode(db, { id: `${REPO_ID}:article.ts:Article.id`, name: 'id', lineStart: 5 })
    addContainsEdge(db, `${REPO_ID}:article.ts:Article`, `${REPO_ID}:article.ts:Article.id`)
    addPropertyDecorator(db, `${REPO_ID}:article.ts:Article.id`, 'PrimaryKey')

    addPropertyNode(db, { id: `${REPO_ID}:article.ts:Article.title`, name: 'title', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:article.ts:Article`, `${REPO_ID}:article.ts:Article.title`)
    addPropertyDecorator(db, `${REPO_ID}:article.ts:Article.title`, 'Property', '{"type":"varchar"}')

    addPropertyNode(db, { id: `${REPO_ID}:article.ts:Article.published`, name: 'published', lineStart: 11 })
    addContainsEdge(db, `${REPO_ID}:article.ts:Article`, `${REPO_ID}:article.ts:Article.published`)
    addPropertyDecorator(db, `${REPO_ID}:article.ts:Article.published`, 'Property', '{"type":"boolean","nullable":true}')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(3)

    const id = result[0].fields.find(f => f.name === 'id')!
    expect(id.primary).toBe(true)
    expect(id.nullable).toBe(false)

    const title = result[0].fields.find(f => f.name === 'title')!
    expect(title.type).toBe('String')
    expect(title.primary).toBe(false)

    const published = result[0].fields.find(f => f.name === 'published')!
    expect(published.type).toBe('Boolean')
    expect(published.nullable).toBe(true)
  })

  it('TC#30: relation decorator first_arg 누락 시 resolved type_ref target 사용', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:book.ts:Book`, name: 'Book' })
    addEntityDecorator(db, `${REPO_ID}:book.ts:Book`)

    addPropertyNode(db, { id: `${REPO_ID}:book.ts:Book.author`, name: 'author', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:book.ts:Book`, `${REPO_ID}:book.ts:Book.author`)
    addPropertyDecorator(db, `${REPO_ID}:book.ts:Book.author`, 'ManyToOne')
    addTypeRefEdge(db, `${REPO_ID}:book.ts:Book.author`, 'Author')

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'author')!
    expect(rel.type).toBe('manyToOne')
    expect(rel.target_model).toBe('Author')
  })

  it('TC#31: defineEntity JavaScript schemas produce fields and relations', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'sdd-mikro-define-entity-'))
    mkdirSync(join(repoPath, 'app/entities'), { recursive: true })
    writeFileSync(
      join(repoPath, 'app/entities/Author.js'),
      `
        import { defineEntity, p } from '@mikro-orm/core';
        import { Book } from './Book.js';

        export const AuthorSchema = defineEntity({
          name: 'Author',
          properties: {
            name: p.string(),
            email: p.string().unique(),
            age: p.integer().nullable(),
            books: () => p.oneToMany(Book).mappedBy('author'),
          },
        });
      `,
      'utf-8',
    )

    const db = createTestDb()
    seedDb(db)
    db.update(repositories).set({ repoPath }).run()

    const adapter = new MikroOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Author')
    expect(result[0].table_name).toBe('authors')
    expect(result[0].source_file).toBe('app/entities/Author.js')
    expect(result[0].fields.map(f => f.name).sort()).toEqual(['age', 'email', 'name'])
    expect(result[0].fields.find(f => f.name === 'email')?.unique).toBe(true)
    expect(result[0].fields.find(f => f.name === 'age')?.nullable).toBe(true)
    expect(result[0].relations).toEqual([
      expect.objectContaining({ name: 'books', target_model: 'Book', type: 'oneToMany' }),
    ])
  })
})
