import type { IdentityService } from '../../adapters/external/families/identity.js'
import type { ServiceResolver } from './types.js'

export const IDENTITY_SERVICE_RESOLVERS = {
  auth0: {
    resourceFor: (candidate) => auth0Resource(candidate.chainPath),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      const resource = auth0Resource(candidate.chainPath)
      if (method === 'create' && resource === 'users') return 'create_user'
      if ((method === 'update' || method === 'assignRoles' || method === 'removeRoles') && resource === 'users') return 'update_user'
      if ((method === 'delete' || method === 'del') && resource === 'users') return 'delete_user'
      if (method === 'get' || method === 'getAll') return 'read'
      if (method === 'create') return 'create'
      if (method === 'update') return 'update'
      if (method === 'delete' || method === 'del') return 'delete'
      return null
    },
  },
  clerk: {
    resourceFor: (candidate) => clerkResource(candidate.chainPath, candidate.targetSymbol),
    operationFor: (candidate) => {
      const method = candidate.targetSymbol
      const resource = clerkResource(candidate.chainPath, method)
      if (method === 'createUser') return 'create_user'
      if (method === 'updateUser') return 'update_user'
      if (method === 'deleteUser') return 'delete_user'
      if (method === 'createOrganization') return 'create_organization'
      if (method === 'updateOrganization') return 'update_organization'
      if (method === 'deleteOrganization') return 'delete_organization'
      if (method === 'createOrganizationInvitation' || method === 'createOrganizationInvitationBulk') return 'invite_user'
      if (method === 'revokeOrganizationInvitation') return 'revoke_invitation'
      if (resource === 'organization_memberships' && method?.startsWith('create')) return 'create_membership'
      if (resource === 'organization_memberships' && method?.startsWith('update')) return 'update_membership'
      if (resource === 'organization_memberships' && method?.startsWith('delete')) return 'delete_membership'
      if (method === 'getUser' || method === 'getUserList' || method === 'getCount' || method === 'getOrganization' || method === 'getOrganizationList') return 'read'
      return null
    },
  },
} satisfies Record<IdentityService, ServiceResolver>

function auth0Resource(chainPath: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (normalized.includes('users')) return 'users'
  if (normalized.includes('organizations')) return 'organizations'
  if (normalized.includes('roles')) return 'roles'
  if (normalized.includes('clients')) return 'clients'
  if (normalized.includes('tickets')) return 'tickets'
  return null
}

function clerkResource(chainPath: string | null | undefined, method: string | null | undefined): string | null {
  const normalized = chainPath ?? ''
  if (method?.includes('OrganizationInvitation')) return 'organization_invitations'
  if (method?.includes('OrganizationMembership')) return 'organization_memberships'
  if (method?.includes('Organization')) return 'organizations'
  if (method?.includes('User')) return 'users'
  if (normalized.includes('organizationInvitations')) return 'organization_invitations'
  if (normalized.includes('organizationMemberships')) return 'organization_memberships'
  if (normalized.includes('organizations')) return 'organizations'
  if (normalized.includes('users')) return 'users'
  return null
}
