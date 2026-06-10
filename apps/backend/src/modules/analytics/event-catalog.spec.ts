import {
  ANALYTICS_FORBIDDEN_KEY_PATTERNS,
  PLATTY_EVENT_NAMES,
  isPlattyEventName,
  validateAnalyticsProperties,
} from './event-catalog'

describe('backend analytics event catalog', () => {
  it('uses stable snake_case names', () => {
    expect(PLATTY_EVENT_NAMES).toContain('client_initialized')
    expect(PLATTY_EVENT_NAMES).toContain('dashboard_page_viewed')
    for (const name of PLATTY_EVENT_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
    }
  })

  it('rejects sensitive properties', () => {
    expect(ANALYTICS_FORBIDDEN_KEY_PATTERNS.length).toBeGreaterThan(5)
    expect(() => validateAnalyticsProperties({ accessToken: 'secret' })).toThrow(/sensitive analytics key/)
    expect(() => validateAnalyticsProperties({ command: 'init', durationMs: 42 })).not.toThrow()
  })

  it('rejects sensitive keys in nested objects', () => {
    expect(() =>
      validateAnalyticsProperties({
        command: 'init',
        metadata: {
          auth: {
            accessToken: 'secret',
          },
        },
      }),
    ).toThrow(/sensitive analytics key is not allowed: metadata\.auth\.accessToken/)
  })

  it('rejects sensitive keys in array entries', () => {
    expect(() =>
      validateAnalyticsProperties({
        attempts: [
          {
            retryCount: 1,
            apiKey: 'secret',
          },
        ],
      }),
    ).toThrow(/sensitive analytics key is not allowed: attempts\[0\]\.apiKey/)
  })

  it('rejects API and access key variants', () => {
    expect(() => validateAnalyticsProperties({ apiKey: 'secret' })).toThrow(
      /sensitive analytics key is not allowed: apiKey/,
    )
    expect(() => validateAnalyticsProperties({ api_key: 'secret' })).toThrow(
      /sensitive analytics key is not allowed: api_key/,
    )
    expect(() => validateAnalyticsProperties({ accessKeyId: 'secret' })).toThrow(
      /sensitive analytics key is not allowed: accessKeyId/,
    )
  })

  it('validates known event names', () => {
    expect(isPlattyEventName('client_initialized')).toBe(true)
    expect(isPlattyEventName('Client Initialized')).toBe(false)
  })
})
