import type { ExternalServiceDefinition } from './types.js'

export type PlatformService =
  | 'firebase'
  | 'openai'
  | 'sentry'
  | 'mux'
  | 'sanity'
  | 'launchdarkly'
  | 'hubspot'

export const PLATFORM_SERVICE_DEFINITIONS = {
  firebase: {
    packages: [
      'firebase',
      'firebase-admin',
      '@firebase/app',
      'firebase/app',
      'firebase_messaging',
      'package:firebase_messaging/firebase_messaging.dart',
    ],
    packagePrefixes: [
      'firebase/',
      '@firebase/',
    ],
    methods: [
      'getFirestore',
      'firestore',
      'getAuth',
      'auth',
      'getStorage',
      'storage',
      'getToken',
      'deleteToken',
      'requestPermission',
      'onMessage',
      'onMessageOpenedApp',
      'onBackgroundMessage',
    ],
  },
  openai: {
    packages: ['openai', '@azure/openai'],
    methods: ['create', 'generate'],
  },
  sentry: {
    packages: ['@sentry/nextjs', '@sentry/node', '@sentry/react', '@sentry/browser'],
    methods: ['captureException', 'captureMessage', 'captureEvent'],
  },
  mux: {
    packages: ['@mux/mux-node', 'mux-node'],
    methods: [
      'create',
      'retrieve',
      'list',
      'delete',
      'update',
      'cancel',
      'createPlaybackId',
      'deletePlaybackId',
    ],
  },
  sanity: {
    packages: ['@sanity/client', 'next-sanity', 'sanity'],
    methods: [
      'fetch',
      'create',
      'createIfNotExists',
      'createOrReplace',
      'patch',
      'delete',
      'mutate',
    ],
  },
  launchdarkly: {
    packages: [
      'launchdarkly-node-server-sdk',
      '@launchdarkly/node-server-sdk',
      'launchdarkly-js-client-sdk',
      '@launchdarkly/js-client-sdk',
    ],
    methods: [
      'variation',
      'variationDetail',
      'allFlagsState',
      'identify',
      'track',
      'flush',
    ],
  },
  hubspot: {
    packages: ['@hubspot/api-client'],
    methods: [
      'create',
      'update',
      'getById',
      'getPage',
      'archive',
      'merge',
      'doSearch',
    ],
  },
} satisfies Record<PlatformService, ExternalServiceDefinition>
