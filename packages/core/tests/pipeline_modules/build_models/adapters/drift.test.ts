import { describe, expect, it } from 'vitest'
import { DriftAdapter } from '@/pipeline_modules/build_models/adapters/drift.js'
import type { SchemaChunk } from '@/pipeline_modules/build_models/types.js'

function chunk(content: string, path = 'medicine.dart'): SchemaChunk {
  return { files: [{ path, content }], orm: 'drift' }
}

describe('DriftAdapter', () => {
  it('parses Drift Table classes and column getter chains', async () => {
    const adapter = new DriftAdapter()
    const content = `
import 'package:drift/drift.dart';

class Medicine extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text().named('name')();
  TextColumn get amount => text().named('amount').withLength(max: 3)();
  TextColumn get type => text().named('type')();
  DateTimeColumn get time => dateTime().named('time')();
  DateTimeColumn get date => dateTime().named('date')();
  BoolColumn get isNotified => boolean().named('is_notified')();
}
`

    const result = await adapter.parseChunk(chunk(content))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Medicine',
      table_name: 'medicine',
      relations: [],
    })
    expect(result[0].fields.map((field) => field.name)).toEqual([
      'id',
      'name',
      'amount',
      'type',
      'time',
      'date',
      'isNotified',
    ])
    expect(result[0].fields.find((field) => field.name === 'id')).toMatchObject({
      type: 'Int',
      primary: true,
      nullable: false,
    })
    expect(result[0].fields.find((field) => field.name === 'time')).toMatchObject({
      type: 'DateTime',
      nullable: false,
    })
    expect(result[0].fields.find((field) => field.name === 'isNotified')).toMatchObject({
      type: 'Boolean',
      nullable: false,
    })
  })

  it('parses abstract tables, inferred late final columns, and tableName overrides', async () => {
    const adapter = new DriftAdapter()
    const content = `
import 'package:drift/drift.dart';

abstract class Albums extends Table {
  @override
  String get tableName => 'music_albums';

  late final id = integer().autoIncrement()();
  late final title = text().unique()();
  late final publishedAt = dateTime().nullable()();
}
`

    const result = await adapter.parseChunk(chunk(content, 'albums.dart'))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Albums',
      table_name: 'music_albums',
    })
    expect(result[0].fields.map((field) => [field.name, field.type, field.primary, field.nullable, field.unique])).toEqual([
      ['id', 'Int', true, false, false],
      ['title', 'String', false, false, true],
      ['publishedAt', 'DateTime', false, true, false],
    ])
  })
})
