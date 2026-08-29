import NextAuth from 'next-auth/next'

import { getAuthOptions } from '@/lib/auth'
import { authLimiter, rateLimit } from '@/lib/security/rate-limit'

type Handler = ReturnType<typeof NextAuth>

async function handler(...args: Parameters<Handler>) {
  const options = await getAuthOptions()
  return NextAuth(options)(...args)
}

export { handler as GET }

export async function POST(...args: Parameters<Handler>) {
  const limited = await rateLimit(args[0] as unknown as Request, authLimiter)
  if (limited) return limited
  return handler(...args)
}
