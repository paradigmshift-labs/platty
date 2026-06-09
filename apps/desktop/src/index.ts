import { createPlattyClient } from '@platty/sdk'

export function createDesktopClient(baseUrl: string) {
  return createPlattyClient({ baseUrl })
}
