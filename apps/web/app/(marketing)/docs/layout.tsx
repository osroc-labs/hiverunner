import { Container } from "@workspace/ui-shell/components/page-header"
import { DOCS } from "@/components/marketing/docs"
import { DocsNav } from "@/components/marketing/docs-nav"

const items = [
  { href: "/docs", label: "Overview" },
  ...DOCS.map((doc) => ({ href: `/docs/${doc.slug}`, label: doc.title })),
]

export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Container className="grid grid-cols-[minmax(0,1fr)] gap-6 py-8 sm:py-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
      <aside className="min-w-0">
        <DocsNav items={items} />
      </aside>
      <div className="min-w-0 pb-12">{children}</div>
    </Container>
  )
}
