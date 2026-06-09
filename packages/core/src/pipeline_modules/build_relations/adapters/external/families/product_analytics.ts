import type { ExternalServiceDefinition } from './types.js'
import { AMPLITUDE_SERVICE_DEFINITION } from './product_analytics_amplitude.js'
import { MIXPANEL_SERVICE_DEFINITION } from './product_analytics_mixpanel.js'
import { POSTHOG_SERVICE_DEFINITION } from './product_analytics_posthog.js'
import { SEGMENT_SERVICE_DEFINITION } from './product_analytics_segment.js'
import type { ProductAnalyticsService } from './product_analytics_types.js'

export const PRODUCT_ANALYTICS_SERVICE_DEFINITIONS: Record<ProductAnalyticsService, ExternalServiceDefinition> = {
  posthog: POSTHOG_SERVICE_DEFINITION,
  segment: SEGMENT_SERVICE_DEFINITION,
  mixpanel: MIXPANEL_SERVICE_DEFINITION,
  amplitude: AMPLITUDE_SERVICE_DEFINITION,
}

export const PRODUCT_ANALYTICS_SERVICES = Object.keys(PRODUCT_ANALYTICS_SERVICE_DEFINITIONS) as ProductAnalyticsService[]
