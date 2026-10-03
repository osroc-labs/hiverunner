import { AppError } from "./errors"
import { env } from "cloudflare:workers"
import { auth } from "@/lib/auth"

export async function browserSession(request: Request) {
  if (request.method !== "GET" && request.headers.get("origin") !== env.APP_URL)
    throw new AppError("FORBIDDEN", "Invalid request origin")
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) throw new AppError("UNAUTHENTICATED", "Sign in to continue")
  return session
}

/**
 * A session from either a browser or the daemon.
 *
 * The daemon presents its sign-in token as a bearer token. That is not an
 * ambient credential the way a cookie is, so there is no origin to check.
 */
export async function apiSession(request: Request) {
  if (!request.headers.get("authorization")?.startsWith("Bearer "))
    return { ...(await browserSession(request)), bearer: false }
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) throw new AppError("UNAUTHENTICATED", "Sign in to continue")
  return { ...session, bearer: true }
}
