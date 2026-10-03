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
