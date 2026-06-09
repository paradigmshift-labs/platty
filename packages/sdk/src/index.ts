export interface PlattyClientOptions {
  readonly baseUrl: string
  readonly getAccessToken?: () => string | null | Promise<string | null>
  readonly fetchImpl?: typeof fetch
}

export interface PlattyClient {
  readonly baseUrl: string
}

export function createPlattyClient(options: PlattyClientOptions): PlattyClient {
  return {
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
  }
}
