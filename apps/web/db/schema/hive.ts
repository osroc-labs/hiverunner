/**
 * HiveWorker tables, owned by `@workspace/db` so the coordinator Worker can
 * share them. The migrations are generated and committed here, because this
 * app owns the database.
 */

export * from "@workspace/db/schema"
