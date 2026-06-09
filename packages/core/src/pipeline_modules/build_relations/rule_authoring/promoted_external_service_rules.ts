// rule_authoring/promoted_external_service_rules — the growing RULEBOOK of external_service vendor rules
// that passed the deterministic referee. Each is the declarative form of a vendor's
// ExternalServiceDefinition (packages+methods) + ServiceResolver (resource/operation maps). Appending an
// entry here is how a discovered vendor joins the engine; the keystone test re-runs the referee on every
// entry (each promotes on its synthetic anchor + stays clean on the other vendors), so a rule arrives
// tested-by-construction. See specs/build_relations/agent-relation-rule-loop.md.

/** A vendor rule's core data — the anchor/precision fields are derived per synthetic anchor by the keystone. */
export interface VendorRuleSpec {
  id: string
  label: string
  packages: string[]
  /** methods that resolve to a resource (and thus emit a relation). */
  methods: string[]
  resolve: {
    resourceByMethod: Record<string, string>
    operationByMethod: Record<string, string>
  }
}

export const PROMOTED_EXTERNAL_SERVICE_RULES: VendorRuleSpec[] = [
  {
    id: 'rel.external_service.posthog',
    label: 'posthog',
    packages: ['posthog-node', 'posthog-js'],
    methods: ['capture', 'identify', 'group'],
    resolve: {
      resourceByMethod: { capture: 'events', identify: 'users', group: 'groups' },
      operationByMethod: { capture: 'capture_event', identify: 'identify_user', group: 'identify_group' },
    },
  },
  {
    id: 'rel.external_service.mixpanel',
    label: 'mixpanel',
    packages: ['mixpanel'],
    methods: ['track', 'track_batch', 'alias'],
    resolve: {
      resourceByMethod: { track: 'events', track_batch: 'events', alias: 'users' },
      operationByMethod: { track: 'capture_event', track_batch: 'capture_event', alias: 'alias_user' },
    },
  },
  {
    id: 'rel.external_service.segment',
    label: 'segment',
    packages: ['@segment/analytics-node', 'analytics-node'],
    methods: ['identify', 'track', 'page', 'screen', 'group', 'alias', 'flush'],
    resolve: {
      resourceByMethod: { identify: 'users', track: 'events', page: 'pages', screen: 'screens', group: 'groups', alias: 'users', flush: 'delivery' },
      operationByMethod: { identify: 'identify_user', track: 'capture_event', page: 'page_view', screen: 'screen_view', group: 'identify_group', alias: 'alias_user', flush: 'flush' },
    },
  },
  {
    id: 'rel.external_service.amplitude',
    label: 'amplitude',
    packages: ['@amplitude/analytics-node', '@amplitude/analytics-browser'],
    methods: ['track', 'identify', 'groupIdentify', 'revenue', 'flush'],
    resolve: {
      resourceByMethod: { track: 'events', identify: 'profiles', groupIdentify: 'groups', revenue: 'revenue', flush: 'delivery' },
      operationByMethod: { track: 'capture_event', identify: 'update_profile', groupIdentify: 'update_group', revenue: 'track_revenue', flush: 'flush' },
    },
  },
]
