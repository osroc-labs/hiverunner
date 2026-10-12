import { listOrganizations } from "@workspace/auth"
import { safeReturnPath } from "@workspace/stripe"
import { autoJoinMachines, joinedHives } from "@workspace/db/machines"
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
  let joined: string[] = []
  if (app && userToken) {
    try {
      const synced = await syncMemberships(db, app, {
        userId: session.user.id,
        userToken,
      })
      organizationIds = synced.organizationIds
      joined = synced.joined.map((hive) => hive.organizationId)
      await autoJoinMachines(db, app, {
        userId: session.user.id,
        joined: synced.joined,
        // Neither a yes nor a no: the machine stays where it was.
        onError: (error) => logError(error, "machine.auto-join"),
      })
      // Only hives there is something to say about: someone with no machines
      // lands on the page they asked for, as before.
      joined = (
        await joinedHives(db, {
          userId: session.user.id,
          organizationIds: joined,
        })
      )
        .filter((hive) => hive.autoJoined.length > 0 || hive.missing > 0)
        .map((hive) => hive.organizationId)
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
  return seeOther(withJoined(next, joined))
}

/**
 * Tells the dashboard which hives this sign-in put the person in, so it can
 * say what happened to their machines. Only the dashboard reads it, so no
 * other destination is touched; and it names hives, never what to say about
 * them, which the dashboard reads from the database.
 */
function withJoined(next: string, joined: string[]) {
  if (!joined.length) return next
  const url = new URL(next, "https://return.invalid")
  if (url.pathname !== "/dashboard") return next
  url.searchParams.set("joined", joined.join(","))
  return url.pathname + url.search + url.hash
}
