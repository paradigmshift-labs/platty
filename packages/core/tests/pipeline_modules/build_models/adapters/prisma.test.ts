import { describe, it, expect, vi, beforeAll } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PrismaAdapter } from '@/pipeline_modules/build_models/adapters/prisma.js'
import type { SchemaFile, SchemaChunk, ParseContext, ModelField, ModelRelation, ModelRaw } from '@/pipeline_modules/build_models/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── 초기화 ───────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await new PrismaAdapter().ensureReady()
})

// ─── 테스트 헬퍼 ──────────────────────────────────────────────────────────────

function createCtx(opts?: {
  enums?: string[]
  models?: string[]
  composites?: string[]
}): ParseContext {
  return {
    enumNames: new Set(opts?.enums ?? []),
    modelNames: new Set(opts?.models ?? []),
    compositeTypeNames: new Set(opts?.composites ?? []),
  }
}

function makeChunk(content: string, path = 'test.prisma'): SchemaChunk {
  return {
    files: [{ path, content }],
    orm: 'prisma',
  }
}

function makeFiles(...entries: Array<{ path: string; content: string }>): SchemaFile[] {
  return entries.map(e => ({ path: e.path, content: e.content }))
}

// ─── collectNames ─────────────────────────────────────────────────────────────

describe('collectNames', () => {
  it('T-PA-100: model + enum + view 혼합 → modelNames, enumNames 정확 수집', () => {
    const adapter = new PrismaAdapter()
    const files = makeFiles({
      path: 'prisma/schema.prisma',
      content: `
        enum OrderStatus {
          PENDING
          CONFIRMED
        }

        enum Role {
          USER
          ADMIN
        }

        model User {
          id    String @id
          email String @unique
          role  Role
        }

        model Order {
          id     String      @id
          status OrderStatus
        }

        view ActiveUser {
          id   String
          name String
        }
      `,
    })

    const ctx = adapter.collectNames(files)

    expect(ctx.enumNames).toEqual(new Set(['OrderStatus', 'Role']))
    expect(ctx.modelNames).toEqual(new Set(['User', 'Order', 'ActiveUser']))
    expect(ctx.compositeTypeNames).toEqual(new Set())
  })

  it('T-PA-101: 멀티파일 → 3파일에서 크로스파일 이름 합산', () => {
    const adapter = new PrismaAdapter()
    const files = makeFiles(
      {
        path: 'prisma/base.prisma',
        content: `
          enum OrderStatus { PENDING CONFIRMED }
          enum Role { USER ADMIN }
        `,
      },
      {
        path: 'prisma/auth.prisma',
        content: `
          model User {
            id   String @id
            role Role
          }
          model Session {
            id String @id
          }
        `,
      },
      {
        path: 'prisma/order.prisma',
        content: `
          model Order {
            id     String      @id
            status OrderStatus
          }
          model OrderItem {
            id String @id
          }
        `,
      },
    )

    const ctx = adapter.collectNames(files)

    expect(ctx.enumNames).toEqual(new Set(['OrderStatus', 'Role']))
    expect(ctx.modelNames).toEqual(new Set(['User', 'Session', 'Order', 'OrderItem']))
    expect(ctx.compositeTypeNames).toEqual(new Set())
  })

  it('T-PA-102: composite type → compositeTypeNames 수집 + warning', () => {
    const adapter = new PrismaAdapter()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const files = makeFiles({
      path: 'prisma/schema.prisma',
      content: `
        type Address {
          street String
          city   String
          zip    String
        }

        model User {
          id   String @id
          addr Address
        }
      `,
    })

    const ctx = adapter.collectNames(files)

    expect(ctx.compositeTypeNames).toEqual(new Set(['Address']))
    expect(ctx.modelNames).toEqual(new Set(['User']))
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('composite type')
    )

    warnSpy.mockRestore()
  })

  it('T-PA-103: datasource + generator만 → 모든 Set 빈 값', () => {
    const adapter = new PrismaAdapter()
    const files = makeFiles({
      path: 'prisma/schema.prisma',
      content: `
        datasource db {
          provider = "postgresql"
          url      = env("DATABASE_URL")
        }

        generator client {
          provider = "prisma-client-js"
        }
      `,
    })

    const ctx = adapter.collectNames(files)

    expect(ctx.enumNames.size).toBe(0)
    expect(ctx.modelNames.size).toBe(0)
    expect(ctx.compositeTypeNames.size).toBe(0)
  })

  it('T-PA-104: 빈 파일 → 모든 Set 빈 값', () => {
    const adapter = new PrismaAdapter()
    const files = makeFiles({
      path: 'prisma/empty.prisma',
      content: '',
    })

    const ctx = adapter.collectNames(files)

    expect(ctx.enumNames.size).toBe(0)
    expect(ctx.modelNames.size).toBe(0)
    expect(ctx.compositeTypeNames.size).toBe(0)
  })

  it('T-PA-105: 빈 배열 → 모든 Set 빈 값', () => {
    const adapter = new PrismaAdapter()
    const ctx = adapter.collectNames([])

    expect(ctx.enumNames.size).toBe(0)
    expect(ctx.modelNames.size).toBe(0)
    expect(ctx.compositeTypeNames.size).toBe(0)
  })

  it('T-PA-106: view 블록 → modelNames에 포함 (model처럼 취급)', () => {
    const adapter = new PrismaAdapter()
    const files = makeFiles({
      path: 'prisma/schema.prisma',
      content: `
        view ActiveUser {
          id   String
          name String
        }

        view MonthlyRevenue {
          month   DateTime
          revenue Decimal
        }
      `,
    })

    const ctx = adapter.collectNames(files)

    expect(ctx.modelNames).toEqual(new Set(['ActiveUser', 'MonthlyRevenue']))
    expect(ctx.enumNames.size).toBe(0)
    expect(ctx.compositeTypeNames.size).toBe(0)
  })
})

// ─── prepareChunks ────────────────────────────────────────────────────────────

describe('prepareChunks', () => {
  it('T-PA-110: 파일 3개 → chunk 3개, 각 chunk.files.length=1, orm="prisma"', () => {
    const adapter = new PrismaAdapter()
    const files = makeFiles(
      { path: 'prisma/base.prisma', content: 'enum Role { USER ADMIN }' },
      { path: 'prisma/auth.prisma', content: 'model User { id String @id }' },
      { path: 'prisma/order.prisma', content: 'model Order { id String @id }' },
    )

    const chunks = adapter.prepareChunks(files)

    expect(chunks).toHaveLength(3)
    chunks.forEach((chunk, i) => {
      expect(chunk.files).toHaveLength(1)
      expect(chunk.files[0].path).toBe(files[i].path)
      expect(chunk.files[0].content).toBe(files[i].content)
      expect(chunk.orm).toBe('prisma')
    })
  })

  it('T-PA-111: 빈 배열 → 빈 배열', () => {
    const adapter = new PrismaAdapter()
    const chunks = adapter.prepareChunks([])

    expect(chunks).toEqual([])
  })
})

// ─── parseChunk — 기본 필드 ───────────────────────────────────────────────────

describe('parseChunk — 기본 필드', () => {
  it('T-PA-120: @id, @unique, @default, nullable → 각 어트리뷰트 정확 파싱', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id        String   @id @default(uuid())
        email     String   @unique
        name      String?
        age       Int      @default(0)
        isActive  Boolean  @default(true)
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    const user = result[0]
    expect(user.name).toBe('User')

    const idField = user.fields.find(f => f.name === 'id')!
    expect(idField.primary).toBe(true)
    expect(idField.default).toBe('uuid()')
    expect(idField.type).toBe('String')
    expect(idField.nullable).toBe(false)

    const emailField = user.fields.find(f => f.name === 'email')!
    expect(emailField.unique).toBe(true)
    expect(emailField.primary).toBe(false)

    const nameField = user.fields.find(f => f.name === 'name')!
    expect(nameField.nullable).toBe(true)
    expect(nameField.type).toBe('String')

    const ageField = user.fields.find(f => f.name === 'age')!
    expect(ageField.default).toBe('0')

    const isActiveField = user.fields.find(f => f.name === 'isActive')!
    expect(isActiveField.default).toBe('true')
  })

  it('T-PA-121: 모든 스칼라 타입 (String~Bytes) → type 문자열 정확', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model AllTypes {
        id       Int      @id @default(autoincrement())
        str      String
        bool     Boolean
        bigint   BigInt
        float    Float
        decimal  Decimal
        dt       DateTime
        json     Json
        bytes    Bytes
      }
    `)
    const ctx = createCtx({ models: ['AllTypes'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    const model = result[0]

    const expectedTypes: Record<string, string> = {
      id: 'Int',
      str: 'String',
      bool: 'Boolean',
      bigint: 'BigInt',
      float: 'Float',
      decimal: 'Decimal',
      dt: 'DateTime',
      json: 'Json',
      bytes: 'Bytes',
    }

    for (const [fieldName, expectedType] of Object.entries(expectedTypes)) {
      const field = model.fields.find(f => f.name === fieldName)!
      expect(field, `field ${fieldName} should exist`).toBeDefined()
      expect(field.type).toBe(expectedType)
    }
  })

  it('T-PA-122: 스칼라 리스트 (String[], Int[]) → type="String[]", 관계 아님', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Product {
        id    String   @id @default(uuid())
        tags  String[]
        scores Int[]
      }
    `)
    const ctx = createCtx({ models: ['Product'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    const model = result[0]

    const tagsField = model.fields.find(f => f.name === 'tags')!
    expect(tagsField.type).toBe('String[]')

    const scoresField = model.fields.find(f => f.name === 'scores')!
    expect(scoresField.type).toBe('Int[]')

    expect(model.relations).toHaveLength(0)
  })

  it('T-PA-123: @default 변형 5종 → 각 default 값 정확', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Defaults {
        id        Int      @id @default(autoincrement())
        uuid      String   @default(uuid())
        createdAt DateTime @default(now())
        count     Int      @default(0)
        active    Boolean  @default(true)
      }
    `)
    const ctx = createCtx({ models: ['Defaults'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.fields.find(f => f.name === 'id')!.default).toBe('autoincrement()')
    expect(model.fields.find(f => f.name === 'uuid')!.default).toBe('uuid()')
    expect(model.fields.find(f => f.name === 'createdAt')!.default).toBe('now()')
    expect(model.fields.find(f => f.name === 'count')!.default).toBe('0')
    expect(model.fields.find(f => f.name === 'active')!.default).toBe('true')
  })

  it('T-PA-124: @default(dbgenerated(...)) 중첩 괄호 전체 텍스트 보존', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Token {
        id    String @id @default(dbgenerated("gen_random_uuid()"))
        hash  String @default(dbgenerated())
      }
    `)
    const ctx = createCtx({ models: ['Token'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.fields.find(f => f.name === 'id')!.default).toBe(
      'dbgenerated("gen_random_uuid()")'
    )
    expect(model.fields.find(f => f.name === 'hash')!.default).toBe(
      'dbgenerated()'
    )
  })
})

// ─── parseChunk — doc comment ─────────────────────────────────────────────────

describe('parseChunk — doc comment', () => {
  it('T-PA-125: 필드 doc comment (///) → comment 값 정확', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id
        /// User's email address
        email String @unique
        name  String
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const emailField = model.fields.find(f => f.name === 'email')!
    expect(emailField.comment).toBe("User's email address")

    const nameField = model.fields.find(f => f.name === 'name')!
    expect(nameField.comment).toBeUndefined()
  })

  it('T-PA-125a: 필드 위 // 일반 주석 → comment에 포함', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id
        // User email address
        email String @unique
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const emailField = result[0].fields.find(f => f.name === 'email')!

    expect(emailField.comment).toBe('User email address')
  })

  it('T-PA-125b: 필드 인라인 // → comment에 포함', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id
        email String @unique // User email address
        name  String
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const emailField = result[0].fields.find(f => f.name === 'email')!
    const nameField = result[0].fields.find(f => f.name === 'name')!

    expect(emailField.comment).toBe('User email address')
    expect(nameField.comment).toBeUndefined()
  })

  it('T-PA-125c: 필드 인라인 /// → comment에 포함', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id
        email String @unique /// User email address
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const emailField = result[0].fields.find(f => f.name === 'email')!

    expect(emailField.comment).toBe('User email address')
  })

  it('T-PA-125d: /// 위 + 인라인 // → \\n 합치기', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id
        /// Primary email
        email String @unique // Must be unique across all users
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const emailField = result[0].fields.find(f => f.name === 'email')!

    expect(emailField.comment).toBe('Primary email\nMust be unique across all users')
  })

  it('T-PA-125e: // + /// 혼재 (위에) → 둘 다 수집, 순서 유지', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id
        // Regular comment
        /// Doc comment
        email String @unique
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const emailField = result[0].fields.find(f => f.name === 'email')!

    expect(emailField.comment).toBe('Regular comment\nDoc comment')
  })

  it('T-PA-126: 다중 줄 doc comment → \\n 결합', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// User account
      /// Stores login credentials
      model User {
        id   String @id
        /// Primary email
        /// Must be unique
        email String @unique
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.comment).toBe('User account\nStores login credentials')

    const emailField = model.fields.find(f => f.name === 'email')!
    expect(emailField.comment).toBe('Primary email\nMust be unique')
  })

  it('T-PA-126a: 모델 선언 인라인 // → comment에 포함', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User { // Main user entity
        id   String @id
        name String
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('Main user entity')
  })

  it('T-PA-126b: 모델 /// 위 + 인라인 // → \\n 합치기', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// User account entity
      model User { // Stores authentication info
        id   String @id
        name String
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('User account entity\nStores authentication info')
  })

  it('T-PA-240: 연속 /// 2줄 → \\n 결합', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// User account
      /// Stores login credentials
      model User {
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('User account\nStores login credentials')
  })

  it('T-PA-241: /// 없음 → 빈 문자열', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('')
  })

  it('T-PA-242: 빈 /// (내용 없음) → 빈 문자열 줄 포함', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// First line
      ///
      /// Third line
      model User {
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('First line\n\nThird line')
  })

  it('T-PA-243: /// 사이에 빈 줄 (비연속) → 빈 줄 이전까지만 수집', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// This is orphaned

      /// This is the model comment
      model User {
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('This is the model comment')
  })

  it('T-PA-244: // 단일 줄 → comment 수집', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      // User model
      model User {
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('User model')
  })

  it('T-PA-245: /// + // 혼재 (위에) → 둘 다 수집, 순서 유지', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      // First comment
      /// Second comment
      model User {
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('First comment\nSecond comment')
  })

  it('T-PA-246: 모델 인라인 // → comment에 추가', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User { // Inline comment
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('Inline comment')
  })

  it('T-PA-247: 모델 인라인 /// → comment에 추가', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User { /// Inline doc comment
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('Inline doc comment')
  })

  it('T-PA-248: 위 /// + 인라인 // → \\n 합치기', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// User account
      model User { // Main entity
        id String @id
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].comment).toBe('User account\nMain entity')
  })
})

// ─── parseChunk — @ignore, line, empty ───────────────────────────────────────

describe('parseChunk — @ignore, line, empty', () => {
  it('T-PA-127: @ignore 필드 → fields에서 제외', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model TenantOrder {
        tenantId  String
        orderId   String
        amount    Decimal
        notes     String?  @ignore
        createdAt DateTime @default(now())
        @@id([tenantId, orderId])
      }
    `)
    const ctx = createCtx({ models: ['TenantOrder'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const fieldNames = model.fields.map(f => f.name)
    expect(fieldNames).toContain('tenantId')
    expect(fieldNames).toContain('orderId')
    expect(fieldNames).toContain('amount')
    expect(fieldNames).toContain('createdAt')
    expect(fieldNames).not.toContain('notes')
    expect(model.fields).toHaveLength(4)
  })

  it('T-PA-128: line 번호 정확 (1-based)', () => {
    const adapter = new PrismaAdapter()
    const content = [
      'model User {',
      '  id    String @id',
      '  email String',
      '  name  String?',
      '}',
    ].join('\n')
    const chunk = makeChunk(content)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.line_start).toBe(1)
    expect(model.line_end).toBe(5)

    expect(model.fields.find(f => f.name === 'id')!.line).toBe(2)
    expect(model.fields.find(f => f.name === 'email')!.line).toBe(3)
    expect(model.fields.find(f => f.name === 'name')!.line).toBe(4)
  })

  it('T-PA-128b: 빈 model {} → fields=[], relations=[]', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Empty {}
    `)
    const ctx = createCtx({ models: ['Empty'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(0)
    expect(result[0].relations).toHaveLength(0)
  })
})

// ─── parseChunk — enum 참조 ───────────────────────────────────────────────────

describe('parseChunk — enum 참조', () => {
  it('T-PA-130: enum 참조 필드 → type="EnumName(enum)"', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Order {
        id     String      @id @default(uuid())
        status OrderStatus @default(PENDING)
        role   Role
      }
    `)
    const ctx = createCtx({
      enums: ['OrderStatus', 'Role'],
      models: ['Order'],
    })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const statusField = model.fields.find(f => f.name === 'status')!
    expect(statusField.type).toBe('OrderStatus(enum)')
    expect(statusField.default).toBe('PENDING')

    const roleField = model.fields.find(f => f.name === 'role')!
    expect(roleField.type).toBe('Role(enum)')
  })

  it('T-PA-131: enum 리스트 (Role[]) → type="Role(enum)[]" ([] 보존)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id
        roles Role[]
      }
    `)
    const ctx = createCtx({
      enums: ['Role'],
      models: ['User'],
    })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const rolesField = model.fields.find((f: ModelField) => f.name === 'roles')!
    expect(rolesField.type).toBe('Role(enum)[]')

    expect(model.relations).toHaveLength(0)
  })

  it('T-PA-132: 단일 enum 참조 (Role) → type="Role(enum)" ([] 없음)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id   String @id
        role Role
      }
    `)
    const ctx = createCtx({ enums: ['Role'], models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const roleField = result[0].fields.find((f: ModelField) => f.name === 'role')!
    expect(roleField.type).toBe('Role(enum)')
  })

  it('T-PA-133: composite type 리스트 (Address[]) → type="Address(composite)[]" ([] 보존)', () => {
    const adapter = new PrismaAdapter()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chunk = makeChunk(`
      model User {
        id        String    @id
        addresses Address[]
      }
    `)
    const ctx = createCtx({ composites: ['Address'], models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const addrField = result[0].fields.find((f: ModelField) => f.name === 'addresses')!
    expect(addrField.type).toBe('Address(composite)[]')
    warnSpy.mockRestore()
  })

  it('T-PA-134: Unsupported("geometry") → type="Unsupported(geometry)" (내부 타입 보존)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Location {
        id       String                  @id @default(uuid())
        coords   Unsupported("geometry")
        boundary Unsupported("polygon")
      }
    `)
    const ctx = createCtx({ models: ['Location'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const coordsField = model.fields.find((f: ModelField) => f.name === 'coords')!
    expect(coordsField.type).toBe('Unsupported(geometry)')

    const boundaryField = model.fields.find((f: ModelField) => f.name === 'boundary')!
    expect(boundaryField.type).toBe('Unsupported(polygon)')
  })

  it('T-PA-135: @default("string literal") → 따옴표 제거된 값 저장', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Config {
        id       String @id @default(uuid())
        timezone String @default("UTC")
        locale   String @default("en-US")
        empty    String @default("")
      }
    `)
    const ctx = createCtx({ models: ['Config'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.fields.find((f: ModelField) => f.name === 'timezone')!.default).toBe('UTC')
    expect(model.fields.find((f: ModelField) => f.name === 'locale')!.default).toBe('en-US')
    expect(model.fields.find((f: ModelField) => f.name === 'empty')!.default).toBe('')
  })
})

// ─── parseChunk — 관계 ────────────────────────────────────────────────────────

describe('parseChunk — 관계', () => {
  it('T-PA-140: 1:1 FK측 (@unique + @relation) → type=oneToOne, fk, refs', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Profile {
        id     String @id @default(uuid())
        bio    String?
        userId String @unique
        user   User   @relation(fields: [userId], references: [id])
      }
    `)
    const ctx = createCtx({ models: ['Profile', 'User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.relations).toHaveLength(1)
    const rel = model.relations[0]
    expect(rel.name).toBe('user')
    expect(rel.target_model).toBe('User')
    expect(rel.type).toBe('oneToOne')
    expect(rel.fk_fields).toEqual(['userId'])
    expect(rel.references).toEqual(['id'])

    const userIdField = model.fields.find(f => f.name === 'userId')!
    expect(userIdField.unique).toBe(true)
  })

  it('T-PA-141: 1:N FK측 (@relation, unique 없음) → type=manyToOne', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Order {
        id     String @id @default(uuid())
        userId String
        user   User   @relation(fields: [userId], references: [id])
      }
    `)
    const ctx = createCtx({ models: ['Order', 'User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.relations).toHaveLength(1)
    const rel = model.relations[0]
    expect(rel.name).toBe('user')
    expect(rel.target_model).toBe('User')
    expect(rel.type).toBe('manyToOne')
    expect(rel.fk_fields).toEqual(['userId'])
    expect(rel.references).toEqual(['id'])
  })

  it('T-PA-142: 1:N 리스트측 (Type[]) → type=oneToMany', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id     String  @id @default(uuid())
        orders Order[]
      }
    `)
    const ctx = createCtx({ models: ['User', 'Order'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.relations).toHaveLength(1)
    const rel = model.relations[0]
    expect(rel.name).toBe('orders')
    expect(rel.target_model).toBe('Order')
    expect(rel.type).toBe('oneToMany')
    expect(rel.fk_fields).toBeUndefined()
    expect(rel.references).toBeUndefined()
  })

  it('T-PA-143: @relation name만 (FK/refs 없음) → relation_name만, fk undefined', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id           String @id
        authoredPosts Post[] @relation("AuthorPosts")
      }
    `)
    const ctx = createCtx({ models: ['User', 'Post'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.relations).toHaveLength(1)
    const rel = model.relations[0]
    expect(rel.relation_name).toBe('AuthorPosts')
    expect(rel.fk_fields).toBeUndefined()
    expect(rel.references).toBeUndefined()
    expect(rel.type).toBe('oneToMany')
  })

  it('T-PA-144: @relation onDelete/onUpdate → fk/refs만 추출, 나머지 무시', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Comment {
        id       String @id @default(uuid())
        postId   String
        post     Post   @relation(fields: [postId], references: [id], onDelete: Cascade, onUpdate: NoAction)
      }
    `)
    const ctx = createCtx({ models: ['Comment', 'Post'] })

    const result = adapter.parseChunk(chunk, ctx)
    const rel = result[0].relations[0]

    expect(rel.fk_fields).toEqual(['postId'])
    expect(rel.references).toEqual(['id'])
    expect(rel.type).toBe('manyToOne')
  })

  it('T-PA-145: 자기참조 → target_model = 자기 모델', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Employee {
        id         String     @id @default(uuid())
        name       String
        managerId  String?
        manager    Employee?  @relation("Management", fields: [managerId], references: [id])
        reports    Employee[] @relation("Management")
      }
    `)
    const ctx = createCtx({ models: ['Employee'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.relations).toHaveLength(2)

    const managerRel = model.relations.find(r => r.name === 'manager')!
    expect(managerRel.target_model).toBe('Employee')
    expect(managerRel.relation_name).toBe('Management')
    expect(managerRel.fk_fields).toEqual(['managerId'])
    expect(managerRel.references).toEqual(['id'])

    const reportsRel = model.relations.find(r => r.name === 'reports')!
    expect(reportsRel.target_model).toBe('Employee')
    expect(reportsRel.relation_name).toBe('Management')
    expect(reportsRel.type).toBe('oneToMany')
  })

  it('T-PA-146: 동일 쌍 복수 관계 → relation_name으로 구분, 2개 관계', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Post {
        id         String @id @default(uuid())
        title      String
        authorId   String
        author     User   @relation("AuthorPosts", fields: [authorId], references: [id])
        editorId   String?
        editor     User?  @relation("EditorPosts", fields: [editorId], references: [id])
      }
    `)
    const ctx = createCtx({ models: ['Post', 'User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.relations).toHaveLength(2)

    const authorRel = model.relations.find(r => r.name === 'author')!
    expect(authorRel.relation_name).toBe('AuthorPosts')
    expect(authorRel.fk_fields).toEqual(['authorId'])

    const editorRel = model.relations.find(r => r.name === 'editor')!
    expect(editorRel.relation_name).toBe('EditorPosts')
    expect(editorRel.fk_fields).toEqual(['editorId'])
  })

  it('T-PA-147: @@unique([fk]) 단일 필드 + FK → oneToOne 판정', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model ShippingAddress {
        id      String @id @default(uuid())
        street  String
        userId  String
        user    User   @relation(fields: [userId], references: [id])
        @@unique([userId])
      }
    `)
    const ctx = createCtx({ models: ['ShippingAddress', 'User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const rel = model.relations.find(r => r.name === 'user')!
    expect(rel.type).toBe('oneToOne')
    expect(rel.fk_fields).toEqual(['userId'])
  })

  it('T-PA-148: @@unique([a, b]) 복합 → manyToOne 유지 (oneToOne 아님)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Enrollment {
        id        String @id @default(uuid())
        studentId String
        student   User   @relation(fields: [studentId], references: [id])
        courseId   String
        @@unique([studentId, courseId])
      }
    `)
    const ctx = createCtx({ models: ['Enrollment', 'User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const rel = model.relations.find(r => r.name === 'student')!
    expect(rel.type).toBe('manyToOne')
  })

  it('T-PA-149: optional 관계 (User?) → relation 생성됨', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Post {
        id       String @id @default(uuid())
        editorId String?
        editor   User?  @relation(fields: [editorId], references: [id])
      }
    `)
    const ctx = createCtx({ models: ['Post', 'User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.relations).toHaveLength(1)
    const rel = model.relations[0]
    expect(rel.name).toBe('editor')
    expect(rel.target_model).toBe('User')
    expect(rel.fk_fields).toEqual(['editorId'])
  })

  it('T-PA-150: @relation fields/references 빈 배열 → fk_fields=[], references=[]', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Weird {
        id   String @id
        user User   @relation(fields: [], references: [])
      }
    `)
    const ctx = createCtx({ models: ['Weird', 'User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const rel = result[0].relations[0]

    expect(rel.fk_fields).toEqual([])
    expect(rel.references).toEqual([])
  })

  it('T-PA-151: 암묵적 M:N (양쪽 리스트, FK 없음) → 양쪽 manyToMany', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Post {
        id         String     @id @default(uuid())
        categories Category[]
      }

      model Category {
        id    String @id @default(uuid())
        posts Post[]
      }
    `)
    const ctx = createCtx({ models: ['Post', 'Category'] })

    const result = adapter.parseChunk(chunk, ctx)
    const post = result.find((m: ModelRaw) => m.name === 'Post')!
    const category = result.find((m: ModelRaw) => m.name === 'Category')!

    const catRel = post.relations.find((r: ModelRelation) => r.name === 'categories')!
    expect(catRel.type).toBe('manyToMany')

    const postRel = category.relations.find((r: ModelRelation) => r.name === 'posts')!
    expect(postRel.type).toBe('manyToMany')
  })

  it('T-PA-152: 1:N은 M:N으로 승격 안 됨 (FK측 있음)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id @default(uuid())
        posts Post[]
      }

      model Post {
        id     String @id @default(uuid())
        userId String
        user   User   @relation(fields: [userId], references: [id])
      }
    `)
    const ctx = createCtx({ models: ['User', 'Post'] })

    const result = adapter.parseChunk(chunk, ctx)
    const user = result.find((m: ModelRaw) => m.name === 'User')!
    const post = result.find((m: ModelRaw) => m.name === 'Post')!

    const postsRel = user.relations.find((r: ModelRelation) => r.name === 'posts')!
    expect(postsRel.type).toBe('oneToMany')

    const userRel = post.relations.find((r: ModelRelation) => r.name === 'user')!
    expect(userRel.type).toBe('manyToOne')
  })

  it('T-PA-153: 네임드 암묵적 M:N (@relation("name")) → 이름 일치 시 manyToMany', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Post {
        id   String  @id @default(uuid())
        tags Tag[]   @relation("PostTags")
      }

      model Tag {
        id    String @id @default(uuid())
        posts Post[] @relation("PostTags")
      }
    `)
    const ctx = createCtx({ models: ['Post', 'Tag'] })

    const result = adapter.parseChunk(chunk, ctx)
    const post = result.find((m: ModelRaw) => m.name === 'Post')!
    const tag = result.find((m: ModelRaw) => m.name === 'Tag')!

    expect(post.relations[0].type).toBe('manyToMany')
    expect(tag.relations[0].type).toBe('manyToMany')
  })
})

// ─── parseChunk — composite type ──────────────────────────────────────────────

describe('parseChunk — composite type', () => {
  it('T-PA-160: composite type 블록 → skip (ModelRaw 없음) + warning', () => {
    const adapter = new PrismaAdapter()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chunk = makeChunk(`
      type Address {
        street String
        city   String
        zip    String
      }

      model User {
        id   String @id
        name String
      }
    `)
    const ctx = createCtx({
      models: ['User'],
      composites: ['Address'],
    })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('User')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('composite type')
    )

    warnSpy.mockRestore()
  })

  it('T-PA-161: composite 참조 필드 → type="Name(composite)" + warning', () => {
    const adapter = new PrismaAdapter()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chunk = makeChunk(`
      model ShippingAddress {
        id      String  @id @default(uuid())
        addr    Address
        zipCode String
      }
    `)
    const ctx = createCtx({
      models: ['ShippingAddress'],
      composites: ['Address'],
    })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const addrField = model.fields.find(f => f.name === 'addr')!
    expect(addrField.type).toBe('Address(composite)')

    expect(model.relations).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})

// ─── parseChunk — @@map, @@id, @@index ───────────────────────────────────────

describe('parseChunk — block attributes', () => {
  it('T-PA-170: @@map 여부 무관 → table_name = 모델명', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model TenantOrder {
        id     String @id @default(uuid())
        amount Decimal
        @@map("tenant_orders")
      }
    `)
    const ctx = createCtx({ models: ['TenantOrder'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].table_name).toBe('TenantOrder')
  })

  it('T-PA-171: @@map 없음 → table_name = 모델명 그대로', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model OrderItem {
        id    String @id @default(uuid())
        price Decimal
      }
    `)
    const ctx = createCtx({ models: ['OrderItem'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].table_name).toBe('OrderItem')
  })

  it('T-PA-172: @@id 복합키 → 해당 필드 primary=true', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model TenantOrder {
        tenantId  String
        orderId   String
        amount    Decimal
        createdAt DateTime @default(now())
        @@id([tenantId, orderId])
      }
    `)
    const ctx = createCtx({ models: ['TenantOrder'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    const tenantIdField = model.fields.find(f => f.name === 'tenantId')!
    expect(tenantIdField.primary).toBe(true)

    const orderIdField = model.fields.find(f => f.name === 'orderId')!
    expect(orderIdField.primary).toBe(true)

    const amountField = model.fields.find(f => f.name === 'amount')!
    expect(amountField.primary).toBe(false)
  })

  it('T-PA-173: @@index → graceful ignore (에러 없음)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Order {
        id        String   @id @default(uuid())
        status    String
        createdAt DateTime @default(now())
        @@index([status, createdAt])
        @@index([createdAt])
      }
    `)
    const ctx = createCtx({ models: ['Order'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(3)
  })

  it('T-PA-174: @@fulltext → graceful ignore (에러 없음)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Product {
        id          String @id @default(uuid())
        name        String
        description String
        @@fulltext([name, description])
      }
    `)
    const ctx = createCtx({ models: ['Product'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(3)
  })

  it('T-PA-175: @@schema → graceful ignore (에러 없음)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model AuditLog {
        id      String   @id @default(uuid())
        action  String
        payload Json
        @@schema("audit")
      }
    `)
    const ctx = createCtx({ models: ['AuditLog'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].fields).toHaveLength(3)
  })

  it('T-PA-176: @@ignore 모델 → ModelRaw 출력에서 제외', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model VisibleModel {
        id   String @id
        name String
      }

      model HiddenModel {
        id    String @id
        data  String
        @@ignore
      }
    `)
    const ctx = createCtx({ models: ['VisibleModel', 'HiddenModel'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('VisibleModel')
  })

  it('T-PA-177: @@ignore 단독 모델 → 빈 배열 반환', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model RawSql {
        id   String @id
        @@ignore
      }
    `)
    const ctx = createCtx({ models: ['RawSql'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(0)
  })
})

// ─── parseChunk — view ────────────────────────────────────────────────────────

describe('parseChunk — view', () => {
  it('T-PA-180: view 블록 → ModelRaw 생성 (model처럼 파싱)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      view ActiveUser {
        id       String
        name     String
        email    String
        orderCount Int
      }
    `)
    const ctx = createCtx({ models: ['ActiveUser'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    const model = result[0]
    expect(model.name).toBe('ActiveUser')
    expect(model.fields).toHaveLength(4)
  })

  it('T-PA-181: view PK 없음 → 모든 필드 primary=false', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      view MonthlyRevenue {
        month   DateTime
        revenue Decimal
        count   Int
      }
    `)
    const ctx = createCtx({ models: ['MonthlyRevenue'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    model.fields.forEach(field => {
      expect(field.primary).toBe(false)
    })
  })
})

// ─── parseChunk — datasource/generator 무시 ──────────────────────────────────

describe('parseChunk — datasource/generator', () => {
  it('T-PA-190: datasource + generator → 무시, ModelRaw 없음', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      datasource db {
        provider = "postgresql"
        url      = env("DATABASE_URL")
      }

      generator client {
        provider = "prisma-client-js"
      }

      model User {
        id   String @id
        name String
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('User')
  })
})

// ─── parseChunk — deprecated ──────────────────────────────────────────────────

describe('parseChunk — deprecated', () => {
  it('T-PA-200: /// @deprecated comment → is_deprecated=true', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// @deprecated Use NewUser instead
      model OldUser {
        id   String @id
        name String
      }
    `)
    const ctx = createCtx({ models: ['OldUser'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].is_deprecated).toBe(true)
    expect(result[0].comment).toBe('@deprecated Use NewUser instead')
  })

  it('T-PA-201: @@map("_deprecated_old_users") → is_deprecated=false (@@map 미사용)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model OldUser {
        id   String @id
        name String
        @@map("_deprecated_old_users")
      }
    `)
    const ctx = createCtx({ models: ['OldUser'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].is_deprecated).toBe(false)
    expect(result[0].table_name).toBe('OldUser')
  })

  it('T-PA-202: deprecated 패턴 없음 → is_deprecated=false', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// Normal user model
      model User {
        id   String @id
        name String
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].is_deprecated).toBe(false)
  })

  it('T-PA-250: comment에 @deprecated → is_deprecated=true', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      /// @deprecated Use NewUser model
      model OldUser {
        id   String @id
        name String
      }
    `)
    const ctx = createCtx({ models: ['OldUser'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].is_deprecated).toBe(true)
  })

  it('T-PA-251: @@map("_deprecated_legacy") → is_deprecated=false, table_name=모델명', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Legacy {
        id String @id
        @@map("_deprecated_legacy")
      }
    `)
    const ctx = createCtx({ models: ['Legacy'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].is_deprecated).toBe(false)
    expect(result[0].table_name).toBe('Legacy')
  })
})

// ─── parseChunk — native type 어트리뷰트 무시 ────────────────────────────────

describe('parseChunk — native type attributes', () => {
  it('T-PA-219: @db.Decimal(10,2) → 무시, type="Decimal"', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Product {
        id    String  @id @default(uuid())
        price Decimal @db.Decimal(10, 2)
      }
    `)
    const ctx = createCtx({ models: ['Product'] })

    const result = adapter.parseChunk(chunk, ctx)

    const priceField = result[0].fields.find(f => f.name === 'price')!
    expect(priceField.type).toBe('Decimal')
  })

  it('T-PA-220: @db.VarChar(255) → 무시, type은 기본 타입', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id    String @id @default(uuid())
        name  String @db.VarChar(255)
        bio   String @db.Text
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)

    const nameField = result[0].fields.find(f => f.name === 'name')!
    expect(nameField.type).toBe('String')

    const bioField = result[0].fields.find(f => f.name === 'bio')!
    expect(bioField.type).toBe('String')
  })

  it('T-PA-221: @db.Uuid, @db.Text → 무시', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Token {
        id    String @id @db.Uuid
        value String @db.Text
      }
    `)
    const ctx = createCtx({ models: ['Token'] })

    const result = adapter.parseChunk(chunk, ctx)

    expect(result[0].fields.find(f => f.name === 'id')!.type).toBe('String')
    expect(result[0].fields.find(f => f.name === 'value')!.type).toBe('String')
  })

  it('T-PA-222: @updatedAt → 무시 (파싱 에러 없음)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model Post {
        id        String   @id @default(uuid())
        title     String
        createdAt DateTime @default(now())
        updatedAt DateTime @updatedAt
      }
    `)
    const ctx = createCtx({ models: ['Post'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.fields).toHaveLength(4)
    const updatedField = model.fields.find(f => f.name === 'updatedAt')!
    expect(updatedField.type).toBe('DateTime')
    expect(updatedField.default).toBeUndefined()
  })

  it('T-PA-223: @map("column_name") → 무시 (ModelField에 미반영)', () => {
    const adapter = new PrismaAdapter()
    const chunk = makeChunk(`
      model User {
        id        String   @id @default(uuid())
        firstName String   @map("first_name")
        lastName  String   @map("last_name")
        createdAt DateTime @default(now()) @map("created_at")
      }
    `)
    const ctx = createCtx({ models: ['User'] })

    const result = adapter.parseChunk(chunk, ctx)
    const model = result[0]

    expect(model.fields.find(f => f.name === 'firstName')).toBeDefined()
    expect(model.fields.find(f => f.name === 'lastName')).toBeDefined()
    expect(model.fields).toHaveLength(4)
  })
})


// ─── parseChunk — fixture 기반 ────────────────────────────────────────────────

describe('parseChunk — fixture 기반', () => {
  it('T-PA-210: ecommerce fixture → 50개 이상 ModelRaw, 관계/enum 정확', async () => {
    const adapter = new PrismaAdapter()
    const content = await fs.readFile(
      path.resolve(__dirname, 'fixtures/prisma/ecommerce.prisma'),
      'utf-8',
    )
    const files = makeFiles({ path: 'prisma/ecommerce.prisma', content })

    const ctx = adapter.collectNames(files)
    const chunk = makeChunk(content, 'prisma/ecommerce.prisma')
    const result = adapter.parseChunk(chunk, ctx)

    expect(result.length).toBeGreaterThanOrEqual(50)

    const modelNames = result.map(m => m.name)
    expect(modelNames).toContain('User')
    expect(modelNames).toContain('Order')
    expect(modelNames).toContain('Product')
    expect(modelNames).toContain('Category')
    expect(modelNames).toContain('Payment')

    const order = result.find(m => m.name === 'Order')!
    const statusField = order.fields.find(f => f.name === 'status')
    expect(statusField?.type).toContain('(enum)')

    const userRel = order.relations.find(r => r.target_model === 'User')
    expect(userRel).toBeDefined()
    expect(userRel!.fk_fields).toBeDefined()
  })

  it('T-PA-211: 100+ fields 거대 모델 → 모든 필드 파싱', async () => {
    const adapter = new PrismaAdapter()
    const content = await fs.readFile(
      path.resolve(__dirname, 'fixtures/prisma/big_model.prisma'),
      'utf-8',
    )
    const files = makeFiles({ path: 'prisma/big_model.prisma', content })
    const ctx = adapter.collectNames(files)
    const chunk = makeChunk(content, 'prisma/big_model.prisma')

    const result = adapter.parseChunk(chunk, ctx)

    expect(result).toHaveLength(1)
    const model = result[0]
    expect(model.fields.length).toBeGreaterThanOrEqual(100)

    expect(model.fields[0].name).toBeDefined()
    expect(model.fields[model.fields.length - 1].name).toBeDefined()

    for (let i = 1; i < model.fields.length; i++) {
      expect(model.fields[i].line).toBeGreaterThanOrEqual(model.fields[i - 1].line)
    }
  })

  it('T-PA-212: 멀티파일 크로스파일 참조 → ctx 기반 정확 해석', async () => {
    const adapter = new PrismaAdapter()
    const basePath = path.resolve(__dirname, 'fixtures/prisma/multifile')
    const baseContent = await fs.readFile(path.join(basePath, 'base.prisma'), 'utf-8')
    const authContent = await fs.readFile(path.join(basePath, 'auth.prisma'), 'utf-8')
    const orderContent = await fs.readFile(path.join(basePath, 'order.prisma'), 'utf-8')

    const files = makeFiles(
      { path: 'prisma/base.prisma', content: baseContent },
      { path: 'prisma/auth.prisma', content: authContent },
      { path: 'prisma/order.prisma', content: orderContent },
    )

    const ctx = adapter.collectNames(files)

    const chunks = adapter.prepareChunks(files)
    const allModels = chunks.flatMap(chunk => adapter.parseChunk(chunk, ctx))

    const order = allModels.find(m => m.name === 'Order')
    expect(order).toBeDefined()

    const userRel = order!.relations.find(r => r.target_model === 'User')
    expect(userRel).toBeDefined()

    expect(ctx.enumNames.size).toBeGreaterThan(0)
  })
})

// ─── ensureParser 캐시 ────────────────────────────────────────────────────────

describe('ensureParser', () => {
  it('캐시 확인 — 두 번 호출해도 같은 인스턴스', async () => {
    const p1 = await new PrismaAdapter().ensureReady()
    const p2 = await new PrismaAdapter().ensureReady()

    expect(p1).toBe(p2)
  })
})
