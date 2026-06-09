import type { ExternalServiceExtractionFamily } from './extraction_types.js'
import { PRODUCT_ANALYTICS_SERVICES } from './product_analytics.js'
import type { ProductAnalyticsService } from './product_analytics_types.js'

export const PRODUCT_ANALYTICS_SERVICE_EXTRACTION: ExternalServiceExtractionFamily = {
  services: PRODUCT_ANALYTICS_SERVICES,
  targetArgs(service, context) {
    return PRODUCT_ANALYTICS_SERVICES.includes(service as ProductAnalyticsService)
      ? [context.call.firstArg]
      : null
  },
}
