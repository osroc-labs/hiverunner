import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { Container } from "@workspace/ui-shell/components/page-header"
import {
  AUTO_TOP_UP_BELOW_USD_OPTIONS,
  BUDGET_WARNING_SHARE,
  JOB_TAX_RATE,
  OVERDRAFT_USD,
  RUNNER_SIZES,
  TRIAL_GRANT_USD,
  TRIAL_GRANT_WITH_CARD_USD,
  competitorUsdPerMinute,
  privatePoolUsdPerMinute,
} from "@workspace/pricing"
import { CopyButton } from "@/components/console/invite"
import { Code, CodeBlock } from "@/components/marketing/code"
import {
  formatMultiple,
  formatRate,
  formatUsd,
} from "@/components/marketing/format"
import { HiveComb } from "@/components/marketing/hive-comb"
import { IsolationDiagram } from "@/components/marketing/isolation-diagram"
import {
  Fact,
  Facts,
  SectionHeading,
  SectionLink,
  Step,
  textLink,
} from "@/components/marketing/page-parts"
import { PriceBars } from "@/components/marketing/price-bars"
import { RouteDiagram } from "@/components/marketing/route-diagram"
import {
  APP_PERMISSIONS,
  DAEMON_RELEASED,
  INSTALL_COMMAND,
  mcpClients,
  PRODUCT_ORIGIN,
} from "@/components/marketing/site"
import { StartTimeline } from "@/components/marketing/start-timeline"
import { WorkflowDiff } from "@/components/marketing/workflow-diff"
import { setupPrompt } from "@/mcp/journey"
import { RouteLink } from "@/components/route-link"

export const metadata = {
  title: "For organizations: cheaper GitHub Actions minutes",
  description:
    "Keep GitHub Actions and run its jobs in throwaway VMs on the Macs and Linux machines your team already has. What it costs against GitHub and Blacksmith, what an owner controls, and how to install it.",
  alternates: { canonical: "/orgs" },
}

const base = RUNNER_SIZES[0]
const ours = privatePoolUsdPerMinute(base.vcpus)
const github = competitorUsdPerMinute("github", base.vcpus)
const blacksmith = competitorUsdPerMinute("blacksmith", base.vcpus)
const percent = new Intl.NumberFormat("en-US", { style: "percent" })

export default function OrganizationsPage() {
  return (
    <>
      <section>
        <Container className="grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-14">
          <div>
            <h1 className="font-heading text-[2rem] leading-[1.12] font-medium tracking-tight text-balance sm:text-5xl sm:leading-[1.1]">
              Keep GitHub Actions. Pay {formatMultiple(blacksmith / ours.net)}{" "}
              less for the minutes.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-pretty text-muted-foreground">
              Change <Code>runs-on</Code> to <Code>hive</Code> and the job runs
              in a throwaway VM on a Mac your team already owns. Same workflows,
              same logs, same checks on the pull request. A {base.vcpus} vCPU
              minute costs {formatRate(ours.net)} on your own Macs:{" "}
              {formatMultiple(blacksmith / ours.net)} less than Blacksmith and{" "}
              {formatMultiple(github / ours.net)} less than a GitHub-hosted
              runner.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                nativeButton={false}
                size="lg"
                className="h-11 px-5 font-mono text-sm"
                render={<RouteLink to="/install" />}
              >
                Install the GitHub App
              </Button>
              <Button
                nativeButton={false}
                size="lg"
                variant="outline"
                className="h-11 px-5 font-mono text-sm"
                render={<Link href="/docs" />}
              >
                Read the docs
              </Button>
            </div>
          </div>
          <div className="border border-border">
            <p className="border-b border-border px-4 py-2.5 font-mono text-xs text-muted-foreground">
              .github/workflows/ci.yml
            </p>
            <WorkflowDiff className="border-0 text-sm leading-9 sm:text-base sm:leading-10" />
            <p className="border-y border-border px-4 py-2.5 font-mono text-xs text-muted-foreground">
              Your organization's hive, one cell for each Mac
            </p>
            <HiveComb className="p-4 sm:p-5" />
          </div>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title="Nothing changes but where the job runs">
            <p>
              GitHub still starts the workflow, streams the log and posts the
              check on the pull request. Inside the VM is GitHub's own runner,
              registered for one job. Hive Runner's part is to hand that job to
              a free Mac in your hive. It is not in the job's data path, and its
              GitHub App has no permission to read code, contents or secrets.
            </p>
            <p>
              Jobs whose <Code>runs-on</Code> is not a hive label keep running
              where they run today. Switching one back is the same one line.
            </p>
          </SectionHeading>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <SectionHeading title="When no Mac is free, the job runs where it does today">
            <p>
              Laptops close. Put one step from the public <Code>route</Code>{" "}
              action in front of a job and it asks whether a machine in your
              hive is free, waits up to fifteen seconds, and sets{" "}
              <Code>runs-on</Code> to <Code>hive</Code> or to the runner you use
              now. It never fails the workflow. A small hive cuts the bill for
              the jobs it can take and changes nothing for the rest.
            </p>
            <p>
              A job sent straight to a <Code>hive</Code> label waits in GitHub's
              queue until a Mac is free, which suits jobs that can wait.
            </p>
            <SectionLink href="/docs/routing">
              How routing and fallback work
            </SectionLink>
          </SectionHeading>
          <RouteDiagram className="h-fit" />
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title={`What a ${base.vcpus} vCPU minute costs`}>
            <p>
              Each provider's list price for a {base.vcpus} vCPU Linux arm64
              minute, beside the same minute in a hive of your own Macs. The
              Hive Runner price is what is left after the machine's share comes
              back to your organization's wallet: {percent.format(JOB_TAX_RATE)}{" "}
              of the charge. There is no subscription, no seats and no platform
              fee. You pay per job, by the minute.
            </p>
            <SectionLink href="/pricing">Work out your month</SectionLink>
          </SectionHeading>
          <PriceBars
            vcpus={base.vcpus}
            className="mt-10 border border-border px-4 sm:px-6"
          />
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title="There is no runner to provision">
            <p>
              Each Mac in the hive keeps one VM booted while its lid is open.
              When a job arrives, that VM takes it. When the job ends the VM is
              destroyed and a fresh one boots for the next.{" "}
              <Code>actions/cache</Code>, and the setup actions built on it,
              save to and restore from the Mac that ran the job instead of from
              GitHub.
            </p>
          </SectionHeading>
          <StartTimeline className="mt-10" />
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title="Three steps to the first job" />
          <ol className="mt-10 grid border-t border-l border-border lg:grid-cols-3">
            <Step number={1} title="Install the GitHub App">
              <p>
                An organization owner installs Hive Runner on the organization.
                That creates the runner labels, a hive, and a wallet holding a
                trial credit.
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
                join the hive.{" "}
                <Link href="/developers" className={textLink}>
                  What it asks of them
                </Link>
              </p>
              <CodeBlock title="Terminal" wrap>
                {INSTALL_COMMAND}
              </CodeBlock>
              <p className="text-sm">
                {DAEMON_RELEASED
                  ? "One command, no password and nothing system-wide. "
                  : "The daemon is not released yet. "}
                <Link href="/download" className={textLink}>
                  {DAEMON_RELEASED
                    ? "What it installs"
                    : "Requirements and status"}
                </Link>
              </p>
            </Step>
            <Step number={3} title="Change one line">
              <p>
                Jobs with a <Code>hive</Code> label run on your hive. Jobs
                without one are untouched, and switching back is the same one
                line.
              </p>
              <WorkflowDiff />
            </Step>
          </ol>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title="What an owner decides">
            <p>
              The organization&apos;s owners on GitHub set the first four in the
              hive&apos;s settings, and owners and admins set the budget and
              top-up in its wallet. There is nothing else to manage: GitHub says
              who is a member, and the machines are ones your team already has.
            </p>
          </SectionHeading>
          <div className="mt-10">
            <Facts>
              <Fact title="Who is paid when a machine runs a job">
                The organization, unless you change it. A job is charged to the
                wallet, the machine that ran it earns all but{" "}
                {percent.format(JOB_TAX_RATE)} of the charge, and that comes
                back to the wallet, so the hive pays only the{" "}
                {percent.format(JOB_TAX_RATE)}. Or the developer whose machine
                it is, as a perk: the wallet then pays the whole charge and the
                machine&apos;s share is credited to that developer.
              </Fact>
              <Fact title="Who may add machines">
                Every member of the organization, or only the GitHub teams you
                name. Owners always can. Someone removed from the organization
                on GitHub has their machines revoked.
              </Fact>
              <Fact title="Which machine gets a job">
                The fastest free machine, the least busy, or each in turn, so
                every machine gets a share of the work.
              </Fact>
              <Fact title="Whether macOS jobs run">
                Off until you turn it on. A <Code>hive-macos</Code> job runs on
                a member&apos;s Mac itself, as a separate user, not in a VM, so
                it is for code you trust, and only Macs whose owners opted in
                take one.
              </Fact>
              <Fact title="A monthly budget">
                Spend no more than an amount you choose a month on jobs. Owners
                and admins are emailed at {percent.format(BUDGET_WARNING_SHARE)}{" "}
                and again at the limit, and at the limit jobs either keep
                running or wait until next month. A job already running is never
                cut off.
              </Fact>
              <Fact title="Automatic top-up">
                When the balance falls below an amount, from{" "}
                {formatUsd(AUTO_TOP_UP_BELOW_USD_OPTIONS[0])}, the card on file
                is charged a fixed amount, with a monthly cap if you want one.
                Off, nothing is charged unless you add funds. A balance may go{" "}
                {formatUsd(OVERDRAFT_USD)} below zero before new jobs wait.
              </Fact>
            </Facts>
          </div>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <SectionHeading title="Or let your agent do it">
            <p>
              Hive Runner has an MCP server. Connect Claude Code, Cursor or
              Codex and it can set up your hive, change the workflow and watch
              the bill. There is no API key: you sign in with GitHub.
            </p>
            <SectionLink href="/docs/agents">Connect an agent</SectionLink>
            <div>
              <CopyButton text={setupPrompt(PRODUCT_ORIGIN)} variant="outline">
                Copy the setup prompt
              </CopyButton>
            </div>
          </SectionHeading>
          <div className="flex min-w-0 flex-col gap-6">
            <CodeBlock title="Claude Code" wrap>
              {mcpClients().claudeCode}
            </CodeBlock>
            <ul className="flex list-disc flex-col gap-2 pl-5 leading-7 text-muted-foreground">
              <li>
                Asks whether a job can start now, and says what is in the way
                when it cannot.
              </li>
              <li>
                Writes the <Code>runs-on</Code> change, with a fallback for when
                no machine is free.
              </li>
              <li>
                Reads jobs, signed receipts and what you have saved against
                GitHub-hosted runners.
              </li>
              <li>
                Sets a monthly budget and changes hive settings, when an owner
                allows it.
              </li>
            </ul>
          </div>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title="The questions a team asks first" />
          <div className="mt-10">
            <Facts>
              <Fact title="Will it slow down my Mac?">
                Every job leaves two cores for you. Jobs keep running on
                battery; closing the lid pauses new jobs and discards the idle
                VM. <Code>hived pause</Code> stops them altogether, and{" "}
                <Code>hived config</Code> sets how many jobs run at once, how
                large, and during which hours.
              </Fact>
              <Fact title="Is my code safe on a colleague's laptop?">
                A job runs in its own hardware-virtualized VM and the VM is
                destroyed when the job ends. It cannot read the Mac's files or
                keychain. The daemon runs as the user, not root, and opens no
                inbound ports: one outbound connection to Hive Runner, which
                carries assignments and no job data.
              </Fact>
              <Fact title="What if nobody's Mac is awake?">
                A job sent straight to a <Code>hive</Code> label waits in
                GitHub's queue until a Mac is free. The routed workflow above
                checks first and uses a GitHub-hosted runner when none is. A Mac
                nobody sits at can take jobs with its lid closed;{" "}
                <Code>hived doctor</Code> says what to set.
              </Fact>
              <Fact title="What can run on it?">
                Linux arm64 jobs, on Macs and on arm64 Linux machines with KVM.
                Linux x64 jobs have labels of their own and run on x64 Linux
                machines in your hive. For Xcode, <Code>hive-macos</Code> runs a
                job on a member's Mac itself, as a separate user, once the Mac's
                owner and your hive have both opted in. Docker is in every Linux
                VM, for <Code>docker build</Code>, <Code>services:</Code> and{" "}
                <Code>container:</Code>. Actions and container images a job uses
                need an arm64 build. Not yet: Windows and GPU jobs.
              </Fact>
              <Fact title="Who can add a machine?">
                Anyone who belongs to your GitHub organization, by installing
                the daemon and signing in with GitHub. There are no invite
                codes. Owners can narrow it to specific teams, and when someone
                is removed from the organization on GitHub their machines are
                revoked.
              </Fact>
              <Fact title="What does it cost to try?">
                Every new organization starts with {formatUsd(TRIAL_GRANT_USD)}{" "}
                of credit and no card is needed. With a card on file it is{" "}
                {formatUsd(TRIAL_GRANT_WITH_CARD_USD)}. The GitHub App asks for{" "}
                {APP_PERMISSIONS.length} permissions, and none of them reads
                code.
              </Fact>
            </Facts>
          </div>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <SectionHeading title="A job never touches the Mac it runs on">
            <p>
              Every job gets its own hardware-virtualized VM, destroyed when the
              job ends. The runner inside it talks to GitHub directly. Hive
              Runner assigns the job and is not in its data path.
            </p>
            <SectionLink href="/security">
              How isolation and trust work
            </SectionLink>
          </SectionHeading>
          <IsolationDiagram />
        </Container>
      </section>

      <section className="border-t border-border bg-primary py-14 text-primary-foreground sm:py-16">
        <Container className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-heading text-2xl leading-tight font-medium tracking-tight text-balance sm:text-3xl">
              Try it on one workflow
            </h2>
            <p className="mt-3 text-lg leading-8">
              Every new organization starts with {formatUsd(TRIAL_GRANT_USD)} of
              credit, and no card is needed. Route one workflow and leave the
              rest alone.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              nativeButton={false}
              size="lg"
              className="h-11 bg-primary-foreground px-5 font-mono text-sm text-primary hover:bg-primary-foreground/85"
              render={<RouteLink to="/install" />}
            >
              Install the GitHub App
            </Button>
            <Button
              nativeButton={false}
              size="lg"
              variant="ghost"
              className="h-11 border-primary-foreground/40 px-5 font-mono text-sm hover:bg-primary-foreground/10 hover:text-primary-foreground dark:hover:bg-primary-foreground/10"
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
