export type ExternalServiceDefinition = {
  packages: readonly string[]
  packagePrefixes?: readonly string[]
  methods: readonly string[] | 'any'
}
