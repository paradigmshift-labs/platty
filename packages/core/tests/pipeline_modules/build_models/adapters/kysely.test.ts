import { describe, it, expect } from 'vitest'
import { KyselyAdapter } from '@/pipeline_modules/build_models/adapters/kysely.js'
import type { SchemaChunk, SchemaFile } from '@/pipeline_modules/build_models/types.js'

function file(content: string, path = 'lib/kysely.ts'): SchemaFile {
  return { path, content }
}

function chunk(content: string): SchemaChunk {
  return { files: [file(content)], orm: 'kysely' }
}

describe('KyselyAdapter', () => {
  it('K1: orm/strategy 속성', () => {
    const adapter = new KyselyAdapter()
    expect(adapter.orm).toBe('kysely')
    expect(adapter.strategy).toBe('dsl-parse')
  })

  it('K2: Database interface의 table mapping과 table interface fields 파싱', async () => {
    const content = `
import { type Generated, type ColumnType } from 'kysely'

interface ProfileTable {
  id: Generated<number>
  name: string
  email: string
  image?: string | null
  createdAt: ColumnType<Date, string | undefined, never>
}

export interface Database {
  profiles: ProfileTable
}
`
    const adapter = new KyselyAdapter()
    const result = await adapter.parseChunk(chunk(content))

    expect(result).toHaveLength(1)
    const model = result[0]
    expect(model.name).toBe('Profiles')
    expect(model.table_name).toBe('profiles')
    expect(model.source_file).toBe('lib/kysely.ts')
    expect(model.fields).toHaveLength(5)
    expect(model.fields.find((f) => f.name === 'id')).toMatchObject({ type: 'Int', primary: true, nullable: false })
    expect(model.fields.find((f) => f.name === 'name')).toMatchObject({ type: 'String', nullable: false })
    expect(model.fields.find((f) => f.name === 'image')).toMatchObject({ type: 'String', nullable: true })
    expect(model.fields.find((f) => f.name === 'createdAt')).toMatchObject({ type: 'DateTime', nullable: false })
  })

  it('K3: collectNames는 Database table key를 PascalCase 모델명으로 수집', () => {
    const content = `
interface UserAccountTable { id: Generated<number> }
export interface Database {
  user_accounts: UserAccountTable
}
`
    const adapter = new KyselyAdapter()
    const ctx = adapter.collectNames([file(content)])
    expect(ctx.modelNames.has('UserAccounts')).toBe(true)
  })

  it('K4: Database와 table interface가 다른 파일에 있어도 모델을 파싱', async () => {
    const adapter = new KyselyAdapter()
    const result = await adapter.parseChunk({
      orm: 'kysely',
      files: [
        file(`
import { UserTable } from './user.table'

export interface Database {
  user: UserTable
}
`, 'src/database.ts'),
        file(`
import { Generated } from 'kysely'

export interface UserTable {
  id: Generated<number>
  email: string | null
}
`, 'src/user.table.ts'),
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'User',
      table_name: 'user',
      source_file: 'src/user.table.ts',
    })
    expect(result[0].fields.find((field) => field.name === 'email')).toMatchObject({
      type: 'String',
      nullable: true,
    })
  })

  it('K5: DB alias와 quoted table key를 지원', async () => {
    const content = `
interface Toy {
  id: Generated<number>
  name: string
}

export interface DB {
  'toy_schema.toy': Toy
}
`
    const adapter = new KyselyAdapter()
    const result = await adapter.parseChunk(chunk(content))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'ToySchemaToy',
      table_name: 'toy_schema.toy',
    })
  })
})
