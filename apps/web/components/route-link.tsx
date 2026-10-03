import type { ComponentProps } from "react"

/**
 * A link to a route handler rather than a page: `/install` and
 * `/github/sync` answer with a redirect, often to GitHub, which a client-side
 * navigation cannot follow. This is a plain anchor on purpose.
 */
export function RouteLink({
  to,
  ...props
}: Omit<ComponentProps<"a">, "href"> & {
  to: "/install" | "/github/sync"
}) {
  return <a href={to} {...props} />
}
