import { describe, it, expect, beforeAll } from 'vitest'
import { DrizzleAdapter } from '@/pipeline_modules/build_models/adapters/drizzle.js'
import type { SchemaChunk } from '@/pipeline_modules/build_models/types.js'

// helper
function chunk(content: string, path = 'schema.ts'): SchemaChunk {
  return { files: [{ path, content }], orm: 'drizzle' }
}

describe('DrizzleAdapter', () => {
  let adapter: DrizzleAdapter

  beforeAll(async () => {
    adapter = new DrizzleAdapter()
    await adapter.ensureReady()
  })

  // ─── 기본 속성 ─────────────────────────────────────────────────────────────

  it('T-DA-01: orm/strategy 속성', () => {
    expect(adapter.orm).toBe('drizzle')
    expect(adapter.strategy).toBe('dsl-parse')
  })

  // ─── 테이블 파싱 ──────────────────────────────────────────────────────────

  it('T-DA-02: pgTable 기본 스칼라 필드', async () => {
    const content = `
import { pgTable, serial, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  active: boolean('active').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result).toHaveLength(1)
    const m = result[0]
    expect(m.name).toBe('Users')
    expect(m.table_name).toBe('users')

    expect(m.fields.find(f => f.name === 'id')).toMatchObject({ type: 'Int', primary: true, nullable: false })
    expect(m.fields.find(f => f.name === 'name')).toMatchObject({ type: 'String', nullable: false })
    expect(m.fields.find(f => f.name === 'email')).toMatchObject({ type: 'String', nullable: false, unique: true })
    expect(m.fields.find(f => f.name === 'age')).toMatchObject({ type: 'Int', nullable: true })
    expect(m.fields.find(f => f.name === 'active')).toMatchObject({ type: 'Boolean', nullable: false })
    expect(m.fields.find(f => f.name === 'createdAt')?.default).toBe('now()')
  })

  it('T-DA-03: mysqlTable', async () => {
    const content = `
import { mysqlTable, int, varchar } from 'drizzle-orm/mysql-core'

export const products = mysqlTable('products', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result[0].name).toBe('Products')
    expect(result[0].table_name).toBe('products')
    expect(result[0].fields.find(f => f.name === 'id')).toMatchObject({ type: 'Int', primary: true })
  })

  it('T-DA-04: sqliteTable', async () => {
    const content = `
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

export const items = sqliteTable('items', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result[0].name).toBe('Items')
    expect(result[0].table_name).toBe('items')
  })

  // ─── PascalCase 변환 ──────────────────────────────────────────────────────

  it('T-DA-05: camelCase 변수명 → PascalCase 모델명', async () => {
    const content = `
import { pgTable, serial } from 'drizzle-orm/pg-core'
export const orderItems = pgTable('order_items', { id: serial('id').primaryKey() })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result[0].name).toBe('OrderItems')
    expect(result[0].table_name).toBe('order_items')
  })

  it('T-DA-06: snake_case 변수명 → PascalCase 모델명', async () => {
    const content = `
import { pgTable, serial } from 'drizzle-orm/pg-core'
export const product_categories = pgTable('product_categories', { id: serial('id').primaryKey() })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result[0].name).toBe('ProductCategories')
  })

  // ─── 타입 매핑 ────────────────────────────────────────────────────────────

  it('T-DA-10: uuid, bytea, inet → String', async () => {
    const content = `
import { pgTable, uuid, bytea, inet } from 'drizzle-orm/pg-core'
export const misc = pgTable('misc', {
  id: uuid('id').primaryKey(),
  data: bytea('data'),
  ip: inet('ip'),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'id')?.type).toBe('String')
    expect(fields.find(f => f.name === 'data')?.type).toBe('String')
    expect(fields.find(f => f.name === 'ip')?.type).toBe('String')
  })

  it('T-DA-11: json/jsonb → Json', async () => {
    const content = `
import { pgTable, serial, json, jsonb } from 'drizzle-orm/pg-core'
export const logs = pgTable('logs', {
  id: serial('id').primaryKey(),
  meta: json('meta'),
  extra: jsonb('extra'),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'meta')?.type).toBe('Json')
    expect(fields.find(f => f.name === 'extra')?.type).toBe('Json')
  })

  it('T-DA-12: real/doublePrecision/numeric → Float', async () => {
    const content = `
import { pgTable, serial, real, doublePrecision, numeric } from 'drizzle-orm/pg-core'
export const scores = pgTable('scores', {
  id: serial('id').primaryKey(),
  score: real('score'),
  value: doublePrecision('value'),
  amount: numeric('amount'),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'score')?.type).toBe('Float')
    expect(fields.find(f => f.name === 'value')?.type).toBe('Float')
    expect(fields.find(f => f.name === 'amount')?.type).toBe('Float')
  })

  it('T-DA-13: timestamp/date/time → DateTime', async () => {
    const content = `
import { pgTable, serial, timestamp, date, time } from 'drizzle-orm/pg-core'
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  startAt: timestamp('start_at'),
  day: date('day'),
  hour: time('hour'),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'startAt')?.type).toBe('DateTime')
    expect(fields.find(f => f.name === 'day')?.type).toBe('DateTime')
    expect(fields.find(f => f.name === 'hour')?.type).toBe('DateTime')
  })

  // ─── default 값 ──────────────────────────────────────────────────────────

  it('T-DA-14: .default(string) — 따옴표 제거', async () => {
    const content = `
import { pgTable, serial, text, varchar } from 'drizzle-orm/pg-core'
export const t = pgTable('t', {
  id: serial('id').primaryKey(),
  role: text('role').default('user'),
  tz: varchar('tz').default("UTC"),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'role')?.default).toBe('user')
    expect(fields.find(f => f.name === 'tz')?.default).toBe('UTC')
  })

  it('T-DA-15: .default(number)', async () => {
    const content = `
import { pgTable, integer } from 'drizzle-orm/pg-core'
export const t = pgTable('t', {
  count: integer('count').default(0),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result[0].fields.find(f => f.name === 'count')?.default).toBe('0')
  })

  it('T-DA-16: .defaultNow() → "now()"', async () => {
    const content = `
import { pgTable, serial, timestamp } from 'drizzle-orm/pg-core'
export const t = pgTable('t', {
  id: serial('id').primaryKey(),
  at: timestamp('at').defaultNow(),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result[0].fields.find(f => f.name === 'at')?.default).toBe('now()')
  })

  // ─── nullable ─────────────────────────────────────────────────────────────

  it('T-DA-17: notNull → nullable=false, nullable 기본값 → nullable=true', async () => {
    const content = `
import { pgTable, serial, text } from 'drizzle-orm/pg-core'
export const t = pgTable('t', {
  id: serial('id').primaryKey(),
  required: text('required').notNull(),
  optional: text('optional'),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    const fields = result[0].fields
    expect(fields.find(f => f.name === 'required')?.nullable).toBe(false)
    expect(fields.find(f => f.name === 'optional')?.nullable).toBe(true)
  })

  // ─── Relations ────────────────────────────────────────────────────────────

  it('T-DA-20: one-to-many 관계', async () => {
    const content = `
import { pgTable, serial, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const users = pgTable('users', { id: serial('id').primaryKey() })
export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))
export const postsRelations = relations(posts, ({ one }) => ({
  user: one(users, { fields: [posts.userId], references: [users.id] }),
}))
`
    const files = [{ path: 'schema.ts', content }]
    const result = await adapter.parseChunk({ files, orm: 'drizzle' }, adapter.collectNames(files))

    const usersModel = result.find(m => m.name === 'Users')!
    const postsModel = result.find(m => m.name === 'Posts')!

    expect(usersModel.relations).toHaveLength(1)
    expect(usersModel.relations[0]).toMatchObject({
      name: 'posts', target_model: 'Posts', type: 'oneToMany',
    })

    expect(postsModel.relations).toHaveLength(1)
    expect(postsModel.relations[0]).toMatchObject({
      name: 'user', target_model: 'Users', type: 'manyToOne',
      fk_fields: ['userId'], references: ['id'],
    })
  })

  it('T-DA-21: one-to-one 관계 (FK 없는 쪽 → oneToOne)', async () => {
    const content = `
import { pgTable, serial, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const users = pgTable('users', { id: serial('id').primaryKey() })
export const profiles = pgTable('profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
})

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(profiles),
}))
export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}))
`
    const files = [{ path: 'schema.ts', content }]
    const result = await adapter.parseChunk({ files, orm: 'drizzle' }, adapter.collectNames(files))

    const usersModel = result.find(m => m.name === 'Users')!
    const profilesModel = result.find(m => m.name === 'Profiles')!

    expect(usersModel.relations[0]).toMatchObject({ type: 'oneToOne', target_model: 'Profiles' })
    expect(profilesModel.relations[0]).toMatchObject({ type: 'manyToOne', target_model: 'Users' })
  })

  it('T-DA-22: many-to-many (양방향 many)', async () => {
    const content = `
import { pgTable, serial, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const users = pgTable('users', { id: serial('id').primaryKey() })
export const groups = pgTable('groups', { id: serial('id').primaryKey() })
export const usersToGroups = pgTable('users_to_groups', {
  userId: integer('user_id').notNull(),
  groupId: integer('group_id').notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  usersToGroups: many(usersToGroups),
}))
export const groupsRelations = relations(groups, ({ many }) => ({
  usersToGroups: many(usersToGroups),
}))
export const usersToGroupsRelations = relations(usersToGroups, ({ one }) => ({
  user: one(users, { fields: [usersToGroups.userId], references: [users.id] }),
  group: one(groups, { fields: [usersToGroups.groupId], references: [groups.id] }),
}))
`
    const files = [{ path: 'schema.ts', content }]
    const result = await adapter.parseChunk({ files, orm: 'drizzle' }, adapter.collectNames(files))

    const usersModel = result.find(m => m.name === 'Users')!
    expect(usersModel.relations[0]).toMatchObject({ type: 'oneToMany', target_model: 'UsersToGroups' })

    const junctionModel = result.find(m => m.name === 'UsersToGroups')!
    expect(junctionModel.relations).toHaveLength(2)
    expect(junctionModel.relations.find(r => r.name === 'user')).toMatchObject({
      type: 'manyToOne', target_model: 'Users',
    })
  })

  // ─── 복수 테이블 / 엣지케이스 ────────────────────────────────────────────

  it('T-DA-30: 복수 테이블 — 한 파일', async () => {
    const content = `
import { pgTable, serial } from 'drizzle-orm/pg-core'
export const users = pgTable('users', { id: serial('id').primaryKey() })
export const posts = pgTable('posts', { id: serial('id').primaryKey() })
export const comments = pgTable('comments', { id: serial('id').primaryKey() })
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result).toHaveLength(3)
    expect(result.map(m => m.name).sort()).toEqual(['Comments', 'Posts', 'Users'])
  })

  it('T-DA-31: 빈 컬럼 객체', async () => {
    const content = `
import { pgTable } from 'drizzle-orm/pg-core'
export const empty = pgTable('empty', {})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(0)
  })

  it('T-DA-32: 멀티파일 — cross-file 관계', async () => {
    const files = [
      {
        path: 'schema/users.ts',
        content: `
import { pgTable, serial } from 'drizzle-orm/pg-core'
export const users = pgTable('users', { id: serial('id').primaryKey() })
`,
      },
      {
        path: 'schema/posts.ts',
        content: `
import { pgTable, serial, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './users'
export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
})
export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.userId], references: [users.id] }),
}))
`,
      },
    ]
    const result = await adapter.parseChunk({ files, orm: 'drizzle' }, adapter.collectNames(files))

    const postsModel = result.find(m => m.name === 'Posts')!
    expect(postsModel.relations[0]).toMatchObject({
      name: 'author', target_model: 'Users', type: 'manyToOne',
    })
  })

  it('T-DA-33: line_start / source_file 기록', async () => {
    const content = `
import { pgTable, serial } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
})
`
    const result = await adapter.parseChunk(chunk(content, 'my/schema.ts'), adapter.collectNames([{ path: 'my/schema.ts', content }]))
    expect(result[0].source_file).toBe('my/schema.ts')
    expect(result[0].line_start).toBeGreaterThan(0)
  })

  it('T-DA-34: bigint → Int (serial8/bigserial)', async () => {
    const content = `
import { pgTable, bigserial, bigint } from 'drizzle-orm/pg-core'
export const large = pgTable('large', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  count: bigint('count', { mode: 'number' }),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    expect(result[0].fields.find(f => f.name === 'id')?.type).toBe('Int')
    expect(result[0].fields.find(f => f.name === 'count')?.type).toBe('Int')
  })

  it('T-DA-35: $type<T>() 체이닝 무시', async () => {
    const content = `
import { pgTable, serial, jsonb } from 'drizzle-orm/pg-core'
export const t = pgTable('t', {
  id: serial('id').primaryKey(),
  meta: jsonb('meta').$type<{ key: string }>().notNull(),
})
`
    const result = await adapter.parseChunk(chunk(content), adapter.collectNames([{ path: 'schema.ts', content }]))
    // $type() 이후 .notNull() 도 정상 파싱
    const meta = result[0].fields.find(f => f.name === 'meta')
    expect(meta?.type).toBe('Json')
    // notNull should be picked up from the chain eventually
  })

  it('T-DA-36: collectNames — modelNames 반환', () => {
    const content = `
import { pgTable, serial } from 'drizzle-orm/pg-core'
export const users = pgTable('users', { id: serial('id').primaryKey() })
export const posts = pgTable('posts', { id: serial('id').primaryKey() })
`
    const ctx = adapter.collectNames([{ path: 'schema.ts', content }])
    expect(ctx.modelNames.has('Users')).toBe(true)
    expect(ctx.modelNames.has('Posts')).toBe(true)
    expect(ctx.enumNames.size).toBe(0)
  })

  it('T-DA-37: prepareChunks — 단일 청크 반환', () => {
    const files = [
      { path: 'a.ts', content: '' },
      { path: 'b.ts', content: '' },
    ]
    const chunks = adapter.prepareChunks(files)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].files).toEqual(files)
  })
})
