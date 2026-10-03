"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@workspace/ui/lib/utils"

/** The docs sidebar. A row of links on a phone, a column from `lg` up. */
export function DocsNav({
  items,
}: {
  items: ReadonlyArray<{ href: string; label: string }>
}) {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Docs"
      className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8 lg:sticky lg:top-24 lg:mx-0 lg:flex-col lg:px-0"
    >
      {items.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md border-primary px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 lg:rounded-none lg:border-l-2 lg:border-transparent",
              active &&
                "bg-muted font-medium text-foreground lg:border-primary lg:bg-transparent"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
