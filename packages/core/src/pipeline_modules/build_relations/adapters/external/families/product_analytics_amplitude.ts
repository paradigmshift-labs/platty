import type { ExternalServiceDefinition } from './types.js'

export const AMPLITUDE_SERVICE_DEFINITION: ExternalServiceDefinition = {
  packages: ['@amplitude/analytics-node', '@amplitude/analytics-browser'],
  methods: [
    'track',
    'identify',
    'groupIdentify',
    'revenue',
    'flush',
  ],
}
