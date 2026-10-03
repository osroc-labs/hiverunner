/** A same-origin redirect from a route handler. */
export function seeOther(path: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: path, "Cache-Control": "no-store" },
  })
}
