import { UserRole } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { createUser } from '@/lib/users/create-user'

export interface OidcProfile {
  sub: string
  email?: string | null
  email_verified?: boolean | null
  name?: string | null
  picture?: string | null
}

export interface OidcConfig {
  autoProvision: boolean
  allowLinking: boolean
  requireEmailVerified: boolean
}

export interface ResolvedOidcUser {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  sessionVersion: number
}

export type OidcResolveResult =
  | { ok: true; user: ResolvedOidcUser }
  | {
      ok: false
      reason:
        | 'no_email'
        | 'account_exists'
        | 'not_provisioned'
        | 'email_unverified'
    }

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  image: true,
  sessionVersion: true,
} as const

export async function resolveOidcUser(
  profile: OidcProfile,
  config: OidcConfig
): Promise<OidcResolveResult> {
  const existingBySubject = await prisma.user.findUnique({
    where: { oidcSubject: profile.sub },
    select: userSelect,
  })

  if (existingBySubject) {
    return { ok: true, user: toResolvedUser(existingBySubject) }
  }

  if (!profile.email) {
    return { ok: false, reason: 'no_email' }
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: profile.email },
    select: userSelect,
  })

  if (existingByEmail) {
    if (!config.allowLinking) {
      return { ok: false, reason: 'account_exists' }
    }

    if (config.requireEmailVerified && profile.email_verified !== true) {
      return { ok: false, reason: 'email_unverified' }
    }

    const linked = await prisma.user.update({
      where: { id: existingByEmail.id },
      data: { oidcSubject: profile.sub },
      select: userSelect,
    })

    return { ok: true, user: toResolvedUser(linked) }
  }

  if (!config.autoProvision) {
    return { ok: false, reason: 'not_provisioned' }
  }

  const created = await prisma.$transaction((tx) =>
    createUser(tx, {
      email: profile.email as string,
      name: profile.name || profile.email!.split('@')[0],
      image: profile.picture,
      oidcSubject: profile.sub,
    })
  )

  return { ok: true, user: toResolvedUser(created) }
}

function toResolvedUser(user: {
  id: string
  email: string | null
  name: string | null
  role: UserRole
  image: string | null
  sessionVersion: number
}): ResolvedOidcUser {
  return {
    id: user.id,
    email: user.email || '',
    name: user.name || '',
    image: user.image,
    role: user.role,
    sessionVersion: user.sessionVersion,
  }
}
