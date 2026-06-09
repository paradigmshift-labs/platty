import { ablyRealtimeAuthFamily } from './ably.js'
import { pusherRealtimeAuthFamily } from './pusher.js'
import type { RealtimeAuthFamily } from './types.js'

export const REALTIME_AUTH_FAMILIES: readonly RealtimeAuthFamily[] = [
  pusherRealtimeAuthFamily,
  ablyRealtimeAuthFamily,
]
