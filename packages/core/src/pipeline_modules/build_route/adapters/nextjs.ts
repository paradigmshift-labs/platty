// Next.js App Router — Type A (file-based)
// architecture.md §4.4

import type { Adapter } from '../types.js'

export const nextjs: Adapter = {
  name: 'nextjs',
  version: '1.0.0',
  type: 'A',
  language: 'typescript',

  detection: {
    manifestFrameworkMatch: ['nextjs'],
    importSpecifiers: ['next'],
  },
  minEvidence: 'manifest_only',
  priority: 40,
  exclusiveWith: ['react_router_v6'],

  entrypointRules: [
    {
      id: 'app_page',
      kind: 'page',
      select: {
        node_type: 'function',
        file_glob: [
          'app/**/page.tsx',
          'app/**/page.ts',
          'app/**/page.jsx',
          'app/**/page.js',
          'app/**/page.mdx',
          'src/app/**/page.tsx',
          'src/app/**/page.ts',
          'src/app/**/page.jsx',
          'src/app/**/page.js',
          'src/app/**/page.mdx',
        ],
        exclude_glob: [
          '**/layout.*',
          '**/loading.*',
          '**/error.*',
          '**/not-found.*',
        ],
        is_default_export: true,
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'app_page_file_fallback',
      kind: 'page',
      select: {
        node_type: 'file',
        file_glob: [
          'app/**/page.tsx',
          'app/**/page.ts',
          'app/**/page.jsx',
          'app/**/page.js',
          'app/**/page.mdx',
          'src/app/**/page.tsx',
          'src/app/**/page.ts',
          'src/app/**/page.jsx',
          'src/app/**/page.js',
          'src/app/**/page.mdx',
        ],
        exclude_glob: [
          '**/layout.*',
          '**/loading.*',
          '**/error.*',
          '**/not-found.*',
        ],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      // Next.js App Router route handler — named export(GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS)가 표준.
      // default export 조건 제거 — file 안의 모든 exported function이 후보.
      id: 'app_route_handler',
      kind: 'api',
      select: {
        node_type: 'function',
        file_glob: ['app/**/route.ts', 'app/**/route.js', 'src/app/**/route.ts', 'src/app/**/route.js'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'app_route_file_fallback',
      kind: 'api',
      select: {
        node_type: 'file',
        file_glob: ['app/**/route.ts', 'app/**/route.js', 'src/app/**/route.ts', 'src/app/**/route.js'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'pages_router',
      kind: 'page',
      select: {
        node_type: 'function',
        file_glob: [
          'pages/**/*.tsx',
          'pages/**/*.ts',
          'pages/**/*.jsx',
          'pages/**/*.js',
          'src/pages/**/*.tsx',
          'src/pages/**/*.ts',
          'src/pages/**/*.jsx',
          'src/pages/**/*.js',
        ],
        exclude_glob: ['pages/_app.*', 'pages/_document.*', 'pages/api/**/*', 'src/pages/_app.*', 'src/pages/_document.*', 'src/pages/api/**/*'],
        is_default_export: true,
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'pages_router_file_fallback',
      kind: 'page',
      select: {
        node_type: 'file',
        file_glob: [
          'pages/**/*.tsx',
          'pages/**/*.ts',
          'pages/**/*.jsx',
          'pages/**/*.js',
          'src/pages/**/*.tsx',
          'src/pages/**/*.ts',
          'src/pages/**/*.jsx',
          'src/pages/**/*.js',
        ],
        exclude_glob: ['pages/_app.*', 'pages/_document.*', 'pages/api/**/*', 'src/pages/_app.*', 'src/pages/_document.*', 'src/pages/api/**/*'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
    {
      id: 'pages_api_file',
      kind: 'api',
      select: {
        node_type: 'file',
        file_glob: ['pages/api/**/*.ts', 'pages/api/**/*.js', 'src/pages/api/**/*.ts', 'src/pages/api/**/*.js'],
      },
      extract: {
        path: '${file_path → path_pattern}',
        handler_node_id: '${self}',
      },
    },
  ],
}
