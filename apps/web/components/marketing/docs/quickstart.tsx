import Link from "next/link"
import { RUNNER_SIZES } from "@workspace/pricing"
import { Code, CodeBlock } from "../code"
import { INSTALL_COMMAND } from "../site"
import { WorkflowDiff } from "../workflow-diff"
import { RouteLink } from "@/components/route-link"

export function Quickstart() {
  return (
    <>
      <p>
        Three things have to happen once: an owner installs the GitHub App, at
        least one developer adds a Mac, and a workflow asks for a{" "}
        <Code>hive</Code> runner.
      </p>

      <h2 id="install">1. Install the GitHub App</h2>
      <p>
        Go to <RouteLink to="/install">Install</RouteLink> and choose your
        organization. You need to be an organization owner. If you are not,
        GitHub sends the request to the owners and the install completes when
        one of them approves it.
      </p>
      <p>Installing creates three things:</p>
      <ul>
        <li>
          The runner labels{" "}
          {RUNNER_SIZES.map((size, index) => (
            <span key={size.label}>
              {index > 0 ? ", " : null}
              <Code>{size.label}</Code>
            </span>
          ))}
          .
        </li>
        <li>A private pool for your organization's machines.</li>
        <li>A wallet for the organization, holding the trial grant.</li>
      </ul>
      <p>
        HiveWorker works with GitHub organizations. Personal accounts are not
        supported in the first release.
      </p>

      <h2 id="add-a-machine">2. Add a machine</h2>
      <p>On an Apple Silicon Mac, install the daemon:</p>
      <CodeBlock title="Terminal" wrap>
        {INSTALL_COMMAND}
      </CodeBlock>
      <p>
        The daemon is not released yet, so this command does not work today. See{" "}
        <Link href="/download">Download</Link> for status.
      </p>
      <p>
        The daemon opens a browser window. Sign in with GitHub and approve the
        machine. If you belong to more than one organization that uses
        HiveWorker, you pick which pool the machine joins. The daemon then runs
        a short benchmark and reports as online.
      </p>

      <h2 id="change-one-line">3. Change one line</h2>
      <p>
        In a workflow, change the job's <Code>runs-on</Code>:
      </p>
      <WorkflowDiff />
      <p>
        Push the change. The job runs on a machine in your pool and reports to
        GitHub as usual: logs, artifacts and checks appear where they always
        have.
      </p>

      <h2 id="next">What to check next</h2>
      <ul>
        <li>
          Jobs run in a Linux arm64 VM. See{" "}
          <Link href="/docs/labels-and-sizes">Labels and sizes</Link> for what
          that means for your actions and images.
        </li>
        <li>
          If no machine is free, the job waits in GitHub's queue. See{" "}
          <Link href="/docs/pools">Pools</Link>.
        </li>
      </ul>
    </>
  )
}
