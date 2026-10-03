import { createServer } from "node:http"
import { createVerify } from "node:crypto"
import { once } from "node:events"

/**
 * Stands in for api.github.com in the Worker smoke test. It checks the same
 * things GitHub does: the App token's signature, and that org questions are
 * asked with an installation token rather than a user's.
 *
 * `PUT /__state` replaces what it knows:
 *   users:         { [userToken]: { id, login } }
 *   visible:       { [userToken]: installationId[] }
 *   installations: { [installationId]: { account: { id, login, type } } }
 *   roles:         { "org/login": "admin" | "member" }
 *   teams:         { "org/team-slug": login[] }
 *   down:          true makes membership questions fail with 502
 */
export async function startFakeGitHub(publicKey) {
  let state = { users: {}, visible: {}, installations: {}, roles: {} }
  const installationTokens = new Map()

  const validAppToken = (token) => {
    const [header, payload, signature] = (token ?? "").split(".")
    if (!signature) return false
    return createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, "base64url"))
  }

  const server = createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json" })
      response.end(JSON.stringify(body ?? {}))
    }
    const url = new URL(request.url, "http://github.test")
    const path = url.pathname
    const token = request.headers.authorization?.replace(/^Bearer /, "")

    if (path === "/__state") {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      state = JSON.parse(Buffer.concat(chunks).toString())
      return send(200)
    }

    let match
    if (
      (match = path.match(/^\/app\/installations\/(\d+)(\/access_tokens)?$/))
    ) {
      if (!validAppToken(token))
        return send(401, { message: "Bad credentials" })
      const installation = state.installations[match[1]]
      if (!installation) return send(404, { message: "Not Found" })
      if (!match[2])
        return send(200, {
          id: Number(match[1]),
          repository_selection: "all",
          suspended_at: null,
          ...installation,
        })
      const issued = `ghs_${match[1]}_${crypto.randomUUID()}`
      installationTokens.set(issued, Number(match[1]))
      return send(201, {
        token: issued,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      })
    }
    if (path === "/user") {
      const user = state.users[token]
      return user ? send(200, user) : send(401, { message: "Bad credentials" })
    }
    if (path === "/user/installations") {
      if (!state.users[token]) return send(401, { message: "Bad credentials" })
      return send(200, {
        installations: (state.visible[token] ?? []).map((id) => ({ id })),
      })
    }
    if ((match = path.match(/^\/orgs\/([^/]+)\/memberships\/([^/]+)$/))) {
      if (!installationTokens.has(token))
        return send(401, { message: "Bad credentials" })
      if (state.down) return send(502, { message: "Bad Gateway" })
      const role = state.roles[`${match[1]}/${match[2]}`]
      return role
        ? send(200, { state: "active", role })
        : send(404, { message: "Not Found" })
    }
    if (
      (match = path.match(
        /^\/orgs\/([^/]+)\/teams\/([^/]+)\/memberships\/([^/]+)$/
      ))
    ) {
      if (!installationTokens.has(token))
        return send(401, { message: "Bad credentials" })
      return state.teams?.[`${match[1]}/${match[2]}`]?.includes(match[3])
        ? send(200, { state: "active", role: "member" })
        : send(404, { message: "Not Found" })
    }
    if ((match = path.match(/^\/user\/(\d+)$/))) {
      if (!installationTokens.has(token))
        return send(401, { message: "Bad credentials" })
      const user = Object.values(state.users).find(
        (candidate) => String(candidate.id) === match[1]
      )
      return user ? send(200, user) : send(404, { message: "Not Found" })
    }
    send(404, { message: "Not Found" })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
