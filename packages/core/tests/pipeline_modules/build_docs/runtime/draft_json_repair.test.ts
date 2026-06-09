import { describe, expect, it } from 'vitest'
import { parseDraftJsonWithRepair } from '@/pipeline_modules/build_docs/runtime/draft_json_repair.js'

describe('parseDraftJsonWithRepair', () => {
  it('parses valid JSON unchanged', () => {
    expect(parseDraftJsonWithRepair('{"title":"Order doc","count":1}')).toEqual({
      title: 'Order doc',
      count: 1,
    })
  })

  it('parses fenced JSON', () => {
    expect(parseDraftJsonWithRepair('```json\n{"title":"Order doc"}\n```')).toEqual({
      title: 'Order doc',
    })
  })

  it('parses prose-wrapped first object', () => {
    expect(parseDraftJsonWithRepair('Here is it:\n{"title":"Order doc","count":1}\nDone')).toEqual({
      title: 'Order doc',
      count: 1,
    })
  })

  it('parses trailing commas in object and array', () => {
    expect(parseDraftJsonWithRepair('{"title":"Order doc","items":[1,2,],}')).toEqual({
      title: 'Order doc',
      items: [1, 2],
    })
  })

  it('does not break braces inside strings', () => {
    expect(parseDraftJsonWithRepair('Here is it:\n{"title":"brace { inside } string","nested":{"note":"keep { }"}}\nDone')).toEqual({
      title: 'brace { inside } string',
      nested: { note: 'keep { }' },
    })
  })

  it('does not accept a later valid object when the first balanced object is invalid', () => {
    expect(() => parseDraftJsonWithRepair('prefix {not json} middle {"ok":1}')).toThrow(SyntaxError)
  })

  it('throws on unrecoverable invalid JSON', () => {
    expect(() => parseDraftJsonWithRepair('this is not json')).toThrow(SyntaxError)
  })
})
