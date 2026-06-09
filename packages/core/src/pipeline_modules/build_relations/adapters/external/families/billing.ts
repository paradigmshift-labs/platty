import type { ExternalServiceDefinition } from './types.js'

export type BillingService = 'stripe' | 'lemonsqueezy' | 'paddle'

export const BILLING_SERVICE_DEFINITIONS = {
  stripe: {
    packages: ['stripe'],
    methods: ['create', 'retrieve', 'update', 'cancel', 'del', 'delete', 'constructEvent'],
  },
  lemonsqueezy: {
    packages: ['@lemonsqueezy/lemonsqueezy.js'],
    methods: [
      'createCheckout',
      'getCheckout',
      'listCheckouts',
      'createWebhook',
      'getWebhook',
      'listWebhooks',
      'updateWebhook',
      'deleteWebhook',
      'getSubscription',
      'listSubscriptions',
      'updateSubscription',
      'cancelSubscription',
      'getOrder',
      'listOrders',
      'getLicenseKey',
      'listLicenseKeys',
      'validateLicense',
    ],
  },
  paddle: {
    packages: ['@paddle/paddle-node-sdk', 'paddle-node-sdk'],
    methods: [
      'create',
      'get',
      'list',
      'update',
      'cancel',
      'pause',
      'resume',
      'preview',
      'activate',
      'archive',
    ],
  },
} satisfies Record<BillingService, ExternalServiceDefinition>
