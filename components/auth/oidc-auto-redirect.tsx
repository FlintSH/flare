'use client'

import { useEffect } from 'react'

import Link from 'next/link'

import { signIn } from 'next-auth/react'

import { Icons } from '@/components/shared/icons'
import { Button } from '@/components/ui/button'

import { getOidcErrorMessage } from '@/lib/auth/oidc-error-messages'

interface OidcAutoRedirectProps {
  buttonText: string
  errorCode?: string
}

function redirectToOidc() {
  signIn('oidc', { callbackUrl: '/dashboard' })
}

export function OidcAutoRedirect({
  buttonText,
  errorCode,
}: Readonly<OidcAutoRedirectProps>) {
  useEffect(() => {
    if (!errorCode) {
      redirectToOidc()
    }
    // Only auto-fire on first mount for a given error state,
    // or a persistently failing provider becomes a redirect loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {errorCode ? 'Sign-in failed' : 'Redirecting to sign-in'}
        </h1>
        <p className="text-base text-muted-foreground">
          {errorCode
            ? getOidcErrorMessage(errorCode)
            : "Taking you to your organization's sign-in page..."}
        </p>
      </div>
      <Button
        type="button"
        className="w-full h-11 font-medium bg-primary hover:bg-primary/90 transition-colors"
        onClick={redirectToOidc}
      >
        {errorCode ? (
          buttonText
        ) : (
          <>
            <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            {buttonText}
          </>
        )}
      </Button>
      <Link
        href="/auth/login?local=1"
        className="block text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
      >
        Use local sign-in instead
      </Link>
    </div>
  )
}
