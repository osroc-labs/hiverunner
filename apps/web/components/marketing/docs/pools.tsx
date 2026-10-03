import Link from "next/link"

export function Pools() {
  return (
    <>
      <p>
        A pool is the set of machines that can run an organization's jobs.
        Installing the GitHub App creates one private pool for the organization.
      </p>

      <h2 id="who-can-join">Who can add machines</h2>
      <p>
        Any member of the GitHub organization that installed the App can add a
        machine by installing the daemon and signing in with GitHub. There are
        no invite codes. Organization admins can narrow this to specific GitHub
        teams.
      </p>
      <p>
        GitHub is the source of truth for membership. When a person is removed
        from the organization, their machines are revoked and stop receiving
        jobs.
      </p>

      <h2 id="no-free-machine">When no machine is free</h2>
      <p>
        The job stays queued at GitHub until a machine of the right size is
        free. HiveWorker does not fall back to another kind of runner. If a job
        must not wait, keep it on its current runner.
      </p>

      <h2 id="empty-wallet">When the wallet is empty</h2>
      <p>
        HiveWorker stops taking new jobs for the organization. They wait in
        GitHub's queue and the dashboard says why. Jobs already running are not
        interrupted.
      </p>

      <h2 id="public-pool">The public pool</h2>
      <p>
        Private pools are the product today. A public pool, where jobs can
        overflow to machines outside your organization, comes later. It will be
        opt-in per repository and limited to jobs that use no secrets. See{" "}
        <Link href="/security">Security</Link> for the trust model.
      </p>
    </>
  )
}
