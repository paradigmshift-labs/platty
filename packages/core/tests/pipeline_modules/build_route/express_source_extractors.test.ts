import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildExpressFallbackEntries } from '@/pipeline_modules/build_route/f4/express_source_extractors.js'

describe('buildExpressFallbackEntries', () => {
  let repoPath: string

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'express-source-extractor-'))
  })

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true })
  })

  it('does not treat Express setting getters as routes', () => {
    writeFileSync(join(repoPath, 'index.js'), [
      "const express = require('express')",
      'const app = express()',
      "const test = app.get('env') === 'test'",
      "app.get('/', function (_req, res) { res.send('ok') })",
      "app.get('/next', function (_req, res) { res.send('next') })",
    ].join('\n'), 'utf-8')

    const entries = buildExpressFallbackEntries({
      repoPath,
      repoId: 'repo-1',
      stackInfo: {},
      detections: [{ framework: 'express', active: true, evidence: [] }],
      graphNodes: [
        {
          id: 'file:index.js',
          repoId: 'repo-1',
          filePath: 'index.js',
          type: 'file',
          name: 'index.js',
        },
      ] as any,
    })

    expect(entries.map((entry) => entry.fullPath).sort()).toEqual(['/', '/next'])
  })
})
