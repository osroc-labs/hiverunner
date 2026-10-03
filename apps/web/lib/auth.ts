import { env } from "cloudflare:workers"
import {
  createAuth,
  createAuthDb,
  lazyAuth,
  resolveSecret,
} from "@workspace/auth"

export const auth = lazyAuth(() => {
  if (!env.APP_URL) throw new Error("APP_URL must be configured")
  const origin = new URL(env.APP_URL).origin
  const local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
  return createAuth({
    db: createAuthDb(env.DB),
    secret: resolveSecret(env.BETTER_AUTH_SECRET, env.APP_URL),
    baseURL: origin,
    trustedOrigins: [origin],
    github:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          }
        : undefined,
    localPasswordSignIn: local,
  })
})
