/**
 * The roles Better Auth's organisation plugin knows, as the reader says them.
 *
 * The English key is what the database and the plugin speak; the Spanish word
 * is what the panel, the team dialog and the invitation print. Three screens
 * were each keeping their own copy of this map.
 */
export const ROLES = ['member', 'admin', 'owner'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  member: 'miembro',
  admin: 'administrador',
  owner: 'propietario',
}

export const roleLabel = (role: string): string => ROLE_LABEL[role as Role] ?? role
