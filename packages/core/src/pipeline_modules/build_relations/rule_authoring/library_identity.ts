// build_relations/rule_authoring — library-identity classification for classify-first discovery.
//
// The relation loop must decide WHAT an imported package IS before authoring a rule, grounded in the
// package's identity (its known purpose) — NOT in call-site shapes. Inferring kind from call sites is what
// made the loop hallucinate `react.signIn()` as an "external auth SDK" on a real repo. Here a package is
// classified into a LibraryKind; only http_client / db_client / vendor_service map to a relation loop, the
// rest (ui_framework, state_mgmt, build_tool, utility) are skipped.
//
// SEED_LIBRARY_IDENTITY is a deterministic DENYLIST of well-known non-service packages (the safety net that
// stops the hallucination with zero LLM). Packages NOT in the seed are 'unknown' → an LLM classifier (a
// separate, gated, discovery-time step) decides + the result is cached into the identity rulebook so it is
// deterministic forever after. This is the build_graph pattern: a universal loop + a per-library rulebook
// that GROWS, not hand-coded detection.

export type LibraryKind =
  | 'http_client' // → api_call loop
  | 'db_client' // → db_access loop
  | 'vendor_service' // → external_service loop
  | 'ui_framework' // skip
  | 'state_mgmt' // skip
  | 'build_tool' // skip
  | 'utility' // skip
  | 'unknown' // not in the seed rulebook → defer to the LLM classifier

export interface LibraryIdentity {
  kind: LibraryKind
  reason: string
}

/** The relation kind a library maps to, or null when the library is not a relation source (skip it). */
export function relationKindFor(kind: LibraryKind): 'api_call' | 'db_access' | 'external_service' | null {
  if (kind === 'http_client') return 'api_call'
  if (kind === 'db_client') return 'db_access'
  if (kind === 'vendor_service') return 'external_service'
  return null
}

// Deterministic denylist: well-known packages that are NOT a service/client/db. Kept intentionally to the
// common, unambiguous ones — the LLM classifier handles the long tail and grows the rulebook. (No client/
// vendor entries here on purpose: discovering THOSE is the loop's job.)
export const SEED_LIBRARY_IDENTITY: Record<string, LibraryKind> = {
  // ui frameworks / view libs / component kits
  react: 'ui_framework', 'react-dom': 'ui_framework', 'react-native': 'ui_framework', preact: 'ui_framework',
  next: 'ui_framework', vue: 'ui_framework', 'vue-router': 'ui_framework', nuxt: 'ui_framework',
  svelte: 'ui_framework', '@angular/core': 'ui_framework', 'solid-js': 'ui_framework', '@chakra-ui/react': 'ui_framework',
  '@mui/material': 'ui_framework', '@emotion/react': 'ui_framework', 'styled-components': 'ui_framework',
  '@mantine/core': 'ui_framework', antd: 'ui_framework', 'react-bootstrap': 'ui_framework', '@radix-ui/react': 'ui_framework',
  // routing / data-fetching wrappers that are UI-side (covered elsewhere or non-emit)
  'next/router': 'ui_framework', 'next/link': 'ui_framework', 'next/head': 'ui_framework',
  // state management
  redux: 'state_mgmt', '@reduxjs/toolkit': 'state_mgmt', 'react-redux': 'state_mgmt', zustand: 'state_mgmt',
  jotai: 'state_mgmt', recoil: 'state_mgmt', mobx: 'state_mgmt', valtio: 'state_mgmt',
  // form / validation / general utility
  'react-hook-form': 'utility', formik: 'utility', zod: 'utility', yup: 'utility', joi: 'utility',
  lodash: 'utility', ramda: 'utility', dayjs: 'utility', 'date-fns': 'utility', clsx: 'utility',
  classnames: 'utility', uuid: 'utility', nanoid: 'utility', immer: 'utility', rxjs: 'utility',
  // build / tooling
  vite: 'build_tool', webpack: 'build_tool', esbuild: 'build_tool', rollup: 'build_tool', typescript: 'build_tool',
  eslint: 'build_tool', prettier: 'build_tool',
}

/** Deterministic classification from the seed rulebook, or null when the package is unknown (→ LLM). */
export function classifyFromSeed(pkg: string): LibraryIdentity | null {
  const kind = SEED_LIBRARY_IDENTITY[pkg]
  return kind ? { kind, reason: 'seed identity rulebook' } : null
}
