"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { SiteHeaderLink } from "@workspace/ui-shell/components/site-header"

/** A header link that knows whether it points at the section being read. */
export function NavLink({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  const pathname = usePathname()
  const active = pathname === href || pathname.startsWith(`${href}/`)
  return (
    <SiteHeaderLink
      active={active}
      aria-current={active ? "page" : undefined}
      className={className}
      render={<Link href={href} />}
    >
      {children}
    </SiteHeaderLink>
  )
}
