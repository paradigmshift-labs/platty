import { describe, expect, it } from 'vitest'
import { KnexAdapter } from '@/pipeline_modules/build_models/adapters/knex.js'

describe('KnexAdapter', () => {
  it('parses createTable migration fields', async () => {
    const adapter = new KnexAdapter()
    const result = await adapter.parseChunk({
      orm: 'knex',
      files: [{
        path: 'knex/migrations/001_initial.js',
        content: `
exports.up = async function (knex) {
  await knex.schema.createTable("todos", (table) => {
    table.increments("id");
    table.string("text").notNullable();
    table.boolean("done").notNullable();
  });
};
`,
      }],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'Todos', table_name: 'todos', source_file: 'knex/migrations/001_initial.js' })
    expect(result[0].fields.map((field) => [field.name, field.type, field.primary, field.nullable])).toEqual([
      ['id', 'Int', true, true],
      ['text', 'String', false, false],
      ['done', 'Boolean', false, false],
    ])
  })

  it('parses function callbacks and common numeric/json column builders', async () => {
    const adapter = new KnexAdapter()
    const result = await adapter.parseChunk({
      orm: 'knex',
      files: [{
        path: 'knex/test/util/tableCreatorHelper.js',
        content: `
exports.up = function (knex) {
  return knex.schema.createTable('accounts', function (table) {
    table.bigIncrements('id');
    table.string('email').unique().nullable();
    table.tinyint('status').notNull();
    table.float('balance').defaultTo(0);
    table.jsonb('settings');
  });
};
`,
      }],
    })

    expect(result).toHaveLength(1)
    expect(result[0].fields.map((field) => [field.name, field.type, field.primary, field.nullable, field.unique])).toEqual([
      ['id', 'Int', true, true, false],
      ['email', 'String', false, true, true],
      ['status', 'Int', false, false, false],
      ['balance', 'Float', false, true, false],
      ['settings', 'Json', false, true, false],
    ])
  })

  it('ignores table-level schema builder options', async () => {
    const adapter = new KnexAdapter()
    const result = await adapter.parseChunk({
      orm: 'knex',
      files: [{
        path: 'knex/test/unit/schema-builder/mysql.js',
        content: `
knex.schema.createTable('users', function (table) {
  table.engine('InnoDB');
  table.charset('utf8');
  table.comment('user table');
  table.increments('id');
  table.string('email').notNullable();
});
`,
      }],
    })

    expect(result).toHaveLength(1)
    expect(result[0].fields.map((field) => field.name)).toEqual(['id', 'email'])
  })
})
