import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { Container } from "@workspace/ui-shell/components/page-header"
import {
  JOB_TAX_RATE,
  OWNER_CORES,
  RUNNER_SIZES,
  competitorUsdPerMinute,
  privatePoolUsdPerMinute,
} from "@workspace/pricing"
import { Code, CodeBlock } from "@/components/marketing/code"
import { formatMultiple, formatRate } from "@/components/marketing/format"
import { HiveComb } from "@/components/marketing/hive-comb"
import { Fact, Facts, textLink } from "@/components/marketing/page-parts"
import { INSTALL_COMMAND } from "@/components/marketing/site"
import { WorkflowDiff } from "@/components/marketing/workflow-diff"

export const metadata = {
  title: {
    absolute:
      "Hive Runner: GitHub Actions on the machines your team already has",
  },
  description:
    "An organization changes runs-on to hive, and its developers lend their Macs and Linux machines. Each job runs in a throwaway VM on one of them, for a fraction of a hosted runner's price.",
  alternates: { canonical: "/" },
}

const base = RUNNER_SIZES[0]
const ours = privatePoolUsdPerMinute(base.vcpus)
const github = competitorUsdPerMinute("github", base.vcpus)
const percent = new Intl.NumberFormat("en-US", { style: "percent" })

export default function HomePage() {
  return (
    <>
      <section>
        <Container className="grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-14">
          <div>
            <h1 className="font-heading text-[2rem] leading-[1.12] font-medium tracking-tight text-balance sm:text-5xl sm:leading-[1.1]">
              GitHub Actions on the machines your team already has.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-pretty text-muted-foreground">
              An organization installs the GitHub App and changes one line in a
              workflow. Its developers lend their Macs and Linux machines, and
              each job runs in a throwaway VM on one of them. A {base.vcpus}{" "}
              vCPU minute costs {formatRate(ours.net)}, against{" "}
              {formatRate(github)} on a GitHub-hosted runner.
            </p>
          </div>
          <figure className="border border-border">
            <HiveComb className="p-4 sm:p-5" />
            <figcaption className="border-t border-border px-4 py-2.5 font-mono text-xs text-muted-foreground">
              A hive: one cell for each machine your team lends
            </figcaption>
          </figure>
        </Container>
      </section>

      <section className="border-t border-border">
        <Container className="py-14 sm:py-20">
          <h2 className="font-heading text-2xl leading-snug font-medium tracking-tight text-balance sm:text-3xl">
            Which side are you on?
          </h2>
          <div className="mt-10 grid border-t border-l border-border lg:grid-cols-2">
            <Door
              title="I run a GitHub organization"
              href="/orgs"
              action="For organizations"
              visual={
                <WorkflowDiff className="text-sm leading-9 sm:text-base sm:leading-10" />
              }
            >
              <p>
                You want the same CI for less. Keep your workflows, change{" "}
                <Code>runs-on</Code>, and pay{" "}
                {formatMultiple(github / ours.net)} less per minute than on a
                GitHub-hosted runner. You decide who may add machines, who is
                paid, and what the hive may spend a month.
              </p>
            </Door>
            <Door
              title="I'm a developer with a machine to lend"
              href="/developers"
              action="For developers"
              visual={
                <CodeBlock title="Terminal" wrap>
                  {INSTALL_COMMAND}
                </CodeBlock>
              }
            >
              <p>
                Your Mac or Linux machine takes your team&apos;s jobs while it
                is free, each in a VM that cannot see your files, and always
                leaves {OWNER_CORES} cores for you. Already in a hive, or need
                to ask an owner to install it? Start here either way.
              </p>
            </Door>
          </div>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <Facts>
            <Fact title="The workflows stay on GitHub">
              GitHub still starts each workflow, streams the log and posts the
              check. Jobs without a <Code>hive</Code> label run where they run
              today.
            </Fact>
            <Fact title="One VM per job">
              Every job gets its own hardware-virtualized VM, destroyed when the
              job ends. Hive Runner assigns the job and is not in its data path.{" "}
              <Link href="/security" className={textLink}>
                Security
              </Link>
            </Fact>
            <Fact title="Paid by the minute">
              No subscription, no seats. When the hive&apos;s own machines do
              the work, all but {percent.format(JOB_TAX_RATE)} of each job comes
              back.{" "}
              <Link href="/pricing" className={textLink}>
                Pricing
              </Link>
            </Fact>
            <Fact title="Only your organization">
              A machine joins because its owner belongs to your GitHub
              organization. There are no invite codes, and nobody outside it
              runs your jobs.
            </Fact>
          </Facts>
        </Container>
      </section>
    </>
  )
}

/** One of the two ways into the site, as a cell of a ruled pair. */
function Door({
  title,
  href,
  action,
  visual,
  children,
}: {
  title: string
  href: "/orgs" | "/developers"
  action: string
  visual: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 border-r border-b border-border p-6 sm:p-8">
      <h3 className="border-l-2 border-primary pl-4 font-heading text-xl leading-snug font-medium tracking-tight text-balance sm:text-2xl">
        <Link href={href} className="hover:underline">
          {title}
        </Link>
      </h3>
      <div className="flex flex-col gap-4 text-lg leading-8 text-pretty text-muted-foreground">
        {children}
      </div>
      <div className="mt-auto flex flex-col gap-6">
        {visual}
        <div>
          <Button
            nativeButton={false}
            size="lg"
            className="h-11 px-5 font-mono text-sm"
            render={<Link href={href} />}
          >
            {action}
          </Button>
        </div>
      </div>
    </div>
  )
}
