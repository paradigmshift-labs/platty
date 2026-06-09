import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, type DB } from '../../../server/helpers.js'
import { projects, repositories } from '@/db/schema/index.js'
import { codeNodes, codeEdges } from '@/db/schema/code_graph.js'
import { TypeOrmGraphAdapter } from '@/pipeline_modules/build_models/adapters/typeorm.js'

// ─── 상수 ──────────────────────────────────────────────────────────────────────

const PROJ_ID = 'proj_test'
const REPO_ID = 'repo_test'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function seedDb(db: DB, repoPath = '/mock/repo'): void {
  db.insert(projects).values({ id: PROJ_ID, name: 'Test' }).run()
  db.insert(repositories).values({
    id: REPO_ID,
    projectId: PROJ_ID,
    name: 'test-repo',
    repoPath,
  }).run()
}

// 클래스 노드 삽입
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

// 프로퍼티 노드 삽입
function addPropertyNode(db: DB, opts: {
  id: string
  name: string
  filePath?: string
  lineStart?: number
  docComment?: string
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

function addVariableNode(db: DB, opts: {
  id: string
  name: string
  filePath: string
  lineStart?: number
  lineEnd?: number
}): void {
  db.insert(codeNodes).values({
    id: opts.id,
    repoId: REPO_ID,
    type: 'variable',
    name: opts.name,
    filePath: opts.filePath,
    lineStart: opts.lineStart ?? 1,
    lineEnd: opts.lineEnd ?? 20,
    exported: true,
  }).run()
}

// @Entity decorates edge (class가 source, target_symbol='Entity')
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

// @ChildEntity decorates edge
function addChildEntityDecorator(db: DB, classNodeId: string): void {
  db.insert(codeEdges).values({
    repoId: REPO_ID,
    sourceId: classNodeId,
    targetId: null,
    relation: 'decorates',
    targetSymbol: 'ChildEntity',
    firstArg: null,
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

// property decorator edge (property가 source, target_symbol='Column' 등)
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

function addTypeRef(db: DB, propNodeId: string, targetSymbol: string, targetId: string | null = null): void {
  db.insert(codeEdges).values({
    repoId: REPO_ID,
    sourceId: propNodeId,
    targetId,
    relation: 'type_ref',
    targetSymbol,
    firstArg: null,
    resolveStatus: targetId ? 'resolved' : 'pending',
    source: 'static',
  }).run()
}

function addCallEdge(db: DB, sourceId: string, targetSymbol: string): void {
  db.insert(codeEdges).values({
    repoId: REPO_ID,
    sourceId,
    targetId: null,
    relation: 'calls',
    targetSymbol,
    resolveStatus: 'pending',
    source: 'static',
  }).run()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TypeOrmGraphAdapter', () => {
  // TC#1 — @Entity() + @PrimaryGeneratedColumn() + @Column() 기본
  it('TC#1: @Entity() + @PrimaryGeneratedColumn() + @Column() 기본 → ModelRaw 1개, fields 2개', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.id`, name: 'id', lineStart: 5 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.id`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.id`, 'PrimaryGeneratedColumn')

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.name`, name: 'name', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.name`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.name`, 'Column')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    const model = result[0]
    expect(model.name).toBe('User')
    expect(model.fields).toHaveLength(2)
    expect(model.fields.find(f => f.name === 'id')?.primary).toBe(true)
    expect(model.fields.find(f => f.name === 'name')?.primary).toBe(false)
  })

  // TC#2 — @Entity('orders') → table_name='orders'
  it('TC#2: @Entity("orders") → table_name="orders"', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:order.ts:Order`, name: 'Order' })
    addEntityDecorator(db, `${REPO_ID}:order.ts:Order`, "'orders'")

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].table_name).toBe('orders')
  })

  it('TC#2b: build_graph normalized @Entity("orders") first_arg=orders → table_name="orders"', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:order.ts:Order`, name: 'Order' })
    addEntityDecorator(db, `${REPO_ID}:order.ts:Order`, 'orders')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].table_name).toBe('orders')
  })

  // TC#3 — @Entity() → TypeORM DefaultNamingStrategy snake_case fallback
  it('TC#3: @Entity() → User→user, OrderItem→order_item', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addClassNode(db, { id: `${REPO_ID}:order_item.ts:OrderItem`, name: 'OrderItem', filePath: 'order_item.ts' })
    addEntityDecorator(db, `${REPO_ID}:order_item.ts:OrderItem`)

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const user = result.find(m => m.name === 'User')
    const orderItem = result.find(m => m.name === 'OrderItem')
    expect(user?.table_name).toBe('user')
    expect(orderItem?.table_name).toBe('order_item')
  })

  // TC#4 — @Column({ type: 'varchar', nullable: true }) → type='String', nullable=true
  it('TC#4: @Column({ type: "varchar", nullable: true }) → String, nullable=true', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.email`, name: 'email', lineStart: 6 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.email`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.email`, 'Column', '{"type":"varchar","nullable":true}')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'email')!
    expect(field.type).toBe('String')
    expect(field.nullable).toBe(true)
  })

  // TC#5 — @PrimaryGeneratedColumn('uuid') → type='String', primary=true
  it("TC#5: @PrimaryGeneratedColumn('uuid') → String, primary=true", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.id`, name: 'id', lineStart: 5 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.id`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.id`, 'PrimaryGeneratedColumn', "'uuid'")

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'id')!
    expect(field.type).toBe('String')
    expect(field.primary).toBe(true)
  })

  // TC#6 — @ManyToOne + @JoinColumn → manyToOne with fk_fields
  it('TC#6: @ManyToOne + @JoinColumn({ name: "userId" }) → manyToOne, fk_fields=["userId"]', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:order.ts:Order`, name: 'Order' })
    addEntityDecorator(db, `${REPO_ID}:order.ts:Order`)

    addPropertyNode(db, { id: `${REPO_ID}:order.ts:Order.user`, name: 'user', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:order.ts:Order`, `${REPO_ID}:order.ts:Order.user`)
    addPropertyDecorator(db, `${REPO_ID}:order.ts:Order.user`, 'ManyToOne', '() => User')
    addPropertyDecorator(db, `${REPO_ID}:order.ts:Order.user`, 'JoinColumn', '{"name":"userId"}')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'user')!
    expect(rel.type).toBe('manyToOne')
    expect(rel.target_model).toBe('User')
    expect(rel.fk_fields).toEqual(['userId'])
  })

  // TC#7 — @OneToMany → oneToMany, fk_fields=undefined
  it('TC#7: @OneToMany → oneToMany, fk_fields=undefined', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.orders`, name: 'orders', lineStart: 10 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.orders`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.orders`, 'OneToMany', '() => Order')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'orders')!
    expect(rel.type).toBe('oneToMany')
    expect(rel.target_model).toBe('Order')
    expect(rel.fk_fields).toBeUndefined()
  })

  // TC#8 — @OneToOne + @JoinColumn → oneToOne (FK 소유측)
  it('TC#8: @OneToOne + @JoinColumn → oneToOne (FK 소유측)', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.profile`, name: 'profile', lineStart: 12 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.profile`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.profile`, 'OneToOne', '() => Profile')
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.profile`, 'JoinColumn')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'profile')!
    expect(rel.type).toBe('oneToOne')
    expect(rel.target_model).toBe('Profile')
  })

  // TC#9 — @OneToOne (no @JoinColumn) → oneToOne (역방향)
  it('TC#9: @OneToOne (no @JoinColumn) → oneToOne 역방향, fk_fields=undefined', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:profile.ts:Profile`, name: 'Profile' })
    addEntityDecorator(db, `${REPO_ID}:profile.ts:Profile`)

    addPropertyNode(db, { id: `${REPO_ID}:profile.ts:Profile.user`, name: 'user', lineStart: 10 })
    addContainsEdge(db, `${REPO_ID}:profile.ts:Profile`, `${REPO_ID}:profile.ts:Profile.user`)
    addPropertyDecorator(db, `${REPO_ID}:profile.ts:Profile.user`, 'OneToOne', '() => User')
    // @JoinColumn 없음

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'user')!
    expect(rel.type).toBe('oneToOne')
    expect(rel.fk_fields).toBeUndefined()
  })

  // TC#10 — @ManyToMany + @JoinTable → manyToMany (owner)
  it('TC#10: @ManyToMany + @JoinTable → manyToMany (owner)', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:post.ts:Post`, name: 'Post' })
    addEntityDecorator(db, `${REPO_ID}:post.ts:Post`)

    addPropertyNode(db, { id: `${REPO_ID}:post.ts:Post.tags`, name: 'tags', lineStart: 10 })
    addContainsEdge(db, `${REPO_ID}:post.ts:Post`, `${REPO_ID}:post.ts:Post.tags`)
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.tags`, 'ManyToMany', '() => Tag')
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.tags`, 'JoinTable')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'tags')!
    expect(rel.type).toBe('manyToMany')
    expect(rel.target_model).toBe('Tag')
    expect(rel.fk_fields).toBeUndefined()
  })

  // TC#11 — @ManyToMany (no @JoinTable) → manyToMany (inverse)
  it('TC#11: @ManyToMany (no @JoinTable) → manyToMany inverse', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:tag.ts:Tag`, name: 'Tag' })
    addEntityDecorator(db, `${REPO_ID}:tag.ts:Tag`)

    addPropertyNode(db, { id: `${REPO_ID}:tag.ts:Tag.posts`, name: 'posts', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:tag.ts:Tag`, `${REPO_ID}:tag.ts:Tag.posts`)
    addPropertyDecorator(db, `${REPO_ID}:tag.ts:Tag.posts`, 'ManyToMany', '() => Post')
    // @JoinTable 없음

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'posts')!
    expect(rel.type).toBe('manyToMany')
    expect(rel.fk_fields).toBeUndefined()
  })

  // TC#12 — @Entity 없는 일반 class → 결과에 미포함
  it('TC#12: @Entity 없는 class → 결과에 미포함', async () => {
    const db = createTestDb()
    seedDb(db)

    // @Entity 없는 일반 class
    addClassNode(db, { id: `${REPO_ID}:service.ts:UserService`, name: 'UserService' })
    // decorates edge 없음

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(0)
  })

  // TC#13 — @ChildEntity → entity로 포함
  it('TC#13: @ChildEntity → entity로 포함', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:admin.ts:AdminUser`, name: 'AdminUser' })
    addChildEntityDecorator(db, `${REPO_ID}:admin.ts:AdminUser`)

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('AdminUser')
  })

  // TC#14 — @Column 없는 entity → fields=[], 에러 없음
  it('TC#14: @Column 없는 entity → fields=[], relations=[], 에러 없음', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:empty.ts:EmptyEntity`, name: 'EmptyEntity' })
    addEntityDecorator(db, `${REPO_ID}:empty.ts:EmptyEntity`)
    // 프로퍼티 없음

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(0)
    expect(result[0].relations).toHaveLength(0)
  })

  // TC#15 — @CreateDateColumn/@DeleteDateColumn → DateTime, deleteDateColumn→nullable=true
  it('TC#15: @CreateDateColumn → DateTime, @DeleteDateColumn → DateTime + nullable=true', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:post.ts:Post`, name: 'Post' })
    addEntityDecorator(db, `${REPO_ID}:post.ts:Post`)

    addPropertyNode(db, { id: `${REPO_ID}:post.ts:Post.createdAt`, name: 'createdAt', lineStart: 10 })
    addContainsEdge(db, `${REPO_ID}:post.ts:Post`, `${REPO_ID}:post.ts:Post.createdAt`)
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.createdAt`, 'CreateDateColumn')

    addPropertyNode(db, { id: `${REPO_ID}:post.ts:Post.deletedAt`, name: 'deletedAt', lineStart: 12 })
    addContainsEdge(db, `${REPO_ID}:post.ts:Post`, `${REPO_ID}:post.ts:Post.deletedAt`)
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.deletedAt`, 'DeleteDateColumn')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const createdAt = result[0].fields.find(f => f.name === 'createdAt')!
    const deletedAt = result[0].fields.find(f => f.name === 'deletedAt')!
    expect(createdAt.type).toBe('DateTime')
    expect(createdAt.nullable).toBe(false)
    expect(deletedAt.type).toBe('DateTime')
    expect(deletedAt.nullable).toBe(true)
  })

  // TC#16 — @Column({ unique: true }) → unique=true
  it('TC#16: @Column({ unique: true }) → unique=true', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.email`, name: 'email', lineStart: 6 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.email`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.email`, 'Column', '{"unique":true}')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'email')!
    expect(field.unique).toBe(true)
  })

  // TC#17 — first_arg 람다 파싱 실패 → target_model='unknown' + warn
  it('TC#17: 람다 파싱 실패 → target_model="unknown" + 경고 출력', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:post.ts:Post`, name: 'Post' })
    addEntityDecorator(db, `${REPO_ID}:post.ts:Post`)

    addPropertyNode(db, { id: `${REPO_ID}:post.ts:Post.rel`, name: 'rel', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:post.ts:Post`, `${REPO_ID}:post.ts:Post.rel`)
    // 람다 파싱 불가능한 first_arg
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.rel`, 'ManyToOne', 'invalid_lambda_str')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'rel')!
    expect(rel.target_model).toBe('unknown')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('TC#17b: 문자열 relation target → target_model 파싱', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:test.ts:Test`, name: 'Test' })
    addEntityDecorator(db, `${REPO_ID}:test.ts:Test`)

    addPropertyNode(db, { id: `${REPO_ID}:test.ts:Test.project`, name: 'project', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:test.ts:Test`, `${REPO_ID}:test.ts:Test.project`)
    addPropertyDecorator(db, `${REPO_ID}:test.ts:Test.project`, 'ManyToOne', 'Project')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'project')!
    expect(rel.target_model).toBe('Project')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('TC#17c: relation first_arg 누락 시 resolved type_ref target으로 target_model 보완', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:article.ts:Article`, name: 'Article' })
    addEntityDecorator(db, `${REPO_ID}:article.ts:Article`)
    addClassNode(db, { id: `${REPO_ID}:user.ts:UserEntity`, name: 'UserEntity', filePath: 'user.ts' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:UserEntity`, 'user')

    addPropertyNode(db, { id: `${REPO_ID}:article.ts:Article.author`, name: 'author', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:article.ts:Article`, `${REPO_ID}:article.ts:Article.author`)
    addPropertyDecorator(db, `${REPO_ID}:article.ts:Article.author`, 'ManyToOne')
    addTypeRef(db, `${REPO_ID}:article.ts:Article.author`, 'user')
    addTypeRef(db, `${REPO_ID}:article.ts:Article.author`, 'UserEntity')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result.find(m => m.name === 'Article')!.relations.find(r => r.name === 'author')!
    expect(rel.target_model).toBe('UserEntity')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // TC#18 — 같은 entity에 @Column + @OneToMany 동시 존재
  it('TC#18: 같은 entity에 @Column + @OneToMany 각각 정상 분류', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.name`, name: 'name', lineStart: 6 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.name`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.name`, 'Column')

    addPropertyNode(db, { id: `${REPO_ID}:user.ts:User.orders`, name: 'orders', lineStart: 9 })
    addContainsEdge(db, `${REPO_ID}:user.ts:User`, `${REPO_ID}:user.ts:User.orders`)
    addPropertyDecorator(db, `${REPO_ID}:user.ts:User.orders`, 'OneToMany', '() => Order')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].fields).toHaveLength(1)
    expect(result[0].relations).toHaveLength(1)
    expect(result[0].fields[0].name).toBe('name')
    expect(result[0].relations[0].name).toBe('orders')
  })

  // TC#19 — 복수 entity (User, Order, Product)
  it('TC#19: 복수 entity 3개 → ModelRaw 3개', async () => {
    const db = createTestDb()
    seedDb(db)

    for (const name of ['User', 'Order', 'Product']) {
      const id = `${REPO_ID}:${name.toLowerCase()}.ts:${name}`
      addClassNode(db, { id, name, filePath: `${name.toLowerCase()}.ts` })
      addEntityDecorator(db, id)
    }

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(3)
    expect(result.map(m => m.name).sort()).toEqual(['Order', 'Product', 'User'])
  })

  // TC#20 — doc_comment 있는 entity → comment=doc_comment
  it('TC#20: doc_comment 있는 entity → comment=doc_comment 값', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, {
      id: `${REPO_ID}:user.ts:User`,
      name: 'User',
      docComment: '사용자 엔티티',
    })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].comment).toBe('사용자 엔티티')
  })

  // TC#21 — @Entity({ name: 'orders' }) → table_name='orders'
  it("TC#21: @Entity({ name: 'orders' }) JSON 옵션 객체 → table_name='orders'", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:order.ts:Order`, name: 'Order' })
    addEntityDecorator(db, `${REPO_ID}:order.ts:Order`, '{"name":"orders"}')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].table_name).toBe('orders')
  })

  // TC#22 — @Entity({ schema: 'public' }) name 키 없음 → fallback
  it("TC#22: @Entity({ schema: 'public' }) name 키 없음 → snake_case fallback", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:post.ts:Post`, name: 'Post' })
    addEntityDecorator(db, `${REPO_ID}:post.ts:Post`, '{"schema":"public"}')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].table_name).toBe('post')
  })

  // TC#23 — abstract class + @Entity → 포함 (type='class'이면 포함)
  it('TC#23: abstract class + @Entity → entity로 포함', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:base.ts:BaseEntity`, name: 'BaseEntity' })
    addEntityDecorator(db, `${REPO_ID}:base.ts:BaseEntity`)

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('BaseEntity')
  })

  // TC#24 — entity 존재, contains 엣지 없음 → fields=[], relations=[] 정상 반환
  it('TC#24: entity 존재 + contains 엣지 없음 → fields=[], relations=[] (TA-3)', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)
    // contains 엣지 없음

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(0)
    expect(result[0].relations).toHaveLength(0)
  })

  // TC#25 — SQL Injection 시도 → 빈 결과 반환, DB 오염 없음
  it('TC#25: SQL Injection repoId → 빈 결과 반환, DB 오염 없음 (TA-1)', async () => {
    const db = createTestDb()
    seedDb(db)

    // 정상 엔티티 삽입
    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`)

    const maliciousRepoId = "'; DROP TABLE code_nodes; --"

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, maliciousRepoId)

    // 빈 결과 반환
    expect(result).toHaveLength(0)

    // DB가 오염되지 않음 — 원래 노드가 여전히 존재
    const adapter2 = new TypeOrmGraphAdapter()
    const result2 = await adapter2.queryFromGraph(db, REPO_ID)
    expect(result2).toHaveLength(1)
  })

  // TC#26 — build_graph 미완료 (code_nodes 비어있음) → [] 반환
  it('TC#26: code_nodes 비어있음 → [] 반환, throw 없음 (TA-2)', async () => {
    const db = createTestDb()
    seedDb(db)
    // code_nodes에 아무것도 없음

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result).toHaveLength(0)
  })

  // TC#27 — @Entity('') 빈 문자열 → fallback
  it("TC#27: @Entity('') 빈 문자열 first_arg → snake_case fallback (TA-5)", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:user.ts:User`, name: 'User' })
    addEntityDecorator(db, `${REPO_ID}:user.ts:User`, "''")

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    expect(result[0].table_name).toBe('user')
  })

  // TC#28 — @JoinColumn([{ name: 'companyId' }, { name: 'userId' }]) composite FK
  it("TC#28: @JoinColumn 배열 복합 FK → fk_fields=['companyId','userId']", async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:member.ts:Member`, name: 'Member' })
    addEntityDecorator(db, `${REPO_ID}:member.ts:Member`)

    addPropertyNode(db, { id: `${REPO_ID}:member.ts:Member.company`, name: 'company', lineStart: 8 })
    addContainsEdge(db, `${REPO_ID}:member.ts:Member`, `${REPO_ID}:member.ts:Member.company`)
    addPropertyDecorator(db, `${REPO_ID}:member.ts:Member.company`, 'ManyToOne', '() => Company')
    addPropertyDecorator(db, `${REPO_ID}:member.ts:Member.company`, 'JoinColumn', '[{"name":"companyId"},{"name":"userId"}]')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const rel = result[0].relations.find(r => r.name === 'company')!
    expect(rel.fk_fields).toEqual(['companyId', 'userId'])
  })

  // TC#29 — @VersionColumn → type='Int', primary=false, nullable=false
  it('TC#29: @VersionColumn → type="Int", primary=false, nullable=false', async () => {
    const db = createTestDb()
    seedDb(db)

    addClassNode(db, { id: `${REPO_ID}:post.ts:Post`, name: 'Post' })
    addEntityDecorator(db, `${REPO_ID}:post.ts:Post`)

    addPropertyNode(db, { id: `${REPO_ID}:post.ts:Post.version`, name: 'version', lineStart: 15 })
    addContainsEdge(db, `${REPO_ID}:post.ts:Post`, `${REPO_ID}:post.ts:Post.version`)
    addPropertyDecorator(db, `${REPO_ID}:post.ts:Post.version`, 'VersionColumn')

    const adapter = new TypeOrmGraphAdapter()
    const result = await adapter.queryFromGraph(db, REPO_ID)

    const field = result[0].fields.find(f => f.name === 'version')!
    expect(field.type).toBe('Int')
    expect(field.primary).toBe(false)
    expect(field.nullable).toBe(false)
  })

  it('TC#30: EntitySchema 변수 → columns/relations를 source slice에서 추출', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'typeorm-entity-schema-'))
    try {
      const db = createTestDb()
      seedDb(db, repoDir)

      writeFileSync(join(repoDir, 'order.ts'), `import { EntitySchema } from 'typeorm'
export const OrderEntity = new EntitySchema({
  name: "Order",
  tableName: "orders",
  columns: {
    id: { type: Number, primary: true },
    userUuid: { type: "uuid", unique: true }
  },
  relations: {
    user: {
      type: "many-to-one",
      target: () => "User",
      joinColumn: { name: "userUuid" }
    }
  }
})
`)

      const variableId = `${REPO_ID}:order.ts:OrderEntity`
      addVariableNode(db, {
        id: variableId,
        name: 'OrderEntity',
        filePath: 'order.ts',
        lineStart: 2,
        lineEnd: 16,
      })
      addCallEdge(db, variableId, 'EntitySchema')

      const adapter = new TypeOrmGraphAdapter()
      const result = await adapter.queryFromGraph(db, REPO_ID)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Order')
      expect(result[0].table_name).toBe('orders')
      expect(result[0].fields).toEqual([
        expect.objectContaining({ name: 'id', type: 'Float', primary: true }),
        expect.objectContaining({ name: 'userUuid', type: 'String', unique: true }),
      ])
      expect(result[0].relations).toEqual([
        expect.objectContaining({
          name: 'user',
          target_model: 'User',
          type: 'manyToOne',
          fk_fields: ['userUuid'],
        }),
      ])
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})
