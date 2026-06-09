import type { Adapter } from '../types.js'

export const nuxt: Adapter = {
  name: 'nuxt',
  version: '1.0.0',
  type: 'A',
  language: 'typescript',
  detection: {
    manifestFrameworkMatch: ['nuxt'],
    importSpecifiers: ['nuxt'],
  },
  minEvidence: 'manifest_only',
  priority: 40,
  entrypointRules: [
    {
      id: 'nuxt_page_file',
      kind: 'page',
      select: {
        node_type: 'file',
        file_glob: ['pages/**/*.vue', 'app/pages/**/*.vue', 'src/pages/**/*.vue'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'nuxt_server_api_file',
      kind: 'api',
      select: {
        node_type: 'file',
        file_glob: [
          'server/api/**/*.ts',
          'server/api/**/*.js',
          'server/routes/**/*.ts',
          'server/routes/**/*.js',
        ],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
  ],
}
