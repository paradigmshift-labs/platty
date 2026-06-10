export const PLATTY_EVENT_NAMES = [
  'client_initialized',
  'anonymous_session_started',
  'auth_token_refreshed',
  'user_identified',
  'settings_loaded',
  'settings_updated',
  'consent_recorded',
  'analytics_batch_flushed',
  'cli_command_started',
  'cli_command_completed',
  'dashboard_page_viewed',
  'dashboard_action_clicked',
  'core_run_started',
  'core_run_completed',
  'core_run_failed',
] as const

export type PlattyEventName = (typeof PLATTY_EVENT_NAMES)[number]

const EVENT_NAME_SET = new Set<string>(PLATTY_EVENT_NAMES)

export interface PlattyEventContext {
  readonly app?: Record<string, unknown>
  readonly device?: Record<string, unknown>
  readonly os?: Record<string, unknown>
  readonly page?: Record<string, unknown>
  readonly locale?: string
  readonly timezone?: string
}

export interface PlattyEventEnvelope {
  readonly eventId: string
  readonly eventName: PlattyEventName
  readonly occurredAt: string
  readonly analyticsSessionId?: string
  readonly properties?: Record<string, unknown>
  readonly context?: PlattyEventContext
}

export const ANALYTICS_FORBIDDEN_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /private[_-]?key/i,
  /prompt/i,
  /source[_-]?code/i,
  /raw[_-]?body/i,
  /email/i,
  /file[_-]?path/i,
  /git[_-]?remote/i,
] as const

export function isPlattyEventName(value: string): value is PlattyEventName {
  return EVENT_NAME_SET.has(value)
}

function isPlainAnalyticsObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function validateAnalyticsProperties(properties: Record<string, unknown> = {}): void {
  validateAnalyticsValue(properties, '', new WeakSet<object>())
}

function validateAnalyticsValue(value: unknown, path: string, seen: WeakSet<object>): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return
    }

    seen.add(value)
    value.forEach((item, index) => validateAnalyticsValue(item, `${path}[${index}]`, seen))
    return
  }

  if (!isPlainAnalyticsObject(value)) {
    return
  }

  if (seen.has(value)) {
    return
  }

  seen.add(value)
  for (const [key, nestedValue] of Object.entries(value)) {
    const keyPath = path ? `${path}.${key}` : key
    if (ANALYTICS_FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new Error(`sensitive analytics key is not allowed: ${keyPath}`)
    }

    validateAnalyticsValue(nestedValue, keyPath, seen)
  }
}
