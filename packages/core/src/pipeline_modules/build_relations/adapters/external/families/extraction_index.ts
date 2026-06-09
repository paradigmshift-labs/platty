import { COMMUNICATION_SERVICE_EXTRACTION } from './communication_extraction.js'
import { PLATFORM_SERVICE_EXTRACTION } from './platform_extraction.js'
import { PRODUCT_ANALYTICS_SERVICE_EXTRACTION } from './product_analytics_extraction.js'
import { SEARCH_SERVICE_EXTRACTION } from './search_extraction.js'
import { STORAGE_SERVICE_EXTRACTION } from './storage_extraction.js'
import type { ExternalServiceExtractionFamily } from './extraction_types.js'

export const EXTERNAL_SERVICE_FAMILY_EXTRACTIONS: readonly ExternalServiceExtractionFamily[] = [
  COMMUNICATION_SERVICE_EXTRACTION,
  PLATFORM_SERVICE_EXTRACTION,
  PRODUCT_ANALYTICS_SERVICE_EXTRACTION,
  SEARCH_SERVICE_EXTRACTION,
  STORAGE_SERVICE_EXTRACTION,
]
