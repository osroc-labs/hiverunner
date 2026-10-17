import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { Container } from "@workspace/ui-shell/components/page-header"
import {
  JOB_TAX_RATE,
  OWNER_CORES,
  RUNNER_SIZES,
  microTokensToUsd,
  priceJob,
} from "@workspace/pricing"
import { Code, CodeBlock } from "@/components/marketing/code"
import { formatRate } from "@/components/marketing/format"
import { IsolationDiagram } from "@/components/marketing/isolation-diagram"
import {
  Fact,
  Facts,
  SectionHeading,
  SectionLink,
  textLink,
} from "@/components/marketing/page-parts"
import {
  DAEMON_MIN_MACOS,
  INSTALL_COMMAND,
  INSTALL_SCRIPT_URL,
  WINDOWS_INSTALL_COMMAND,
} from "@/components/marketing/site"
import { RouteLink } from "@/components/route-link"
import { BossNote } from "./boss-note"

export const metadata = {
  title: "For developers: lend your machine to your team's CI",
  description:
    "Run hived on your Mac or Linux machine and it takes your organization's GitHub Actions jobs in throwaway VMs, on your terms. What it does to your machine, what it earns, and how to get your organization set up.",
  alternates: { canonical: "/developers" },
}

const base = RUNNER_SIZES[0]
const percent = new Intl.NumberFormat("en-US", { style: "percent" })
/** What the machine's share of a job is, at reference speed. */
const earns = (seconds: number) =>
  microTokensToUsd(
    priceJob({ seconds, vcpus: base.vcpus, speedScore: 1 }).earning
  )

export default function DevelopersPage() {
  return (
    <>
      <section>
        <Container className="grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-14">
          <div>
            <h1 className="font-heading text-[2rem] leading-[1.12] font-medium tracking-tight text-balance sm:text-5xl sm:leading-[1.1]">
              Lend your machine to your team&apos;s CI, on your terms.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-pretty text-muted-foreground">
              <Code>hived</Code> is a small daemon. While your Mac or Linux
              machine is free, it takes your organization&apos;s GitHub Actions
              jobs and runs each one in a throwaway VM that cannot see your
              files. You decide when it lends, how much, and you can pause it
              with one command.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                nativeButton={false}
                size="lg"
                className="h-11 px-5 font-mono text-sm"
                render={<Link href="#way-in" />}
              >
                Add your machine
              </Button>
              <Button
                nativeButton={false}
                size="lg"
                variant="outline"
                className="h-11 px-5 font-mono text-sm"
                render={<Link href="#tell-your-boss" />}
              >
                Ask your organization
              </Button>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <CodeBlock title="Terminal" wrap>
              {INSTALL_COMMAND}
            </CodeBlock>
            <CodeBlock title="What you can change, any time">
              {`hived pause                     # stop taking jobs
hived resume
hived config set hours 22:00-07:00
hived config set max-jobs 2
hived config set battery off
hived status                    # what it is doing, and why`}
            </CodeBlock>
          </div>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <SectionHeading title="A job never touches your machine">
            <p>
              Every job gets its own hardware-virtualized VM, with its own
              kernel and disk, destroyed when the job ends. The only thing
              shared with it is a fresh directory holding the runner&apos;s
              one-time configuration. Your files, keychain and credentials stay
              on the host.
            </p>
            <p>
              The daemon runs as you, never as root, and opens no inbound ports:
              one outbound connection to Hive Runner, which carries assignments
              and no job data.
            </p>
            <SectionLink href="/security">
              How isolation and trust work
            </SectionLink>
          </SectionHeading>
          <IsolationDiagram />
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title="Your machine comes first">
            <p>
              The daemon lends what you are not using and gives way when you
              need it. <Code>hived config</Code> shows every setting.
            </p>
          </SectionHeading>
          <div className="mt-10">
            <Facts>
              <Fact title="Cores held back">
                Every job leaves {OWNER_CORES} cores for you. A machine runs one
                job at a time unless you raise <Code>max-jobs</Code>, up to 8,
                and <Code>max-vcpus</Code> caps how large a job it takes.
              </Fact>
              <Fact title="Pause, and hours">
                <Code>hived pause</Code> stops new jobs and{" "}
                <Code>hived resume</Code> starts them again. <Code>hours</Code>{" "}
                limits when jobs may start, such as overnight. A job already
                running always finishes.
              </Fact>
              <Fact title="Lid and battery">
                Closing the lid pauses new jobs and discards the idle VM, unless
                you set <Code>lid on</Code>. Jobs keep running on battery unless
                you set <Code>battery off</Code>.
              </Fact>
              <Fact title="It keeps itself current">
                Once a day it checks for a release. With{" "}
                <Code>auto-update</Code> on, as it is by default, it waits for
                the job in hand, then updates and restarts. Turn it off to
                update with <Code>hived update</Code> yourself.
              </Fact>
              <Fact title="Disk">
                It needs about 3 GB free. The local Actions cache keeps to a
                size you can set, and both can live on another disk.
              </Fact>
              <Fact title="Leaving">
                <Code>hived logout --revoke</Code> retires the machine on the
                server, and <Code>hived uninstall</Code> removes everything it
                installed, after asking.
              </Fact>
            </Facts>
          </div>
          <p className="mt-8 text-base">
            <Link href="/docs/daemon" className={textLink}>
              Every command and setting
            </Link>
          </p>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title="What it runs on" />
          <ul className="mt-10 grid border-t border-l border-border md:grid-cols-3">
            <Cell title="A Mac with Apple Silicon">
              <p>
                macOS {DAEMON_MIN_MACOS} or later. It takes Linux arm64 jobs,
                and with <Code>hived macos setup</Code> it can also take{" "}
                <Code>hive-macos</Code> jobs for Xcode, as a separate user, if
                your hive allows them. Intel Macs are not supported.
              </p>
            </Cell>
            <Cell title="Linux with KVM">
              <p>
                arm64 or x86-64, on bare metal or a home server; a cloud VM
                needs nested virtualization. Each takes the jobs for its own
                architecture. It needs QEMU, virtiofsd and passt, and the
                installer says what is missing.
              </p>
            </Cell>
            <Cell title="Windows 11, through WSL 2">
              <p>
                An Intel or AMD PC runs the Linux x86-64 daemon in a Linux of
                its own, and takes x64 jobs while you are signed in to Windows.
              </p>
              <CodeBlock title="PowerShell" wrap>
                {WINDOWS_INSTALL_COMMAND}
              </CodeBlock>
            </Cell>
          </ul>
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container>
          <SectionHeading title="What your machine earns">
            <p>
              Each hive&apos;s owner chooses who is paid when a member&apos;s
              machine runs a job: the organization, which is the default, or the
              developer whose machine it is. When it is the organization, what
              your machine earns goes back to the hive&apos;s own balance and
              lowers its bill.
            </p>
            <p>
              When the owner picks you, your machine&apos;s share of each job,
              everything except Hive Runner&apos;s{" "}
              {percent.format(JOB_TAX_RATE)}, is credited to your own Hive
              Runner balance. At reference speed a {base.vcpus} vCPU job earns{" "}
              {formatRate(earns(60))} a minute, or {formatRate(earns(3600))} for
              an hour of work, and a faster machine earns more per minute.
            </p>
            <p>
              There is no cash-out yet. The credit builds up in Hive Runner, and
              cash-out is coming. Until then, do not count on it as money you
              can withdraw.
            </p>
          </SectionHeading>
        </Container>
      </section>

      <section
        id="way-in"
        className="scroll-mt-28 border-t border-border py-14 sm:py-20"
      >
        <Container>
          <SectionHeading title="Your way in">
            <p>
              A machine joins a hive because you belong to a GitHub organization
              that has Hive Runner installed. Which of these is you?
            </p>
          </SectionHeading>
          <ul className="mt-10 grid border-t border-l border-border lg:grid-cols-3">
            <Cell title="My organization already uses it">
              <p>
                Run the install command on your machine. It opens a browser to
                sign in with GitHub and approve the machine, then starts the
                daemon. If the browser step does not finish, run{" "}
                <Code>hived login</Code>.
              </p>
              <CodeBlock title="Terminal" wrap>
                {INSTALL_COMMAND}
              </CodeBlock>
              <p className="text-sm">
                <Link href="/download" className={textLink}>
                  What it installs
                </Link>
              </p>
            </Cell>
            <Cell title="It doesn't, and I am not an owner">
              <p>
                Ask for it on GitHub. Only an organization owner can install a
                GitHub App, so for anyone else GitHub turns the install into a
                request and sends it to the owners. Hive Runner is ready as soon
                as one of them approves it, and your machine can join then.
              </p>
              <div>
                <Button
                  nativeButton={false}
                  variant="outline"
                  className="font-mono text-xs"
                  render={<RouteLink to="/install" />}
                >
                  Request the install on GitHub
                </Button>
              </div>
            </Cell>
            <Cell title="They will want a reason first">
              <p>
                Send the owner a short note: what it costs, why it is safe, and
                where to install it. There is one below to copy or email.
              </p>
              <p className="text-sm">
                <Link href="#tell-your-boss" className={textLink}>
                  The note
                </Link>
              </p>
            </Cell>
          </ul>
        </Container>
      </section>

      <section
        id="tell-your-boss"
        className="scroll-mt-28 border-t border-border py-14 sm:py-20"
      >
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <SectionHeading title="Send this to your boss">
            <p>
              Four short paragraphs an organization owner can say yes to:
              savings, security and the link to install. Copy it into Slack, or
              open it as an email with no recipient filled in.
            </p>
            <SectionLink href="/orgs">The page it points them to</SectionLink>
          </SectionHeading>
          <BossNote />
        </Container>
      </section>

      <section className="border-t border-border py-14 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <SectionHeading title="Or let an agent add the machine">
            <p>
              An agent with a shell on the machine can add it with no browser. A
              hive owner or admin mints an enroll key with the MCP tool{" "}
              <Code>create_enroll_key</Code>. It is for one hive, expires, can
              be limited to a number of machines, and is shown once. Every
              machine it enrolls belongs to whoever minted it.
            </p>
            <SectionLink href="/docs/agents">Agents and MCP</SectionLink>
          </SectionHeading>
          <div className="flex min-w-0 flex-col gap-6">
            <CodeBlock title="Install and enroll" wrap>
              {`curl -fsSL ${INSTALL_SCRIPT_URL} | HIVE_ENROLL_KEY=hwe_... sh -s -- --hive acme`}
            </CodeBlock>
            <CodeBlock title="Or, with the daemon installed" wrap>
              {"HIVE_ENROLL_KEY=hwe_... hived login --hive acme"}
            </CodeBlock>
          </div>
        </Container>
      </section>

      <section className="border-t border-border bg-primary py-14 text-primary-foreground sm:py-16">
        <Container className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-heading text-2xl leading-tight font-medium tracking-tight text-balance sm:text-3xl">
              Start with one machine
            </h2>
            <p className="mt-3 text-lg leading-8">
              Install the daemon, sign in with GitHub, and pause it whenever you
              like. Removing it is one command.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              nativeButton={false}
              size="lg"
              className="h-11 bg-primary-foreground px-5 font-mono text-sm text-primary hover:bg-primary-foreground/85"
              render={<Link href="/download" />}
            >
              Download the daemon
            </Button>
            <Button
              nativeButton={false}
              size="lg"
              variant="ghost"
              className="h-11 border-primary-foreground/40 px-5 font-mono text-sm hover:bg-primary-foreground/10 hover:text-primary-foreground dark:hover:bg-primary-foreground/10"
              render={<Link href="/sign-in" />}
            >
              Sign in with GitHub
            </Button>
          </div>
        </Container>
      </section>
    </>
  )
}

/** One of a few alternatives, as a cell of a ruled grid. */
function Cell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex min-w-0 flex-col gap-3 border-r border-b border-border p-6 sm:p-8">
      <h3 className="font-heading text-base font-normal tracking-tight">
        {title}
      </h3>
      <div className="flex flex-col gap-4 leading-7 text-muted-foreground">
        {children}
      </div>
    </li>
  )
}
