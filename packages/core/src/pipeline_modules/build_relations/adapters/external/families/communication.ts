import type { ExternalServiceDefinition } from './types.js'

export type CommunicationService = 'email' | 'twilio' | 'slack' | 'discord' | 'novu' | 'onesignal'

export const COMMUNICATION_SERVICE_DEFINITIONS = {
  email: {
    packages: ['nodemailer', '@sendgrid/mail', 'mailgun-js', 'resend', 'postmark'],
    methods: ['sendMail', 'send', 'sendEmail'],
  },
  twilio: {
    packages: ['twilio'],
    methods: ['create'],
  },
  slack: {
    packages: ['@slack/web-api', '@slack/bolt'],
    methods: ['postMessage', 'send'],
  },
  discord: {
    packages: ['discord.js'],
    methods: ['send', 'reply'],
  },
  novu: {
    packages: ['@novu/node', '@novu/api'],
    methods: ['trigger', 'bulkTrigger', 'broadcast'],
  },
  onesignal: {
    packages: ['@onesignal/node-onesignal', 'onesignal-node'],
    methods: [
      'createNotification',
      'getNotification',
      'getNotifications',
      'cancelNotification',
      'createApp',
      'getApp',
      'getApps',
      'updateApp',
      'deleteApp',
    ],
  },
} satisfies Record<CommunicationService, ExternalServiceDefinition>
