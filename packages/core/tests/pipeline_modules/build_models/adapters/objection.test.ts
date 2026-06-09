import { describe, expect, it } from 'vitest'
import { ObjectionAdapter } from '@/pipeline_modules/build_models/adapters/objection.js'
import type { SchemaFile } from '@/pipeline_modules/build_models/types.js'

function chunk(files: SchemaFile[]) {
  return { files, orm: 'objection' }
}

describe('ObjectionAdapter', () => {
  it('parses Model subclasses with static tableName and JSON schema fields', async () => {
    const adapter = new ObjectionAdapter()
    const files = [{
      path: 'models/Person.ts',
      content: `
import { Model } from 'objection'

export default class Person extends Model {
  id!: number
  firstName!: string
  parentId?: number

  static tableName = 'persons'

  static jsonSchema = {
    type: 'object',
    required: ['firstName'],
    properties: {
      id: { type: 'integer' },
      firstName: { type: 'string' },
      parentId: { type: ['integer', 'null'] },
      address: { type: 'object' },
    },
  }
}
`,
    }]

    const result = await adapter.parseChunk(chunk(files))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Person', table_name: 'persons', source_file: 'models/Person.ts' })
    expect(result[0].fields.map((field) => [field.name, field.type, field.nullable])).toEqual([
      ['id', 'Int', true],
      ['firstName', 'String', false],
      ['parentId', 'Int', true],
      ['address', 'Json', true],
    ])
  })

  it('uses Knex migration columns when the model has no field declarations', async () => {
    const adapter = new ObjectionAdapter()
    const files = [
      {
        path: 'database/Models/User.ts',
        content: `
import { Model } from 'objection'
export default class User extends Model {
  static get tableName() {
    return 'users'
  }
}
`,
      },
      {
        path: 'database/migrations/001_users.ts',
        content: `
export async function up(knex) {
  return knex.schema.createTable('users', table => {
    table.increments('id').primary()
    table.string('name').notNullable()
    table.string('email').unique().notNullable()
    table.timestamps(true, true)
  })
}
`,
      },
    ]

    const result = await adapter.parseChunk(chunk(files))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'User', table_name: 'users' })
    expect(result[0].fields.map((field) => [field.name, field.type, field.primary, field.unique, field.nullable])).toEqual([
      ['id', 'Int', true, false, true],
      ['name', 'String', false, false, false],
      ['email', 'String', false, true, false],
    ])
  })

  it('parses namespaced Model inheritance and static tableName method', async () => {
    const adapter = new ObjectionAdapter()
    const files = [{
      path: 'tests/ts/fixtures/Animal.ts',
      content: `
import * as objection from 'objection'

export class Animal extends objection.Model {
  id!: number
  species!: string

  static tableName() {
    return 'animals'
  }
}
`,
    }]

    const result = await adapter.parseChunk(chunk(files))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Animal', table_name: 'animals' })
    expect(result[0].fields.map((field) => [field.name, field.type])).toEqual([
      ['id', 'Int'],
      ['species', 'String'],
    ])
  })

  it('ignores relation-like class properties that are not scalar fields', async () => {
    const adapter = new ObjectionAdapter()
    const files = [{
      path: 'models/Person.ts',
      content: `
import { Model } from 'objection'
import Animal from './Animal'

export default class Person extends Model {
  id!: number
  pets?: Animal[]

  static tableName = 'persons'
}
`,
    }]

    const result = await adapter.parseChunk(chunk(files))

    expect(result).toHaveLength(1)
    expect(result[0].fields.map((field) => field.name)).toEqual(['id'])
  })
})
