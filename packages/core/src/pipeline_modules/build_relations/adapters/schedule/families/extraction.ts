import type { CodeEdgeLike, RelationCandidate, SemanticIndex } from '../../../types.js'
import { SCHEDULE_PACKAGE_SET, isScheduleFamilyPackage, type SchedulePackage } from './packages.js'
import type { ScheduleExtractionContext, ScheduleExtractionFamily } from './types.js'

const NEST_SCHEDULE_DECORATORS = new Set(['Cron', 'Interval', 'Timeout'])

const SCHEDULE_EXTRACTION_FAMILIES: readonly ScheduleExtractionFamily[] = [
  { name: 'nest_schedule', extract: extractNestScheduleCandidates },
  { name: 'node_cron', extract: extractNodeCronCandidates },
  { name: 'cron_package', extract: extractCronPackageCandidates },
  { name: 'agenda', extract: extractAgendaCandidates },
  { name: 'bree', extract: extractBreeCandidates },
  { name: 'bull_repeat', extract: extractBullRepeatCandidates },
  { name: 'spring_scheduled', extract: extractSpringScheduledCandidates },
]

export function extractScheduleFamilyCandidates(args: {
  index: SemanticIndex
  node: ScheduleExtractionContext['node']
}): RelationCandidate[] {
  const { index, node } = args
  const packageImports = collectSchedulePackageImports(node.id, index)
  if (packageImports.length === 0) return []

  const context: ScheduleExtractionContext = {
    index,
    node,
    packageImports,
    decorators: index.decoratorsBySource.get(node.id) ?? [],
    calls: index.callsBySource.get(node.id) ?? [],
  }

  return SCHEDULE_EXTRACTION_FAMILIES.flatMap((family) => family.extract(context))
}

function extractNestScheduleCandidates(context: ScheduleExtractionContext): RelationCandidate[] {
  if (!hasPackage(context, '@nestjs/schedule')) return []

  const candidates: RelationCandidate[] = []
  for (const dec of context.decorators) {
    if (!dec.targetSymbol || !NEST_SCHEDULE_DECORATORS.has(dec.targetSymbol)) continue
    candidates.push({
      kind: 'schedule_trigger',
      sourceNodeId: context.node.id,
      evidenceNodeIds: [`edge:${dec.id}`],
      targetSymbol: dec.targetSymbol,
      firstArg: dec.firstArg,
      payload: { decorator: dec.targetSymbol, adapter: 'nest_schedule' },
    })
  }

  for (const call of context.calls) {
    if (call.targetSymbol !== 'addCronJob') continue
    candidates.push({
      kind: 'schedule_trigger',
      sourceNodeId: context.node.id,
      evidenceNodeIds: [`edge:${call.id}`],
      targetSymbol: call.targetSymbol,
      firstArg: call.firstArg,
      chainPath: call.chainPath,
      payload: { programmatic: true, adapter: 'nest_schedule' },
    })
  }

  return candidates
}

function extractNodeCronCandidates(context: ScheduleExtractionContext): RelationCandidate[] {
  if (!hasPackage(context, 'node-cron')) return []

  return context.calls
    .filter((call) => call.targetSymbol === 'schedule' && call.firstArg)
    .map((call) => ({
      kind: 'schedule_trigger',
      sourceNodeId: context.node.id,
      evidenceNodeIds: [`edge:${call.id}`],
      targetSymbol: call.targetSymbol,
      firstArg: call.firstArg,
      chainPath: call.chainPath,
      payload: { package: 'node-cron', adapter: 'node_cron' },
    }))
}

function extractCronPackageCandidates(context: ScheduleExtractionContext): RelationCandidate[] {
  if (!hasPackage(context, 'cron')) return []

  return context.calls
    .filter((call) => call.targetSymbol === 'CronJob' && call.firstArg)
    .map((call) => ({
      kind: 'schedule_trigger',
      sourceNodeId: context.node.id,
      evidenceNodeIds: [`edge:${call.id}`],
      targetSymbol: call.targetSymbol,
      firstArg: call.firstArg,
      chainPath: call.chainPath,
      payload: { package: 'cron', adapter: 'cron_package' },
    }))
}

function extractAgendaCandidates(context: ScheduleExtractionContext): RelationCandidate[] {
  if (!hasPackage(context, 'agenda')) return []

  return context.calls
    .filter((call) => call.targetSymbol === 'every' && call.firstArg)
    .map((call) => ({
      kind: 'schedule_trigger',
      sourceNodeId: context.node.id,
      evidenceNodeIds: [`edge:${call.id}`],
      targetSymbol: call.targetSymbol,
      firstArg: call.firstArg,
      chainPath: call.chainPath,
      payload: { package: 'agenda', job_name: secondLiteralString(call.literalArgs), adapter: 'agenda' },
    }))
}

function extractBreeCandidates(context: ScheduleExtractionContext): RelationCandidate[] {
  if (!hasPackage(context, 'bree')) return []

  const candidates: RelationCandidate[] = []
  for (const call of context.calls) {
    if (call.targetSymbol !== 'Bree') continue
    for (const job of extractBreeJobs(call.literalArgs)) {
      candidates.push({
        kind: 'schedule_trigger',
        sourceNodeId: context.node.id,
        evidenceNodeIds: [`edge:${call.id}`],
        targetSymbol: call.targetSymbol,
        firstArg: job.cron ?? job.interval,
        chainPath: call.chainPath,
        payload: {
          package: 'bree',
          job_name: job.name,
          schedule_type: job.cron ? 'cron' : 'interval',
          adapter: 'bree',
        },
      })
    }
  }
  return candidates
}

function extractBullRepeatCandidates(context: ScheduleExtractionContext): RelationCandidate[] {
  const bullPackage = context.packageImports.find((pkg) => isScheduleFamilyPackage(pkg, 'bull_repeat'))
  if (!bullPackage) return []

  const candidates: RelationCandidate[] = []
  for (const call of context.calls) {
    if (call.targetSymbol !== 'add') continue
    const repeat = extractBullRepeat(call.literalArgs)
    if (!repeat) continue
    candidates.push({
      kind: 'schedule_trigger',
      sourceNodeId: context.node.id,
      evidenceNodeIds: [`edge:${call.id}`],
      targetSymbol: 'bullRepeat',
      firstArg: repeat.cron ?? repeat.every,
      chainPath: call.chainPath,
      payload: {
        package: bullPackage,
        job_name: call.firstArg,
        schedule_type: repeat.cron ? 'cron' : 'interval',
        adapter: 'bull_repeat',
      },
    })
  }
  return candidates
}

function extractSpringScheduledCandidates(context: ScheduleExtractionContext): RelationCandidate[] {
  if (!context.packageImports.some((pkg) => isScheduleFamilyPackage(pkg, 'spring_scheduled'))) return []

  const candidates: RelationCandidate[] = []
  for (const dec of context.decorators) {
    if (dec.targetSymbol !== 'Scheduled') continue
    // JVM annotation args are literal_args = { positional, named }; the trigger lives in a named arg.
    const named = parseJvmNamedArgs(dec.literalArgs)
    const cron = typeof named.cron === 'string' ? named.cron : null
    const interval = firstNamedString(named, ['fixedRate', 'fixedRateString', 'fixedDelay', 'fixedDelayString'])
    const scheduleType = cron ? 'cron' : interval != null ? 'interval' : null
    if (!scheduleType) continue // @Scheduled with no recognizable trigger arg (e.g. cron via SpEL only)
    candidates.push({
      kind: 'schedule_trigger',
      sourceNodeId: context.node.id,
      evidenceNodeIds: [`edge:${dec.id}`],
      targetSymbol: 'Scheduled',
      firstArg: cron ?? interval,
      payload: { decorator: 'Scheduled', schedule_type: scheduleType, adapter: 'spring_scheduled' },
    })
  }
  return candidates
}

function parseJvmNamedArgs(literalArgs: string | null | undefined): Record<string, unknown> {
  if (!literalArgs) return {}
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    if (isRecord(parsed) && isRecord(parsed.named)) return parsed.named
    return {}
  } catch {
    return {}
  }
}

function firstNamedString(named: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = named[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

function collectSchedulePackageImports(nodeId: string, index: SemanticIndex): SchedulePackage[] {
  const node = index.nodesById.get(nodeId)
  const fileNodes = node ? (index.nodesByFile.get(node.filePath) ?? []) : []
  const packages: SchedulePackage[] = []
  for (const fileNode of fileNodes) {
    for (const edge of index.importsBySource.get(fileNode.id) ?? []) {
      const pkg = edge.targetSpecifier as SchedulePackage | null
      if (!pkg || !SCHEDULE_PACKAGE_SET.has(pkg)) continue
      if (!packages.includes(pkg)) {
        packages.push(pkg)
      }
    }
  }
  return packages
}

function hasPackage(context: ScheduleExtractionContext, pkg: SchedulePackage): boolean {
  return context.packageImports.includes(pkg)
}

function secondLiteralString(literalArgs: string | null | undefined): string | null {
  const args = parseLiteralArgs(literalArgs)
  return typeof args[1] === 'string' ? args[1] : null
}

function extractBreeJobs(literalArgs: string | null | undefined): Array<{
  name: string | null
  cron: string | null
  interval: string | null
}> {
  const [first] = parseLiteralArgs(literalArgs)
  if (!isRecord(first) || !Array.isArray(first.jobs)) return []

  return first.jobs
    .filter(isRecord)
    .map((job) => ({
      name: typeof job.name === 'string' ? job.name : null,
      cron: typeof job.cron === 'string' ? job.cron : null,
      interval: typeof job.interval === 'string' ? job.interval : null,
    }))
    .filter((job) => job.cron || job.interval)
}

function extractBullRepeat(literalArgs: string | null | undefined): { cron: string | null; every: string | null } | null {
  const args = parseLiteralArgs(literalArgs)
  const repeatOptions = args.find((arg) => isRecord(arg) && isRecord(arg.repeat)) as Record<string, unknown> | undefined
  const repeat = isRecord(repeatOptions?.repeat) ? repeatOptions.repeat : null
  if (!repeat) return null

  const cron = typeof repeat.cron === 'string' ? repeat.cron : null
  const every = typeof repeat.every === 'number' || typeof repeat.every === 'string' ? String(repeat.every) : null
  return cron || every ? { cron, every } : null
}

function parseLiteralArgs(literalArgs: string | null | undefined): unknown[] {
  if (!literalArgs) return []
  try {
    const parsed = JSON.parse(literalArgs) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
