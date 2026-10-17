import { Button } from "@workspace/ui/components/button"
import {
  RUNNER_SIZES,
  TRIAL_GRANT_USD,
  competitorUsdPerMinute,
  privatePoolUsdPerMinute,
} from "@workspace/pricing"
import { CopyButton } from "@/components/console/invite"
import {
  formatMultiple,
  formatRate,
  formatUsd,
} from "@/components/marketing/format"
import { PRODUCT_ORIGIN } from "@/components/marketing/site"

const base = RUNNER_SIZES[0]
const ours = privatePoolUsdPerMinute(base.vcpus).net
const github = competitorUsdPerMinute("github", base.vcpus)

const BOSS_SUBJECT = "Running our GitHub Actions jobs on our own machines"

/**
 * What a developer sends an organization owner to ask for the install. Every
 * number comes from `@workspace/pricing`, so the note cannot quote a price the
 * meter does not charge.
 */
function bossMessage(origin = PRODUCT_ORIGIN) {
  return `I'd like us to try Hive Runner for our GitHub Actions jobs. We keep our workflows and change only runs-on; each job then runs in a throwaway VM on a Mac or Linux machine one of us already has. Jobs we do not move keep running where they do now.

A ${base.vcpus} vCPU minute costs ${formatRate(ours)} on our own machines, against ${formatRate(github)} on a GitHub-hosted runner: ${formatMultiple(github / ours)} less. There is no subscription or seat fee, and a new organization starts with ${formatUsd(TRIAL_GRANT_USD)} of credit, no card needed.

On security: its GitHub App cannot read code, repository contents or secrets. Each job's VM is destroyed when the job ends, and only members of our GitHub organization can add machines.

An owner installs it from ${origin}/orgs, and how it keeps jobs isolated is at ${origin}/security.`
}

export function BossNote() {
  const message = bossMessage()
  const mailto = `mailto:?subject=${encodeURIComponent(BOSS_SUBJECT)}&body=${encodeURIComponent(message)}`
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <figure className="border border-border">
        <figcaption className="border-b border-border px-4 py-2.5 font-mono text-xs text-muted-foreground">
          {BOSS_SUBJECT}
        </figcaption>
        <div className="flex flex-col gap-4 px-4 py-4 leading-7 text-pretty sm:px-5">
          {message.split("\n\n").map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </figure>
      <div className="flex flex-wrap gap-3">
        <CopyButton text={message} className="font-mono text-xs">
          Copy the note
        </CopyButton>
        <Button
          nativeButton={false}
          variant="outline"
          className="font-mono text-xs"
          render={<a href={mailto} />}
        >
          Open it as an email
        </Button>
      </div>
    </div>
  )
}
