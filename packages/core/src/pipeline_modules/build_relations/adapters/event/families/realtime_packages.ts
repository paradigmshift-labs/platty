export const SUPABASE_REALTIME_PACKAGES = ['@supabase/supabase-js'] as const
export const FIREBASE_FIRESTORE_PACKAGES = ['firebase/firestore'] as const
export const ABLY_REALTIME_PACKAGES = ['ably', 'ably/promises'] as const
export const PUSHER_REALTIME_PACKAGES = ['pusher-js'] as const

export const REALTIME_EVENT_PACKAGES = [
  ...SUPABASE_REALTIME_PACKAGES,
  ...FIREBASE_FIRESTORE_PACKAGES,
  ...ABLY_REALTIME_PACKAGES,
  ...PUSHER_REALTIME_PACKAGES,
] as const

export const SUPABASE_REALTIME_PACKAGE_SET = new Set<string>(SUPABASE_REALTIME_PACKAGES)
export const FIREBASE_FIRESTORE_PACKAGE_SET = new Set<string>(FIREBASE_FIRESTORE_PACKAGES)
export const ABLY_REALTIME_PACKAGE_SET = new Set<string>(ABLY_REALTIME_PACKAGES)
export const PUSHER_REALTIME_PACKAGE_SET = new Set<string>(PUSHER_REALTIME_PACKAGES)
export const REALTIME_EVENT_PACKAGE_SET = new Set<string>(REALTIME_EVENT_PACKAGES)

export function isSupabaseRealtimePackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && SUPABASE_REALTIME_PACKAGE_SET.has(pkg))
}

export function isFirebaseFirestorePackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && FIREBASE_FIRESTORE_PACKAGE_SET.has(pkg))
}

export function isAblyRealtimePackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && ABLY_REALTIME_PACKAGE_SET.has(pkg))
}

export function isPusherRealtimePackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && PUSHER_REALTIME_PACKAGE_SET.has(pkg))
}

export function isRealtimeEventPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && REALTIME_EVENT_PACKAGE_SET.has(pkg))
}
