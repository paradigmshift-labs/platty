import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const HTTP_CLIENT_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/http_clients.ts',
)
const REALTIME_AUTH_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/realtime_auth.ts',
)
const REALTIME_AUTH_FAMILIES_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/realtime_auth_families/families.ts',
)
const REALTIME_AUTH_ABLY_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/realtime_auth_families/ably.ts',
)
const REALTIME_AUTH_PUSHER_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/api/realtime_auth_families/pusher.ts',
)

describe('API realtime auth adapter registry', () => {
  it('keeps realtime SDK auth endpoint extraction outside the generic HTTP client adapter', () => {
    const httpClientSource = readFileSync(HTTP_CLIENT_SOURCE_PATH, 'utf8')
    const realtimeAuthSource = readFileSync(REALTIME_AUTH_SOURCE_PATH, 'utf8')
    const familiesSource = readFileSync(REALTIME_AUTH_FAMILIES_PATH, 'utf8')
    const ablySource = readFileSync(REALTIME_AUTH_ABLY_PATH, 'utf8')
    const pusherSource = readFileSync(REALTIME_AUTH_PUSHER_PATH, 'utf8')

    expect(httpClientSource).toContain('matchRealtimeAuthApiCandidate')
    expect(httpClientSource).not.toContain('pusher-js')
    expect(httpClientSource).not.toContain('ably/promises')
    expect(httpClientSource).not.toContain('channelAuthorization')
    expect(httpClientSource).not.toContain('authUrl')
    expect(realtimeAuthSource).toContain('REALTIME_AUTH_FAMILIES')
    expect(realtimeAuthSource).not.toContain('pusher-js')
    expect(realtimeAuthSource).not.toContain('ably/promises')
    expect(realtimeAuthSource).not.toContain('channelAuthorization')
    expect(realtimeAuthSource).not.toContain('authUrl')
    expect(realtimeAuthSource).not.toContain('matchPusherAuth')
    expect(realtimeAuthSource).not.toContain('matchAblyAuth')
    expect(familiesSource).toContain('pusherRealtimeAuthFamily')
    expect(familiesSource).toContain('ablyRealtimeAuthFamily')
    expect(ablySource).toContain('ably/promises')
    expect(ablySource).toContain('authUrl')
    expect(pusherSource).toContain('pusher-js')
    expect(pusherSource).toContain('channelAuthorization')
  })
})
