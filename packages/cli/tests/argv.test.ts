import { describe, expect, it } from 'vitest'
import { commandArgvAfter, stripGlobalFlags } from '../src/argv.js'

describe('argv helpers', () => {
  it('strips global json/project/root flags', () => {
    expect(stripGlobalFlags(['--json', '--project', 'p1', 'repo', 'list'])).toEqual(['repo', 'list'])
  })

  it('returns argv after command root', () => {
    expect(commandArgvAfter('repo', ['repo', 'add', '.'])).toEqual(['add', '.'])
  })
})
