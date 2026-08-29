import { describe, expect, it } from 'vitest'

import { isOidcProviderConfigured } from '@/lib/auth'
import { getOidcErrorMessage } from '@/lib/auth/oidc-error-messages'

const complete = {
  enabled: true,
  issuer: 'https://idp.example.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  buttonText: 'Sign in with SSO',
}

describe('isOidcProviderConfigured', () => {
  it('is true when enabled with issuer, clientId, and clientSecret all set', () => {
    expect(isOidcProviderConfigured(complete)).toBe(true)
  })

  it.each([
    ['enabled', false],
    ['issuer', ''],
    ['clientId', ''],
    ['clientSecret', ''],
  ] as const)('is false when %s is missing', (field, value) => {
    expect(isOidcProviderConfigured({ ...complete, [field]: value })).toBe(
      false
    )
  })
})

describe('getOidcErrorMessage', () => {
  const knownCodes = [
    'OidcNoEmail',
    'OidcAccountExists',
    'OidcNotProvisioned',
    'OidcEmailUnverified',
  ] as const
  const fallback = getOidcErrorMessage('SomeUnrecognizedCode')

  it.each(knownCodes)('returns a specific message for %s', (code) => {
    const message = getOidcErrorMessage(code)
    expect(message).toBeTruthy()
    expect(message).not.toBe(fallback)
  })

  it('returns distinct messages for every known error code', () => {
    const messages = knownCodes.map(getOidcErrorMessage)
    expect(new Set(messages).size).toBe(knownCodes.length)
  })

  it('falls back to a generic message for an unrecognized code', () => {
    expect(fallback).toBe(
      'Sign-in with SSO failed. Please try again or contact an admin.'
    )
  })
})
