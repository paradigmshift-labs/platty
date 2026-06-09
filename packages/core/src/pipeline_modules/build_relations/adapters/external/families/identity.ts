import type { ExternalServiceDefinition } from './types.js'

export type IdentityService = 'auth0' | 'clerk'

export const IDENTITY_SERVICE_DEFINITIONS = {
  auth0: {
    packages: ['auth0', '@auth0/nextjs-auth0'],
    methods: ['create', 'update', 'delete', 'del', 'get', 'getAll', 'assignRoles', 'removeRoles'],
  },
  clerk: {
    packages: ['@clerk/nextjs', '@clerk/nextjs/server', '@clerk/backend'],
    methods: [
      'createUser',
      'updateUser',
      'deleteUser',
      'getUser',
      'getUserList',
      'getCount',
      'createOrganization',
      'updateOrganization',
      'deleteOrganization',
      'getOrganization',
      'getOrganizationList',
      'createOrganizationInvitation',
      'createOrganizationInvitationBulk',
      'revokeOrganizationInvitation',
      'createOrganizationMembership',
      'updateOrganizationMembership',
      'deleteOrganizationMembership',
    ],
  },
} satisfies Record<IdentityService, ExternalServiceDefinition>
