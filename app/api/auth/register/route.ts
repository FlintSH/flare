import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { authLimiter, rateLimit } from '@/lib/security/rate-limit'
import { createUser } from '@/lib/users/create-user'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
})

class RegistrationConflictError extends Error {
  constructor() {
    super('User already exists')
  }
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, authLimiter)
  if (limited) return limited

  try {
    const config = await getConfig()
    if (!config.settings.general.registrations.enabled) {
      return new NextResponse(null, { status: 404 })
    }

    const json = await req.json()
    const body = registerSchema.parse(json)

    const hashedPassword = await hash(body.password, 10)

    const user = await prisma.$transaction(async (tx) => {
      const exists = await tx.user.findUnique({
        where: { email: body.email },
      })
      if (exists) {
        throw new RegistrationConflictError()
      }

      return createUser(tx, {
        email: body.email,
        name: body.name,
        password: hashedPassword,
      })
    })

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })
  } catch (error) {
    if (error instanceof RegistrationConflictError) {
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 400 }
      )
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
