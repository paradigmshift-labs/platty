import type { Adapter } from '../types.js'

export const sveltekit: Adapter = {
  name: 'sveltekit',
  version: '1.0.0',
  type: 'A',
  language: 'typescript',
  detection: {
    manifestFrameworkMatch: ['sveltekit'],
    importSpecifiers: ['@sveltejs/kit'],
  },
  minEvidence: 'manifest_only',
  priority: 40,
  entrypointRules: [
    {
      id: 'sveltekit_page_file',
      kind: 'page',
      select: {
        node_type: 'file',
        file_glob: ['src/routes/**/+page.svelte', 'src/routes/**/+page.ts', 'src/routes/**/+page.js'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'sveltekit_server_file',
      kind: 'api',
      select: {
        node_type: 'file',
        file_glob: ['src/routes/**/+server.ts', 'src/routes/**/+server.js'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
  ],
}
