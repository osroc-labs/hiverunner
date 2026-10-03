import { env } from "cloudflare:workers"
import { and, eq } from "drizzle-orm"
import { account } from "@workspace/auth/schema"
import { createGitHubApp, type GitHubApp } from "@workspace/github"

import { getDb } from "@/db"

const local = () =>
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.APP_URL ?? "")

let app: GitHubApp | undefined

/**
 * Null until the App's credentials are set. Local development without a
 * GitHub App still works: seeded pools and members simply are not re-checked.
 */
export function getGitHubApp() {
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !env.GITHUB_WEBHOOK_SECRET
  )
    return null
  return (app ??= createGitHubApp({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    // Never redirect a deployed Worker's GitHub traffic by configuration.
    apiUrl: local() ? env.GITHUB_API_URL : undefined,
  }))
}

export function installUrl() {
  return env.GITHUB_APP_SLUG
    ? `https://github.com/apps/${encodeURIComponent(env.GITHUB_APP_SLUG)}/installations/new`
    : null
}

/**
 * The person's own GitHub token, or null when they did not sign in with
 * GitHub or the token has expired.
 *
 * Read straight from the account row and never refreshed: it is used at
 * sign-in, when it is minutes old, to learn which installations the person
 * can see. Everything after that is asked with installation tokens.
 */
export async function githubUserToken(userId: string) {
  const [linked] = await getDb()
    .select({
      accessToken: account.accessToken,
      expiresAt: account.accessTokenExpiresAt,
    })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "github")))
    .limit(1)
  if (!linked?.accessToken) return null
  if (linked.expiresAt && linked.expiresAt.getTime() < Date.now() + 30_000)
    return null
  return linked.accessToken
}
