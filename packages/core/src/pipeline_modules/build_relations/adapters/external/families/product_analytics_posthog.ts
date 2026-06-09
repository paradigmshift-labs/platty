import type { ExternalServiceDefinition } from './types.js'

export const POSTHOG_SERVICE_DEFINITION: ExternalServiceDefinition = {
  packages: ['posthog-node', 'posthog-js'],
  methods: ['capture', 'identify', 'group'],
}
