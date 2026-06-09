import { describe, it, expect } from 'vitest'
import { evaluateWalk } from '@/pipeline_modules/build_route/f3/walk_evaluator.js'

describe('walk: object_property', () => {
  it('field 미지정 → 모든 entry', () => {
    const out = evaluateWalk({ iterate: 'object_property' }, { foo: 'bar', baz: 'qux' })
    expect(out).toEqual([
      { key: 'foo', value: 'bar' },
      { key: 'baz', value: 'qux' },
    ])
  })

  it('field 지정 → 1개 entry', () => {
    const out = evaluateWalk({ iterate: 'object_property', field: 'foo' }, { foo: 'bar', baz: 'qux' })
    expect(out).toEqual([{ key: 'foo', value: 'bar' }])
  })

  it('field 미존재 → 빈 배열', () => {
    expect(
      evaluateWalk({ iterate: 'object_property', field: 'nope' }, { foo: 'bar' }),
    ).toEqual([])
  })
})

describe('walk: array_element', () => {
  it('배열 element → key=index', () => {
    const out = evaluateWalk({ iterate: 'array_element' }, ['x', 'y', 'z'])
    expect(out).toEqual([
      { key: '0', value: 'x' },
      { key: '1', value: 'y' },
      { key: '2', value: 'z' },
    ])
  })

  it('빈 배열 → 빈 결과', () => {
    expect(evaluateWalk({ iterate: 'array_element' }, [])).toEqual([])
  })

  it('source가 배열이 아님 → 빈 배열 (graceful)', () => {
    expect(evaluateWalk({ iterate: 'array_element' }, { x: 1 })).toEqual([])
  })
})

describe('walk: map_entries', () => {
  it('object의 모든 entry', () => {
    const out = evaluateWalk(
      { iterate: 'map_entries' },
      { '/home': 'HomePage', '/about': 'AboutPage' },
    )
    expect(out).toEqual([
      { key: '/home', value: 'HomePage' },
      { key: '/about', value: 'AboutPage' },
    ])
  })

  it('source가 primitive → 빈 배열 (graceful)', () => {
    expect(evaluateWalk({ iterate: 'map_entries' }, 'not a map')).toEqual([])
    expect(evaluateWalk({ iterate: 'map_entries' }, null)).toEqual([])
    expect(evaluateWalk({ iterate: 'map_entries' }, 42)).toEqual([])
  })

  it('source가 배열 → 빈 배열 (map_entries는 객체 전용)', () => {
    expect(evaluateWalk({ iterate: 'map_entries' }, [1, 2])).toEqual([])
  })
})

describe('walk: defensive default', () => {
  it('알 수 없는 iterate 값은 빈 배열', () => {
    expect(evaluateWalk({ iterate: 'unknown' } as never, { a: 1 })).toEqual([])
  })
})
