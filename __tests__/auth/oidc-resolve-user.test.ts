import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  transaction: vi.fn(),
  createUser: vi.fn(),
}))

vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/users/create-user', () => ({
  createUser: mocks.createUser,
}))

const { resolveOidcUser } = await import('@/lib/auth/oidc-resolve-user')
type OidcConfig = Parameters<typeof resolveOidcUser>[1]
type OidcProfile = Parameters<typeof resolveOidcUser>[0]

function makeConfig(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    autoProvision: true,
    allowLinking: true,
    requireEmailVerified: true,
    ...overrides,
  }
}

function makeProfile(overrides: Partial<OidcProfile> = {}): OidcProfile {
  return {
    sub: 'idp-subject-1',
    email: 'user@example.com',
    email_verified: true,
    name: 'Example User',
    ...overrides,
  }
}

const dbUser = {
  id: 'existing-user-id',
  email: 'user@example.com',
  name: 'Existing User',
  role: 'USER' as const,
  image: null,
  sessionVersion: 1,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({}))
})

describe('resolveOidcUser', () => {
  it('resolves an existing user by oidcSubject without any email checks', async () => {
    mocks.userFindUnique.mockResolvedValueOnce(dbUser)

    const result = await resolveOidcUser(
      makeProfile({ email: undefined, email_verified: false }),
      makeConfig({ requireEmailVerified: true })
    )

    expect(result).toEqual({
      ok: true,
      user: expect.objectContaining({ id: dbUser.id }),
    })
    expect(mocks.userFindUnique).toHaveBeenCalledTimes(1)
    expect(mocks.userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { oidcSubject: 'idp-subject-1' } })
    )
  })

  it('rejects with no_email when the provider omits an email', async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null) // oidcSubject lookup misses

    const result = await resolveOidcUser(
      makeProfile({ email: null }),
      makeConfig()
    )

    expect(result).toEqual({ ok: false, reason: 'no_email' })
  })

  it.each([true, false])(
    'rejects unverified email before any email-based lookup (allowLinking=%s)',
    async (allowLinking) => {
      mocks.userFindUnique.mockResolvedValueOnce(null) // oidcSubject lookup misses

      const result = await resolveOidcUser(
        makeProfile({ email_verified: false }),
        makeConfig({
          requireEmailVerified: true,
          allowLinking,
          autoProvision: true,
        })
      )

      expect(result).toEqual({ ok: false, reason: 'email_unverified' })
      expect(mocks.userFindUnique).toHaveBeenCalledTimes(1) // only the subject lookup
      expect(mocks.userUpdate).not.toHaveBeenCalled()
      expect(mocks.createUser).not.toHaveBeenCalled()
    }
  )

  it('links to an existing account when linking is allowed and email is verified', async () => {
    const linkedUser = { ...dbUser, id: 'linked-user-id' }
    mocks.userFindUnique
      .mockResolvedValueOnce(null) // oidcSubject lookup misses
      .mockResolvedValueOnce(dbUser) // email lookup hits
    mocks.userUpdate.mockResolvedValueOnce(linkedUser)

    const result = await resolveOidcUser(
      makeProfile({ email_verified: true }),
      makeConfig({ allowLinking: true, requireEmailVerified: true })
    )

    expect(result).toEqual({
      ok: true,
      user: expect.objectContaining({ id: linkedUser.id }),
    })
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: dbUser.id },
        data: { oidcSubject: 'idp-subject-1' },
      })
    )
  })

  it('links without a verified email when requireEmailVerified is disabled', async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dbUser)
    mocks.userUpdate.mockResolvedValueOnce(dbUser)

    const result = await resolveOidcUser(
      makeProfile({ email_verified: undefined }),
      makeConfig({ allowLinking: true, requireEmailVerified: false })
    )

    expect(result.ok).toBe(true)
    expect(mocks.userUpdate).toHaveBeenCalled()
  })

  it('rejects with account_exists when a match is found but linking is disabled', async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dbUser)

    const result = await resolveOidcUser(
      makeProfile({ email_verified: true }),
      makeConfig({ allowLinking: false })
    )

    expect(result).toEqual({ ok: false, reason: 'account_exists' })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('auto-provisions a new user when no match exists, falling back to the email prefix for name', async () => {
    const createdUser = { ...dbUser, id: 'new-user-id' }
    mocks.userFindUnique
      .mockResolvedValueOnce(null) // oidcSubject lookup misses
      .mockResolvedValueOnce(null) // email lookup misses
    mocks.createUser.mockResolvedValueOnce(createdUser)

    const result = await resolveOidcUser(
      makeProfile({ name: undefined, email: 'newperson@example.com' }),
      makeConfig({ autoProvision: true })
    )

    expect(result).toEqual({
      ok: true,
      user: expect.objectContaining({ id: createdUser.id }),
    })
    expect(mocks.createUser).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        email: 'newperson@example.com',
        name: 'newperson',
        oidcSubject: 'idp-subject-1',
      })
    )
  })

  it.each([
    { verified: true, expectDate: true },
    { verified: false, expectDate: false },
  ])(
    'stamps emailVerified on auto-provisioned users iff the IdP verified it (verified=$verified)',
    async ({ verified, expectDate }) => {
      mocks.userFindUnique
        .mockResolvedValueOnce(null) // oidcSubject lookup misses
        .mockResolvedValueOnce(null) // email lookup misses
      mocks.createUser.mockResolvedValueOnce({ ...dbUser, id: 'stamped' })

      await resolveOidcUser(
        makeProfile({ email_verified: verified }),
        makeConfig({ autoProvision: true, requireEmailVerified: false })
      )

      const [, createUserInput] = mocks.createUser.mock.calls[0]
      if (expectDate) {
        expect(createUserInput.emailVerified).toBeInstanceOf(Date)
      } else {
        expect(createUserInput.emailVerified).toBeUndefined()
      }
    }
  )

  it('rejects with not_provisioned when no match exists and autoProvision is disabled', async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await resolveOidcUser(
      makeProfile(),
      makeConfig({ autoProvision: false })
    )

    expect(result).toEqual({ ok: false, reason: 'not_provisioned' })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })
})
