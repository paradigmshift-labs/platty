import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REALTIME_EVENT_PACKAGE_SET,
  isAblyRealtimePackage,
  isFirebaseFirestorePackage,
  isPusherRealtimePackage,
  isRealtimeEventPackage,
  isSupabaseRealtimePackage,
} from '@/pipeline_modules/build_relations/adapters/event/families/realtime_packages.js'
import { REALTIME_EVENT_FAMILIES } from '@/pipeline_modules/build_relations/adapters/event/families/realtime.js'

const REALTIME_SOURCE_PATH = resolve(
  process.cwd(),
  'src/pipeline_modules/build_relations/adapters/event/families/realtime.ts',
)
const REALTIME_PROVIDER_SOURCE_PATHS = [
  'src/pipeline_modules/build_relations/adapters/event/families/realtime_supabase.ts',
  'src/pipeline_modules/build_relations/adapters/event/families/realtime_firebase.ts',
  'src/pipeline_modules/build_relations/adapters/event/families/realtime_ably.ts',
  'src/pipeline_modules/build_relations/adapters/event/families/realtime_pusher.ts',
].map((path) => resolve(process.cwd(), path))

describe('event realtime package registry', () => {
  it('owns realtime SDK package family checks from one registry', () => {
    expect(isSupabaseRealtimePackage('@supabase/supabase-js')).toBe(true)
    expect(isFirebaseFirestorePackage('firebase/firestore')).toBe(true)
    expect(isAblyRealtimePackage('ably')).toBe(true)
    expect(isAblyRealtimePackage('ably/promises')).toBe(true)
    expect(isPusherRealtimePackage('pusher-js')).toBe(true)
    expect(isRealtimeEventPackage('pusher-js')).toBe(true)
    expect(isRealtimeEventPackage('not-realtime')).toBe(false)
    expect(REALTIME_EVENT_PACKAGE_SET.has('firebase/firestore')).toBe(true)
  })

  it('keeps realtime extraction delegated to provider family files', () => {
    const source = readFileSync(REALTIME_SOURCE_PATH, 'utf8')
    const providerSource = REALTIME_PROVIDER_SOURCE_PATHS
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(REALTIME_EVENT_FAMILIES.map((family) => family.broker)).toEqual([
      'supabase_realtime',
      'firebase_firestore',
      'ably',
      'pusher',
    ])
    expect(source).toContain('REALTIME_EVENT_FAMILIES')
    expect(source).toContain('family.detectBroker')
    expect(source).toContain('family?.extractCandidate')
    expect(source).not.toContain('isSupabaseRealtimePackage')
    expect(source).not.toContain('isFirebaseFirestorePackage')
    expect(source).not.toContain('isAblyRealtimePackage')
    expect(source).not.toContain('isPusherRealtimePackage')
    expect(providerSource).toContain('isSupabaseRealtimePackage')
    expect(providerSource).toContain('isFirebaseFirestorePackage')
    expect(providerSource).toContain('isAblyRealtimePackage')
    expect(providerSource).toContain('isPusherRealtimePackage')
    expect(source).not.toMatch(/targetSpecifier === ['"]pusher-js['"]/)
    expect(source).not.toMatch(/targetSpecifier === ['"]ably['"]/)
    expect(source).not.toMatch(/targetSpecifier === ['"]ably\/promises['"]/)
    expect(source).not.toMatch(/targetSpecifier === ['"]firebase\/firestore['"]/)
    expect(source).not.toMatch(/targetSpecifier === ['"]@supabase\/supabase-js['"]/)
  })
})
