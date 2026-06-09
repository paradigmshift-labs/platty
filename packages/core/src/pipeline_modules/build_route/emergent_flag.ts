// Emergent routing is now the DEFAULT: build_route runs evidence-gated, always-on adapter rules with no
// upfront framework-activation gate (the requires_import / min_arg_count self-gates + evaluateDetection
// without resolveConflicts). Validated behavior-equivalent to the old framework-gated path by a 389/389
// EMERGENT-vs-DEFAULT corpus sweep. Set LEGACY_ROUTING=1 to fall back to the old framework gate — kept as
// a rollback / comparison escape hatch only.
export function emergentRoutingEnabled(): boolean {
  return process.env.LEGACY_ROUTING !== '1'
}
