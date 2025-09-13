import { z } from 'zod'

// JWT claims schema (accepts legacy role string as fallback)
const ClaimsSchema = z.object({
  sub: z.string().optional(),
  userId: z.string().optional(),
  email: z.string().email().optional(),
  schoolId: z.string().optional(),
  roles: z.array(z.string()).optional(),
  role: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
  iss: z.string().optional(),
})

export type AuthContext = {
  sub: string
  email?: string
  schoolId?: string
  roles: string[]
  permissions: string[]
  iat?: number
  exp?: number
  iss?: string
}

export function parseClaims(input: unknown): AuthContext {
  const parsed = ClaimsSchema.safeParse(input)
  if (!parsed.success) {
    // Return minimal empty context; middleware treats as unauthenticated
    return { sub: '', roles: [], permissions: [] }
  }
  const c = parsed.data
  const roles = (c.roles && c.roles.length ? c.roles : (c.role ? [c.role] : [])) as string[]
  return {
    sub: c.sub || c.userId || '',
    email: c.email,
    schoolId: c.schoolId,
    roles,
    permissions: c.permissions ?? [],
    iat: c.iat,
    exp: c.exp,
    iss: c.iss,
  }
}

export function hasAnyRole(ctx: AuthContext | undefined, allowed: string[]): boolean {
  if (!ctx) return false
  return ctx.roles.some((r) => allowed.includes(r))
}

export function isSuperAdmin(ctx: AuthContext | undefined): boolean {
  return !!ctx && ctx.roles.includes('super_admin')
}

