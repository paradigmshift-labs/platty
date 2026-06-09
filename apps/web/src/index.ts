import { createPlattyClient } from '@platty/sdk'

export function createWebClient(baseUrl: string) {
  return createPlattyClient({ baseUrl })
}
