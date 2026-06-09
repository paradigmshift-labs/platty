import type { RelationCandidate, SemanticIndex, ExtractedRelation } from '../types.js'

export function resolveScheduleTriggerCandidate(
  candidate: RelationCandidate,
  _index: SemanticIndex,
): ExtractedRelation | null {
  const symbol = candidate.targetSymbol
  const payload: Record<string, unknown> = { ...candidate.payload }

  if (symbol === 'Cron') {
    payload.schedule_type = 'cron'
    if (candidate.firstArg) payload.cron = candidate.firstArg
  } else if (symbol === 'Interval') {
    payload.schedule_type = 'interval'
    const interval = parseNumber(candidate.firstArg)
    if (interval != null) payload.interval_ms = interval
  } else if (symbol === 'Timeout') {
    payload.schedule_type = 'timeout'
    const timeout = parseNumber(candidate.firstArg)
    if (timeout != null) payload.timeout_ms = timeout
  } else if (symbol === 'addCronJob') {
    payload.schedule_type = 'cron'
    if (candidate.firstArg) payload.job_name = candidate.firstArg
  } else if (symbol === 'schedule' || symbol === 'CronJob') {
    payload.schedule_type = 'cron'
    if (candidate.firstArg) payload.cron = candidate.firstArg
  } else if (symbol === 'every') {
    payload.schedule_type = inferScheduleType(candidate.firstArg)
    if (payload.schedule_type === 'cron' && candidate.firstArg) payload.cron = candidate.firstArg
    if (payload.schedule_type === 'interval' && candidate.firstArg) payload.interval = candidate.firstArg
  } else if (symbol === 'Bree') {
    const scheduleType = typeof payload.schedule_type === 'string' ? payload.schedule_type : inferScheduleType(candidate.firstArg)
    payload.schedule_type = scheduleType
    if (scheduleType === 'cron' && candidate.firstArg) payload.cron = candidate.firstArg
    if (scheduleType === 'interval' && candidate.firstArg) payload.interval = candidate.firstArg
  } else if (symbol === 'bullRepeat') {
    const scheduleType = typeof payload.schedule_type === 'string' ? payload.schedule_type : inferScheduleType(candidate.firstArg)
    payload.schedule_type = scheduleType
    if (scheduleType === 'cron' && candidate.firstArg) payload.cron = candidate.firstArg
    if (scheduleType === 'interval' && candidate.firstArg) payload.interval_ms = parseNumber(candidate.firstArg)
  } else if (symbol === 'Scheduled') {
    // Spring @Scheduled — schedule_type is decided by the spring_scheduled family from the named arg.
    const scheduleType = typeof payload.schedule_type === 'string' ? payload.schedule_type : null
    if (scheduleType === 'cron' && candidate.firstArg) {
      payload.cron = candidate.firstArg
    } else if (scheduleType === 'interval') {
      const ms = parseNumber(candidate.firstArg)
      if (ms != null) payload.interval_ms = ms
      else if (candidate.firstArg) payload.interval = candidate.firstArg
    }
  } else {
    return null
  }

  return {
    sourceNodeId: candidate.sourceNodeId,
    kind: 'schedule_trigger',
    target: null,
    operation: 'trigger',
    canonicalTarget: null,
    payload,
    evidenceNodeIds: candidate.evidenceNodeIds,
    confidence: 'high',
    unresolvedReason: null,
  }
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function inferScheduleType(value: string | null | undefined): 'cron' | 'interval' {
  if (!value) return 'interval'
  return value.trim().split(/\s+/).length >= 5 ? 'cron' : 'interval'
}
