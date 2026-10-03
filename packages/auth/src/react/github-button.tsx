"use client"

import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { FieldError } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"

import { authClient } from "@workspace/auth/client"

/**
 * The only way in. Goes through the Better Auth browser client so the state
 * cookie and the redirect to GitHub come from the same response.
 */
function GitHubSignInButton({
  redirectTo = "/dashboard",
  children = "Sign in with GitHub",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick"> & {
  redirectTo?: string
}) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function signIn() {
    setPending(true)
    setError(null)
    const result = await authClient.signIn.social({
      provider: "github",
      callbackURL: redirectTo,
      errorCallbackURL: "/sign-in?error=github",
    })
    if (result.error) {
      setError(result.error.message ?? "GitHub sign-in is unavailable.")
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={signIn}
        disabled={pending}
        aria-busy={pending || undefined}
        {...props}
      >
        {pending ? <Spinner /> : null}
        {children}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

export { GitHubSignInButton }
