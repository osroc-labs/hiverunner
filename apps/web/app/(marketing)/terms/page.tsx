import { Container } from "@workspace/ui-shell/components/page-header"
import { PageIntro, Prose } from "@/components/marketing/page-parts"
import product from "@/config/product.json"

export const metadata = {
  title: "Terms of service",
  description:
    "The HiveWorker terms of service. This page is a draft placeholder.",
}

export default function TermsPage() {
  return (
    <>
      <PageIntro title="Terms of service">
        This page is a draft. The terms of service have not been written or
        reviewed yet.
      </PageIntro>
      <Container className="pb-16 sm:pb-24">
        <Prose>
          <p>
            HiveWorker is in early access and is not generally available.
            Nothing on this page is a binding agreement. The terms that apply to
            using HiveWorker will be published here before general availability.
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
