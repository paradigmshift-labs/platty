import { BILLING_SERVICE_RESOLVERS } from './billing.js'
import { COMMUNICATION_SERVICE_RESOLVERS } from './communication.js'
import { IDENTITY_SERVICE_RESOLVERS } from './identity.js'
import { PLATFORM_SERVICE_RESOLVERS } from './platform.js'
import { PRODUCT_ANALYTICS_SERVICE_RESOLVERS } from './product_analytics.js'
import { SEARCH_SERVICE_RESOLVERS } from './search.js'
import { STORAGE_SERVICE_RESOLVERS } from './storage.js'
import type { ServiceResolver } from './types.js'

export const EXTERNAL_SERVICE_FAMILY_RESOLVERS = {
  ...BILLING_SERVICE_RESOLVERS,
  ...COMMUNICATION_SERVICE_RESOLVERS,
  ...IDENTITY_SERVICE_RESOLVERS,
  ...PLATFORM_SERVICE_RESOLVERS,
  ...PRODUCT_ANALYTICS_SERVICE_RESOLVERS,
  ...SEARCH_SERVICE_RESOLVERS,
  ...STORAGE_SERVICE_RESOLVERS,
} satisfies Record<string, ServiceResolver>
