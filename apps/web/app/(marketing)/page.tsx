import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { Container } from "@workspace/ui-shell/components/page-header"
import {
  RUNNER_SIZES,
  competitorUsdPerMinute,
  privatePoolUsdPerMinute,
} from "@workspace/pricing"
import { Code, CodeBlock } from "@/components/marketing/code"
import { EarlyAccessNote } from "@/components/marketing/early-access"
import { formatRate } from "@/components/marketing/format"
import { IsolationDiagram } from "@/components/marketing/isolation-diagram"
import { textLink } from "@/components/marketing/page-parts"
import { INSTALL_COMMAND } from "@/components/marketing/site"
import { WorkflowDiff } from "@/components/marketing/workflow-diff"
import { RouteLink } from "@/components/route-link"

export const metadata = {
  title: { absolute: "HiveWorker: GitHub Actions on your team's own Macs" },
  description:
    "Change runs-on to hive and your GitHub Actions jobs run in throwaway VMs on the Macs your developers already have.",
}

const base = RUNNER_SIZES[0]
const ours = privatePoolUsdPerMinute(base.vcpus)
const github = competitorUsdPerMinute("github", base.vcpus)
const blacksmith = competitorUsdPerMinute("blacksmith", base.vcpus)

export default function HomePage() {
  return (
    <>
      <section>
        <div className="bg-code pt-8 pb-10 sm:pt-12 sm:pb-16">
          <Container>
            <p className="pb-3 font-mono text-xs text-code-foreground/60 sm:pb-5 sm:text-sm">
              .github/workflows/ci.yml
            </p>
          </Container>
          <WorkflowDiff variant="hero" />
        </div>
        <Container className="grid gap-8 py-12 sm:py-16 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-end lg:gap-16">
          <div>
            <h1 className="font-heading text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Run GitHub Actions on the Macs your team already has.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-pretty text-muted-foreground">
              HiveWorker is runner software for GitHub Actions. That one line
              sends a job to a throwaway VM on one of your own developers'
              machines. The rest of the workflow stays as it is.
            </p>
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-3">
              <Button
                nativeButton={false}
                size="lg"
                className="h-11 px-5 text-base"
                render={<RouteLink to="/install" />}
              >
                Install the GitHub App
              </Button>
              <Button
                nativeButton={false}
                size="lg"
                variant="outline"
                className="h-11 px-5 text-base"
                render={<Link href="/docs" />}
              >
                Read the docs
              </Button>
            </div>
            <EarlyAccessNote />
          </div>
        </Container>
      </section>

      <section className="border-t border-border">
        <Container className="grid md:grid-cols-3">
          <PromiseColumn title="Cheaper">
            A {base.vcpus} vCPU minute costs {formatRate(ours.gross)} in a
            private pool. The same Linux arm64 minute is {formatRate(github)} on
            a GitHub-hosted runner and {formatRate(blacksmith)} on Blacksmith.
            When your own machines run the job, most of that payment comes back
            to your organization and the net cost is {formatRate(ours.net)}.{" "}
            <Link href="/pricing" className={textLink}>
              Work out your month
            </Link>
          </PromiseColumn>
          <PromiseColumn title="Faster">
            Jobs land on Apple Silicon your team already owns. Each machine
            keeps one VM booted and waiting, so a job starts on a runner that is
            already up instead of waiting for one to be provisioned.
          </PromiseColumn>
          <PromiseColumn title="Simple">
            One GitHub App install for the organization. One sign-in for each
            developer. One changed line in a workflow. No invite codes, no
            subscription and no platform fee.
          </PromiseColumn>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <h2 className="max-w-2xl font-heading text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            Three steps, and the third is the diff above.
          </h2>
          <ol className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-8">
            <Step number={1} title="Install the GitHub App">
              <p>
                An organization owner installs HiveWorker on the organization.
                That creates the runner labels, a private pool, and a wallet
                holding a trial grant.
              </p>
              <ul className="flex flex-wrap gap-2">
                {RUNNER_SIZES.map((size) => (
                  <li key={size.label}>
                    <Code>{size.label}</Code>
                  </li>
                ))}
              </ul>
            </Step>
            <Step number={2} title="Developers add their Macs">
              <p>
                Each developer installs the daemon and signs in with GitHub.
                Belonging to your GitHub organization is what lets a machine
                join the pool.
              </p>
              <CodeBlock title="Terminal" wrap>
                {INSTALL_COMMAND}
              </CodeBlock>
              <p className="text-sm">
                The daemon is not released yet.{" "}
                <Link href="/download" className={textLink}>
                  Requirements and status
                </Link>
              </p>
            </Step>
            <Step number={3} title="Change one line">
              <p>
                Jobs with a <Code>hive</Code> label run on your pool. Jobs
                without one keep running where they run today.
              </p>
              <WorkflowDiff />
            </Step>
          </ol>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <div className="flex flex-col gap-5">
            <h2 className="font-heading text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
              A job never touches the machine it runs on.
            </h2>
            <p className="text-lg leading-8 text-muted-foreground">
              Every job gets its own hardware-virtualized VM, which is destroyed
              when the job ends. The VM talks to GitHub directly. HiveWorker
              assigns the job and is not in its data path.
            </p>
            <ul className="flex flex-col gap-2 text-muted-foreground">
              <li>
                The GitHub App has no access to code, contents or secrets.
              </li>
              <li>
                Only members of your GitHub organization can add machines.
              </li>
              <li>
                The daemon gives way when the developer needs their Mac back.
              </li>
            </ul>
            <p>
              <Link href="/security" className={textLink}>
                How isolation and trust work
              </Link>
            </p>
          </div>
          <IsolationDiagram />
        </Container>
      </section>

      <section className="border-t border-border bg-primary py-14 text-primary-foreground sm:py-16">
        <Container className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-heading text-3xl leading-tight font-semibold tracking-tight text-balance">
              Try it on one workflow.
            </h2>
            <p className="mt-3 text-lg leading-8">
              Every new organization starts with a trial grant, and switching
              back is the same one line. HiveWorker is in early access, so
              installs are not open to everyone yet.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              nativeButton={false}
              size="lg"
              className="h-11 bg-primary-foreground px-5 text-base text-primary hover:bg-primary-foreground/85"
              render={<RouteLink to="/install" />}
            >
              Install the GitHub App
            </Button>
            <Button
              nativeButton={false}
              size="lg"
              variant="ghost"
              className="h-11 border-primary-foreground/40 px-5 text-base hover:bg-primary-foreground/10 hover:text-primary-foreground dark:hover:bg-primary-foreground/10"
              render={<Link href="/pricing" />}
            >
              See pricing
            </Button>
          </div>
        </Container>
      </section>
    </>
  )
}

function PromiseColumn({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-border py-10 not-first:border-t md:px-8 md:py-14 md:not-first:border-t-0 md:not-first:border-l md:first:pl-0 md:last:pr-0">
      <h2 className="font-heading text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-3 leading-7 text-pretty text-muted-foreground">
        {children}
      </p>
    </div>
  )
}

function Step({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="relative flex size-9 shrink-0 items-center justify-center font-semibold">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="absolute inset-0 size-full fill-none stroke-primary stroke-2"
          >
            <path d="M12 1.5 21.1 6.75v10.5L12 22.5 2.9 17.25V6.75z" />
          </svg>
          <span className="relative">{number}</span>
        </span>
        <h3 className="font-heading text-xl font-semibold tracking-tight">
          {title}
        </h3>
      </div>
      <div className="flex flex-col gap-4 leading-7 text-muted-foreground">
        {children}
      </div>
    </li>
  )
}
