import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { getMembership } from "@workspace/auth"
import { getInstallationByOrganization } from "@workspace/db/installations"
import { getDb } from "@/db"

import { auth } from "@/lib/auth"

export async function getServerSession() {
  return auth.api.getSession({ headers: await headers() })
}

/** Redirects to sign-in instead of returning null. */
export async function requireServerSession() {
  const session = await getServerSession()
  if (!session) redirect("/sign-in")
  return session
}

/**
 * The organization the session is acting as.
 *
 * Returns the id only. Anything that authorizes against it must re-check
 * membership in the database — `activeOrganizationId` is whatever the session
 * was last pointed at, and a user removed from an organization keeps the
 * stale value until their session refreshes. See `requireMembership`.
 */
export async function getActiveOrganizationId() {
  const session = await getServerSession()
  return session?.session.activeOrganizationId ?? null
}

/**
 * The pool the session is acting as, or null when the person has none: they
 * have not installed the App, or they are not a member of an organization
 * that has. The dashboard renders that state; other pages redirect to it.
 */
export async function getPool() {
  const session = await requireServerSession()
  const organizationId = session.session.activeOrganizationId
  if (!organizationId) return { session, pool: null }
  const db = getDb()
  const membership = await getMembership(db, {
    organizationId,
    userId: session.user.id,
  })
  const installation = membership
    ? await getInstallationByOrganization(db, organizationId)
    : null
  if (!membership || !installation) return { session, pool: null }
  return { session, pool: { organizationId, membership, installation } }
}

export async function requirePool() {
  const { session, pool } = await getPool()
  if (!pool) redirect("/dashboard")
  return { session, ...pool }
}

export async function requireActiveOrganization() {
  const session = await requireServerSession()
  const organizationId = session.session.activeOrganizationId
  if (!organizationId) redirect("/dashboard")
  const membership = await getMembership(getDb(), {
    organizationId,
    userId: session.user.id,
  })
  if (!membership) redirect("/dashboard")
  return { session, organizationId, membership }
}
