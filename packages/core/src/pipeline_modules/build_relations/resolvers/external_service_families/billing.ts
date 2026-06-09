import type { BillingService } from '../../adapters/external/families/billing.js'
import type { ServiceResolver } from './types.js'

export const BILLING_SERVICE_RESOLVERS = {
  stripe: {
    resourceFor: (candidate) => stripeResource(candidate.chainPath),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      const resource = stripeResource(candidate.chainPath)
      if (resource === 'webhooks' && method === 'constructEvent') return 'verify_webhook'
      if (resource === 'refunds' && method === 'create') return 'refund'
      if (method === 'create') return 'create'
      if (method === 'retrieve') return 'read'
      if (method === 'update') return 'update'
      if (method === 'cancel') return 'cancel'
      if (method === 'del' || method === 'delete') return 'delete'
      return null
    },
  },
  lemonsqueezy: {
    resourceFor: (candidate) => lemonSqueezyResource(candidate.chainPath, candidate.targetSymbol),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'createCheckout') return 'create_checkout'
      if (method === 'getCheckout' || method === 'listCheckouts') return 'read_checkout'
      if (method === 'createWebhook') return 'create_webhook'
      if (method === 'updateWebhook') return 'update_webhook'
      if (method === 'deleteWebhook') return 'delete_webhook'
      if (method === 'getWebhook' || method === 'listWebhooks') return 'read_webhook'
      if (method === 'updateSubscription') return 'update_subscription'
      if (method === 'cancelSubscription') return 'cancel_subscription'
      if (method === 'getSubscription' || method === 'listSubscriptions') return 'read_subscription'
      if (method === 'getOrder' || method === 'listOrders') return 'read_order'
      if (method === 'validateLicense') return 'validate_license'
      if (method === 'getLicenseKey' || method === 'listLicenseKeys') return 'read_license'
      return null
    },
  },
  paddle: {
    resourceFor: (candidate) => paddleResource(candidate.chainPath),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      const resource = paddleResource(candidate.chainPath)
      if (resource === 'transactions' && method === 'create') return 'create_transaction'
      if (resource === 'portal_sessions' && method === 'create') return 'create_portal_session'
      if (method === 'create') return 'create'
      if (method === 'get' || method === 'list') return 'read'
      if (method === 'update') return 'update'
      if (method === 'cancel') return 'cancel'
      if (method === 'pause') return 'pause'
      if (method === 'resume') return 'resume'
      if (method === 'preview') return 'preview'
      if (method === 'activate') return 'activate'
      if (method === 'archive') return 'archive'
      return null
    },
  },
} satisfies Record<BillingService, ServiceResolver>

function stripeResource(chainPath: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (normalized.includes('paymentIntents')) return 'payment_intents'
  if (normalized.includes('checkout.sessions')) return 'checkout_sessions'
  if (normalized.includes('subscriptions')) return 'subscriptions'
  if (normalized.includes('customers')) return 'customers'
  if (normalized.includes('refunds')) return 'refunds'
  if (normalized.includes('webhooks')) return 'webhooks'
  return null
}

function lemonSqueezyResource(chainPath: string | null | undefined, method: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (method?.includes('Checkout') || normalized.includes('checkout')) return 'checkouts'
  if (method?.includes('Webhook') || normalized.includes('webhook')) return 'webhooks'
  if (method?.includes('Subscription') || normalized.includes('subscription')) return 'subscriptions'
  if (method?.includes('Order') || normalized.includes('order')) return 'orders'
  if (method?.includes('License') || normalized.includes('license')) return 'license_keys'
  return null
}

function paddleResource(chainPath: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (normalized.includes('transactions')) return 'transactions'
  if (normalized.includes('customers') && normalized.includes('portalSessions')) return 'portal_sessions'
  if (normalized.includes('portalSessions') || normalized.includes('customerPortalSessions')) return 'portal_sessions'
  if (normalized.includes('customers')) return 'customers'
  if (normalized.includes('subscriptions')) return 'subscriptions'
  if (normalized.includes('prices')) return 'prices'
  if (normalized.includes('products')) return 'products'
  if (normalized.includes('discounts')) return 'discounts'
  if (normalized.includes('adjustments')) return 'adjustments'
  return null
}
