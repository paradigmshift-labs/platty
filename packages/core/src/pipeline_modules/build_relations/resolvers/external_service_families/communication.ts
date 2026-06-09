import type { ServiceResolver } from './types.js'
import type { CommunicationService } from '../../adapters/external/families/communication.js'

export const COMMUNICATION_SERVICE_RESOLVERS = {
  email: {
    targetFor: () => 'email',
    resourceFor: () => null,
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'sendMail' || method === 'send' || method === 'sendEmail') return 'send'
      return null
    },
  },
  twilio: {
    resourceFor: (candidate) => twilioResource(candidate.chainPath),
    operationFor: (candidate) => {
      const resource = twilioResource(candidate.chainPath)
      if (resource === 'messages') return 'send_message'
      if (resource === 'calls') return 'call'
      return null
    },
  },
  slack: {
    targetFor: () => 'slack:message',
    resourceFor: () => 'message',
    operationFor: () => 'send_message',
  },
  discord: {
    targetFor: () => 'discord:message',
    resourceFor: () => 'message',
    operationFor: () => 'send_message',
  },
  novu: {
    targetFor: (candidate) => candidate.firstArg ? `novu:${candidate.firstArg}` : null,
    resourceFor: (candidate) => candidate.firstArg ?? null,
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'bulkTrigger') return 'bulk_trigger'
      if (method === 'broadcast') return 'broadcast'
      return 'trigger'
    },
  },
  onesignal: {
    resourceFor: (candidate) => oneSignalResource(candidate.targetSymbol),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      if (method === 'createNotification') return 'send_notification'
      if (method === 'getNotification' || method === 'getNotifications' || method === 'getApp' || method === 'getApps') return 'read'
      if (method === 'cancelNotification') return 'cancel_notification'
      if (method === 'createApp') return 'create_app'
      if (method === 'updateApp') return 'update_app'
      if (method === 'deleteApp') return 'delete_app'
      return null
    },
  },
} satisfies Record<CommunicationService, ServiceResolver>

function twilioResource(chainPath: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (normalized.includes('messages')) return 'messages'
  if (normalized.includes('calls')) return 'calls'
  return null
}

function oneSignalResource(method: string | null | undefined): string | null {
  if (
    method === 'createNotification' ||
    method === 'getNotification' ||
    method === 'getNotifications' ||
    method === 'cancelNotification'
  ) return 'notifications'
  if (
    method === 'createApp' ||
    method === 'getApp' ||
    method === 'getApps' ||
    method === 'updateApp' ||
    method === 'deleteApp'
  ) return 'apps'
  return null
}
