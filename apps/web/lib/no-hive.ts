import { env } from "cloudflare:workers"

/**
 * What to tell someone who signed in fine but belongs to no hive. A hive is
 * a GitHub organization with the App installed, so the way out is to install
 * it or to be let into one; nothing on this side can be retried.
 */
export function noHiveMessage() {
  return (
    "Your GitHub account is not in a hive yet. A hive is a GitHub " +
    "organization with Hive Runner installed. Install it on yours at " +
    `${env.APP_URL}/install, or ask a hive owner for their invite link, ` +
    "then run hived login again."
  )
}

/**
 * The one of a person's hives that `hive` names: its id, or the GitHub
 * organization's login in any case. What a person types is the login; the
 * id is what the API hands back.
 */
export function findHive<T extends { id: string; name: string }>(
  pools: T[],
  hive: string
) {
  const wanted = hive.trim().toLowerCase()
  return pools.find(
    (pool) => pool.id === hive || pool.name.toLowerCase() === wanted
  )
}

/** What to say of a hive asked for by someone not in it, and what they are in. */
export function notInHive(hive: string, pools: Array<{ name: string }>) {
  const theirs = pools.map((pool) => pool.name).join(", ")
  return (
    `You are not in a hive called ${JSON.stringify(hive)}. ` +
    (theirs ? `Your hives: ${theirs}.` : "You are in no hive yet.")
  )
}
