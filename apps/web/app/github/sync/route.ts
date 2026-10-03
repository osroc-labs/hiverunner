import { listOrganizations } from "@workspace/auth"
import { safeReturnPath } from "@workspace/stripe"
import {
  repairActiveOrganization,
  syncMemberships,
} from "@workspace/db/membership"

import { getDb } from "@/db"
import { auth } from "@/lib/auth"
import { logError } from "@/lib/diagnostics"
import { getGitHubApp, githubUserToken } from "@/lib/github"
import { seeOther } from "@/lib/redirect"

/**
 * Every GitHub sign-in lands here first, while the person's token is fresh:
 * it is the moment their pool memberships are brought in line with GitHub.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const next = safeReturnPath(url.searchParams.get("next"), "/dashboard")
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return seeOther(`/sign-in?next=${encodeURIComponent(next)}`)

  const db = getDb()
  const app = getGitHubApp()
  const userToken = app ? await githubUserToken(session.user.id) : null
  let organizationIds: string[] | undefined
  if (app && userToken) {
    try {
      organizationIds = (
        await syncMemberships(db, app, { userId: session.user.id, userToken })
      ).organizationIds
    } catch (error) {
      // GitHub being down must not lock anyone out; the cache stands.
      logError(error, "github.sync")
    }
  }
  organizationIds ??= (await listOrganizations(db, session.user.id)).map(
    (organization) => organization.id
  )
  await repairActiveOrganization(db, {
    userId: session.user.id,
    organizationIds,
  })
  return seeOther(next)
}
