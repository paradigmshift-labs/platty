/**
 * 카테고리 I — Drizzle ORM (코드 내장 schema 정의)
 *
 * `pgTable('users', { id: serial(), ... })` 같은 schema 정의 패턴.
 * Drizzle은 entity 정의를 변수로 export — table 변수 + column 정의가 객체 리터럴.
 */
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/schema.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('I. Drizzle ORM 정의', () => {
  it("I-01: pgTable('users', {...}) — table 정의", () => {
    const r = parse(`
      import { pgTable, serial, text } from 'drizzle-orm/pg-core'
      export const users = pgTable('users', {
        id: serial('id').primaryKey(),
        name: text('name').notNull(),
      })
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'pgTable')
    expect(e).toBeDefined()
    expect(e!.first_arg).toBe('users')
  })

  it('I-02: column chain — serial("id").primaryKey()', () => {
    const r = parse(`
      import { pgTable, serial } from 'drizzle-orm/pg-core'
      export const users = pgTable('users', { id: serial('id').primaryKey() })
    `)
    const serialCall = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'serial')
    expect(serialCall).toBeDefined()
    expect(serialCall!.first_arg).toBe('id')
    // primaryKey()는 chain method 호출 (BS-10) → calls edge 잡힘
    const pk = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'primaryKey')
    expect(pk).toBeDefined()
  })

  it('I-03: relations() 정의 — 외부 참조', () => {
    const r = parse(`
      import { relations } from 'drizzle-orm'
      import { users } from './users'
      import { posts } from './posts'
      export const usersRelations = relations(users, ({ many }) => ({
        posts: many(posts),
      }))
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'relations')
    expect(e).toBeDefined()
  })

  it('I-04: drizzle(client, { schema }) — db client 생성', () => {
    const r = parse(`
      import { drizzle } from 'drizzle-orm/node-postgres'
      import { Pool } from 'pg'
      import * as schema from './schema'
      const pool = new Pool({ connectionString: process.env.DATABASE_URL })
      export const db = drizzle(pool, { schema })
    `)
    const e = r.edges.find((edge) => edge.relation === 'calls' && edge.target_symbol === 'drizzle')
    expect(e).toBeDefined()
    expect(e!.target_specifier).toBe('drizzle-orm/node-postgres')
  })

  it('I-05: query builder chain — db.select().from().where()', () => {
    const r = parse(`
      import { db } from './db'
      import { users } from './schema'
      import { eq } from 'drizzle-orm'
      export async function findUser(id: number) {
        return db.select().from(users).where(eq(users.id, id))
      }
    `)
    const select = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'select')
    const from = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'from')
    const where = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'where')
    expect(select).toBeDefined()
    expect(from).toBeDefined()
    expect(where).toBeDefined()
  })

  it('I-06: insert chain — db.insert(users).values({...}).returning()', () => {
    const r = parse(`
      import { db } from './db'
      import { users } from './schema'
      export async function create(data: any) {
        return db.insert(users).values({ name: 'tom' }).returning()
      }
    `)
    const insert = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'insert')
    const values = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'values')
    const returning = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'returning')
    expect(insert).toBeDefined()
    expect(values).toBeDefined()
    expect(values!.literal_args).toBe(JSON.stringify([{ name: 'tom' }]))
    expect(returning).toBeDefined()
  })

  it('I-07: update().set().where()', () => {
    const r = parse(`
      import { db } from './db'
      import { users } from './schema'
      import { eq } from 'drizzle-orm'
      export async function rename(id: number, name: string) {
        return db.update(users).set({ name }).where(eq(users.id, id))
      }
    `)
    const update = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'update')
    const set = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'set')
    expect(update).toBeDefined()
    expect(set).toBeDefined()
  })

  it('I-08: delete().where()', () => {
    const r = parse(`
      import { db } from './db'
      import { users } from './schema'
      import { eq } from 'drizzle-orm'
      export async function remove(id: number) {
        return db.delete(users).where(eq(users.id, id))
      }
    `)
    const del = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'delete')
    expect(del).toBeDefined()
  })

  it('I-09: transaction 패턴 — db.transaction(async (tx) => ...)', () => {
    const r = parse(`
      import { db } from './db'
      export async function move(fromId: number, toId: number) {
        return db.transaction(async (tx) => {
          await tx.update(/* ... */)
        })
      }
    `)
    const tx = r.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'transaction')
    expect(tx).toBeDefined()
  })

  it('I-10: 다양한 column 타입 정의 — varchar/integer/timestamp/json', () => {
    const r = parse(`
      import { pgTable, varchar, integer, timestamp, json } from 'drizzle-orm/pg-core'
      export const events = pgTable('events', {
        id: varchar('id', { length: 36 }).primaryKey(),
        count: integer('count').notNull(),
        createdAt: timestamp('created_at').defaultNow(),
        meta: json('meta').$type<Record<string, unknown>>(),
      })
    `)
    const calls = r.edges
      .filter((e) => e.relation === 'calls')
      .map((e) => e.target_symbol)
      .sort()
    expect(calls).toContain('pgTable')
    expect(calls).toContain('varchar')
    expect(calls).toContain('integer')
    expect(calls).toContain('timestamp')
    expect(calls).toContain('json')
    expect(calls).toContain('primaryKey')
    expect(calls).toContain('notNull')
    expect(calls).toContain('defaultNow')
  })
})
