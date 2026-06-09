import type { CodeEdgeLike } from '../../../types.js'

export type RealtimeAuthMatch = {
  rawTarget: string
  method: string
  anchor: string
  adapter: string
}

export type RealtimeAuthFamily = {
  name: string
  match(edge: CodeEdgeLike): RealtimeAuthMatch | null
}
