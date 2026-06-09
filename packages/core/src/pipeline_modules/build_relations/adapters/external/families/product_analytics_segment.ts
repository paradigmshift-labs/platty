import type { ExternalServiceDefinition } from './types.js'

export const SEGMENT_SERVICE_DEFINITION: ExternalServiceDefinition = {
  packages: ['@segment/analytics-node', 'analytics-node'],
  methods: [
    'identify',
    'track',
    'page',
    'screen',
    'group',
    'alias',
    'flush',
    'closeAndFlush',
  ],
}
