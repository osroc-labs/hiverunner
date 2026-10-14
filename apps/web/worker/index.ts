import { createMailer } from "@workspace/email"
import product from "../config/product.json"
import { getDb } from "../db"
import { logError, observeRequest } from "../lib/diagnostics"
import { canTakeCards, stripe } from "../lib/stripe"
import { sendBillingNotices } from "../operations/billing-notices"
import { chargeDueTopUps } from "../operations/top-up"
import vinextWorker from "vinext/server/app-router-entry"

export { AppDatabase } from "./database"

import { auth } from "../lib/auth"
import { handleMcp } from "../mcp/handler"

const ORGANIZATION_ENDPOINTS = new Set([
  "set-active",
  "list",
  "get-full-organization",
  "get-active-member",
])

/**
 * A page asked for on any host but the app's own (the old domain, www) is
 * sent there. What machines and services call is answered where it is asked:
 * a redirect would drop a daemon's bearer token, and a webhook does not
 * follow one.
 */
function elsewhere(request: Request, appUrl: string | undefined) {
  if (!appUrl || !["GET", "HEAD"].includes(request.method)) return null
  const url = new URL(request.url)
  const app = new URL(appUrl)
  if (url.host === app.host) return null
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/.well-known/") ||
    url.pathname === "/mcp"
  )
    return null
  return Response.redirect(`${app.origin}${url.pathname}${url.search}`, 301)
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    return observeRequest(request, async () => {
      const moved = elsewhere(request, env.APP_URL)
      if (moved) return moved
      const path = new URL(request.url).pathname
      if (
        (!product.features.mcp &&
          (path === "/mcp" ||
            path.startsWith("/.well-known/") ||
            path.startsWith("/api/auth/oauth2") ||
            path === "/connect" ||
            path === "/api/connect" ||
            path === "/connections" ||
            path === "/api/connections")) ||
        (!product.features.billing &&
          (path === "/billing" ||
            (path.startsWith("/api/stripe/") &&
              // Card top-ups arrive on the same webhook as subscriptions.
              !(product.features.funding && path === "/api/stripe/webhook"))))
      )
        return new Response("Not found", { status: 404 })
      // Pools and their members come from GitHub. Better Auth's organization
      // plugin is kept for sessions and roles, but nobody may create, invite,
      // promote or remove through it.
      if (
        path.startsWith("/api/auth/organization/") &&
        !ORGANIZATION_ENDPOINTS.has(
          path.slice("/api/auth/organization/".length)
        )
      )
        return new Response("Not found", { status: 404 })
      if (path === "/mcp") return handleMcp(request)
      if (path.startsWith("/.well-known/")) return auth.handler(request)
      return vinextWorker.fetch(request, env, ctx)
    })
  },
  /**
   * Every few minutes: charge the saved cards whose balance has run low, and
   * tell owners what has changed about their hive's money.
   */
  async scheduled(_controller, env, ctx) {
    if (canTakeCards())
      ctx.waitUntil(
        chargeDueTopUps(getDb(), stripe()).catch((error) =>
          logError(error, "top-up.sweep")
        )
      )
    if (env.EMAIL && env.EMAIL_FROM && env.APP_URL)
      ctx.waitUntil(
        sendBillingNotices(
          getDb(),
          createMailer(env.EMAIL, env.EMAIL_FROM),
          env.APP_URL
        ).catch((error) => logError(error, "billing-notices.sweep"))
      )
  },
} satisfies ExportedHandler<CloudflareEnv>
