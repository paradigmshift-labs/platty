import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SCHEDULE_PACKAGE_DEFINITIONS,
  SCHEDULE_PACKAGE_SET,
  isScheduleFamilyPackage,
  scheduleFamilyForPackage,
} from '@/pipeline_modules/build_relations/adapters/schedule/families/packages.js'

const SCHEDULE_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/schedule/nest_schedule.ts',
)
const EXTRACTION_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/schedule/families/extraction.ts',
)

describe('schedule adapter registry', () => {
  it('keeps schedule package ownership in the family registry', () => {
    expect(scheduleFamilyForPackage('@nestjs/schedule')).toBe('nest_schedule')
    expect(scheduleFamilyForPackage('node-cron')).toBe('node_cron')
    expect(scheduleFamilyForPackage('cron')).toBe('cron_package')
    expect(scheduleFamilyForPackage('agenda')).toBe('agenda')
    expect(scheduleFamilyForPackage('bree')).toBe('bree')
    expect(scheduleFamilyForPackage('bull')).toBe('bull_repeat')
    expect(scheduleFamilyForPackage('bullmq')).toBe('bull_repeat')
    expect(scheduleFamilyForPackage('not-a-scheduler')).toBeNull()
    expect(isScheduleFamilyPackage('bull', 'bull_repeat')).toBe(true)
    expect(isScheduleFamilyPackage('bullmq', 'bull_repeat')).toBe(true)
    expect(isScheduleFamilyPackage('agenda', 'bull_repeat')).toBe(false)
    expect(SCHEDULE_PACKAGE_SET.has('node-cron')).toBe(true)
    expect(SCHEDULE_PACKAGE_SET.has('bullmq')).toBe(true)
  })

  it('keeps schedule package ownership unique', () => {
    const owners = new Map<string, string>()

    for (const [family, definition] of Object.entries(SCHEDULE_PACKAGE_DEFINITIONS)) {
      for (const pkg of definition.packages) {
        expect(owners.get(pkg), pkg).toBeUndefined()
        owners.set(pkg, family)
      }
    }
  })

  it('keeps central schedule adapter delegated to family extractors', () => {
    const source = readFileSync(SCHEDULE_SOURCE_PATH, 'utf8')
    const extractionSource = readFileSync(EXTRACTION_SOURCE_PATH, 'utf8')
    const legacyCandidateSource = readFileSync(
      resolve(process.cwd(), 'src/pipeline_modules/build_relations/candidates/schedule_trigger.ts'),
      'utf8',
    )

    expect(source).toContain('extractScheduleFamilyCandidates')
    expect(source).not.toMatch(/targetSpecifier\s*===/)
    expect(source).not.toMatch(/schedulePackage\s*===/)
    expect(source).not.toContain('node-cron')
    expect(source).not.toContain('bullmq')
    expect(extractionSource).toContain('SCHEDULE_EXTRACTION_FAMILIES')
    expect(extractionSource).toContain('isScheduleFamilyPackage')
    expect(extractionSource).toContain("{ name: 'node_cron', extract: extractNodeCronCandidates }")
    expect(extractionSource).toContain("{ name: 'bull_repeat', extract: extractBullRepeatCandidates }")
    expect(extractionSource).not.toContain("pkg === 'bull'")
    expect(extractionSource).not.toContain("pkg === 'bullmq'")
    expect(legacyCandidateSource).toContain('nestScheduleAdapter.extractCandidates')
    expect(legacyCandidateSource).not.toContain('@nestjs/schedule')
  })
})
