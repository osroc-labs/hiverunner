import Link from "next/link"
import { Container } from "@workspace/ui-shell/components/page-header"
import { PageIntro, Prose } from "@/components/marketing/page-parts"
import product from "@/config/product.json"

export const metadata = {
  title: "Privacy policy",
  description:
    "The HiveWorker privacy policy. This page is a draft placeholder.",
}

export default function PrivacyPage() {
  return (
    <>
      <PageIntro title="Privacy policy">
        This page is a draft. The privacy policy has not been written or
        reviewed yet.
      </PageIntro>
      <Container className="pb-16 sm:pb-24">
        <Prose>
          <p>
            HiveWorker is in early access and is not generally available. This
            page is not the final policy. The policy that applies to using
            HiveWorker will be published here before general availability.
          </p>
          <p>
            Until then, the <Link href="/security">security page</Link>{" "}
            describes what HiveWorker is designed to access and store, and what
            it is designed not to.
          </p>
          <p>
            Questions:{" "}
            <a href={`mailto:${product.supportEmail}`}>
              {product.supportEmail}
            </a>
          </p>
        </Prose>
      </Container>
    </>
  )
}
