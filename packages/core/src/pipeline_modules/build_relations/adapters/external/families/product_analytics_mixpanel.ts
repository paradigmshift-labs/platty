import type { ExternalServiceDefinition } from './types.js'

export const MIXPANEL_SERVICE_DEFINITION: ExternalServiceDefinition = {
  packages: ['mixpanel'],
  methods: [
    'track',
    'track_batch',
    'set',
    'set_once',
    'increment',
    'append',
    'union',
    'track_charge',
    'clear_charges',
    'delete_user',
    'alias',
  ],
}
