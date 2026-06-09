import { BILLING_SERVICE_DEFINITIONS } from './billing.js'
import { COMMUNICATION_SERVICE_DEFINITIONS } from './communication.js'
import { IDENTITY_SERVICE_DEFINITIONS } from './identity.js'
import { PLATFORM_SERVICE_DEFINITIONS } from './platform.js'
import { PRODUCT_ANALYTICS_SERVICE_DEFINITIONS } from './product_analytics.js'
import { SEARCH_SERVICE_DEFINITIONS } from './search.js'
import { STORAGE_SERVICE_DEFINITIONS } from './storage.js'
import type { ExternalServiceDefinition } from './types.js'

export const EXTERNAL_SERVICE_FAMILY_DEFINITIONS = {
  ...BILLING_SERVICE_DEFINITIONS,
  ...COMMUNICATION_SERVICE_DEFINITIONS,
  ...IDENTITY_SERVICE_DEFINITIONS,
  ...PLATFORM_SERVICE_DEFINITIONS,
  ...PRODUCT_ANALYTICS_SERVICE_DEFINITIONS,
  ...SEARCH_SERVICE_DEFINITIONS,
  ...STORAGE_SERVICE_DEFINITIONS,
} satisfies Record<string, ExternalServiceDefinition>
