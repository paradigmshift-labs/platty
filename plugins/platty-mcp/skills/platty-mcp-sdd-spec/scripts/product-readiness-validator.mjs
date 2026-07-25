#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import {
  canonicalJson,
  parseSddArtifact,
} from '../../using-platty-mcp/scripts/sdd-artifacts.mjs'

const PRD_KEYS = new Set(['id', 'type', 'status', 'projectId', 'outputLanguage'])
const STORIES_KEYS = new Set([...PRD_KEYS, 'derivedFrom'])
const AUGMENT_ID = /^(?:R|D|H|O)-\d+$/
const CANONICAL_SCENARIO_ID = /^US-\d+-S\d+$/

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function finding(code, message) {
  return { code, severity: 'critical', message }
}

function normalizedCell(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function tableRowsById(body) {
  const rows = new Map()
  const duplicates = new Set()
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) continue
    const cells = line.slice(1, -1).split('|').map(normalizedCell)
    const id = cells[0]
    if (!AUGMENT_ID.test(id)) continue
    if (rows.has(id)) duplicates.add(id)
    else rows.set(id, cells)
  }
  return { duplicates, rows }
}

function metadataShapeValid(metadata, allowedKeys) {
  return Object.keys(metadata).every((key) => allowedKeys.has(key))
}

function scenarioIds(body) {
  return [...body.matchAll(/^###\s+(?:시나리오\s+)?([A-Za-z0-9-]+)(?:[.\s]|$)/gm)]
    .map((match) => match[1])
}

function main() {
  const prdPath = argument('--prd')
  const storiesPath = argument('--stories')
  const augmentPath = argument('--augment-prd')
  if (!prdPath || !storiesPath || !process.argv.includes('--json')) {
    process.stderr.write(`Usage: ${basename(process.argv[1])} --prd <prd.md> --stories <user_stories.md> [--augment-prd <original-prd.md>] --json\n`)
    process.exit(2)
  }

  const criticalFindings = []
  let prd
  let stories
  let augment
  try {
    prd = parseSddArtifact('prd.md', readFileSync(resolve(prdPath), 'utf8'))
    stories = parseSddArtifact('user_stories.md', readFileSync(resolve(storiesPath), 'utf8'))
    if (augmentPath) {
      augment = parseSddArtifact('augment-prd.md', readFileSync(resolve(augmentPath), 'utf8'))
    }
  } catch (error) {
    criticalFindings.push(finding(error.code ?? 'INVALID_PRODUCT_ARTIFACT', error.message))
  }

  if (prd && stories) {
    const prdMetadataValid = metadataShapeValid(prd.metadata, PRD_KEYS)
      && prd.metadata.type === 'sdd-request'
      && typeof prd.metadata.id === 'string'
      && prd.metadata.id.length > 0
      && typeof prd.metadata.projectId === 'string'
      && prd.metadata.projectId.length > 0
      && typeof prd.metadata.outputLanguage === 'string'
      && prd.metadata.outputLanguage.length > 0
      && ['draft', 'approved'].includes(prd.metadata.status)
    if (!prdMetadataValid) {
      criticalFindings.push(finding(
        'PRD_METADATA_INVALID',
        'prd.md must use only canonical product frontmatter with type sdd-request.',
      ))
    }

    const storiesMetadataValid = metadataShapeValid(stories.metadata, STORIES_KEYS)
      && stories.metadata.id === prd.metadata.id
      && stories.metadata.type === 'sdd-stories'
      && stories.metadata.status === prd.metadata.status
      && stories.metadata.projectId === prd.metadata.projectId
      && stories.metadata.outputLanguage === prd.metadata.outputLanguage
      && stories.metadata.derivedFrom === 'prd.md'
    if (!storiesMetadataValid) {
      criticalFindings.push(finding(
        'STORIES_METADATA_INVALID',
        'user_stories.md must share the PRD spec id/status/project and use type sdd-stories with derivedFrom prd.md.',
      ))
    }

    const scenarios = scenarioIds(stories.body)
    if (scenarios.length === 0 || scenarios.some((id) => !CANONICAL_SCENARIO_ID.test(id))) {
      criticalFindings.push(finding(
        'STORY_SCENARIO_ID_INVALID',
        'Every persisted scenario heading must use a stable US-NN-SNN id.',
      ))
    }
  }

  if (prd && augment) {
    if (prd.metadata.id !== augment.metadata.id) {
      criticalFindings.push(finding(
        'AUGMENT_SPEC_ID_CHANGED',
        'AUGMENT output must preserve the supplied PRD spec id.',
      ))
    }
    const inputRows = tableRowsById(augment.body)
    const outputRows = tableRowsById(prd.body)
    if (inputRows.duplicates.size > 0 || outputRows.duplicates.size > 0) {
      criticalFindings.push(finding(
        'AUGMENT_DUPLICATE_ID',
        'AUGMENT input and output must contain each R/D/H/O id at most once.',
      ))
    }
    for (const [id, inputCells] of inputRows.rows) {
      const outputCells = outputRows.rows.get(id)
      if (!outputCells) {
        criticalFindings.push(finding(
          'AUGMENT_ROW_MISSING',
          `AUGMENT output removed existing ${id}.`,
        ))
        continue
      }
      const changed = outputCells.length < inputCells.length
        || inputCells.some((cell, index) => cell !== outputCells[index])
      if (changed) {
        criticalFindings.push(finding(
          'AUGMENT_ROW_CHANGED',
          `AUGMENT output changed existing ${id}; append trace columns or new ids without rewriting original cells.`,
        ))
      }
    }
  }

  const uniqueCodes = new Set(criticalFindings.map(({ code }) => code))
  const score = Math.max(0, 100 - (uniqueCodes.size * 25))
  const artifacts = {
    prd: resolve(prdPath),
    stories: resolve(storiesPath),
  }
  if (augmentPath) artifacts.augmentInput = resolve(augmentPath)
  const report = {
    mode: augment ? 'augment' : 'product',
    verdict: criticalFindings.length === 0 ? 'PASS' : 'NEEDS_WORK',
    readiness: criticalFindings.length === 0 ? 'ready' : 'blocked',
    score,
    criticalFindings,
    warnings: [],
    artifacts,
  }
  process.stdout.write(`${canonicalJson(report)}\n`)
  if (criticalFindings.length > 0) process.exitCode = 1
}

main()
