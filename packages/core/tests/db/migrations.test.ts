import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestPlattyDb } from '../../src/db/testing.js'

describe('database migrations', () => {
  it('creates document_item_model_links for DD item to model traversal', async () => {
    const opened = createTestPlattyDb()
    try {
      const columns = opened.db.all(sql`PRAGMA table_info('document_item_model_links')`) as Array<{ name: string; notnull: number }>
      expect(columns.map((column) => column.name)).toEqual([
        'project_id',
        'item_id',
        'model_id',
        'field_name',
        'link_type',
        'role',
        'evidence_json',
        'created_by',
        'created_at',
      ])
      expect(columns.filter((column) => column.notnull === 1).map((column) => column.name)).toEqual([
        'project_id',
        'item_id',
        'model_id',
        'link_type',
        'role',
        'created_by',
        'created_at',
      ])

      const indexes = opened.db.all(sql`PRAGMA index_list('document_item_model_links')`) as Array<{ name: string; unique: number }>
      expect(indexes).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'idx_document_item_model_links_unique', unique: 1 }),
        expect.objectContaining({ name: 'idx_document_item_model_links_project' }),
        expect.objectContaining({ name: 'idx_document_item_model_links_model' }),
      ]))

      const fks = opened.db.all(sql`PRAGMA foreign_key_list('document_item_model_links')`) as Array<{ table: string; from: string; to: string; on_delete: string }>
      expect(fks).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'projects', from: 'project_id', to: 'id', on_delete: 'CASCADE' }),
        expect.objectContaining({ table: 'document_items', from: 'item_id', to: 'id', on_delete: 'CASCADE' }),
        expect.objectContaining({ table: 'models', from: 'model_id', to: 'id', on_delete: 'CASCADE' }),
      ]))
    } finally {
      await opened.cleanup()
    }
  })
})
