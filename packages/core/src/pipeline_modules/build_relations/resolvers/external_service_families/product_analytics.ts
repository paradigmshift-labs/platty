import type { ProductAnalyticsService } from '../../adapters/external/families/product_analytics_types.js'
import { AMPLITUDE_SERVICE_RESOLVER } from './product_analytics_amplitude.js'
import { MIXPANEL_SERVICE_RESOLVER } from './product_analytics_mixpanel.js'
import { POSTHOG_SERVICE_RESOLVER } from './product_analytics_posthog.js'
import { SEGMENT_SERVICE_RESOLVER } from './product_analytics_segment.js'
import type { ServiceResolver } from './types.js'

export const PRODUCT_ANALYTICS_SERVICE_RESOLVERS: Record<ProductAnalyticsService, ServiceResolver> = {
  posthog: POSTHOG_SERVICE_RESOLVER,
  segment: SEGMENT_SERVICE_RESOLVER,
  mixpanel: MIXPANEL_SERVICE_RESOLVER,
  amplitude: AMPLITUDE_SERVICE_RESOLVER,
}
