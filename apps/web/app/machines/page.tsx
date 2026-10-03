import Link from "next/link"
import { roleAtLeast } from "@workspace/auth"
import { listMachines, listUserMachines } from "@workspace/db/machines"

import { AccountPage } from "@/components/account-page"
import { ActionButton } from "@/components/action-button"
import { getDb } from "@/db"
import { requirePool } from "@/lib/session"

export const metadata = { title: "Machines" }

const gib = (bytes: number) => `${Math.round(bytes / 2 ** 30)} GB`

export default async function MachinesPage() {
  const { organizationId, installation, membership, session } =
    await requirePool()
  const db = getDb()
  const [machines, own] = await Promise.all([
    listMachines(db, organizationId),
    listUserMachines(db, session.user.id),
  ])
  // The caller's machines that serve other pools but not this one.
  const addable = own.filter(
    (mine) => !machines.some((machine) => machine.id === mine.id)
  )
  const owner = roleAtLeast(membership.role, "owner")
  return (
    <AccountPage title="Machines">
      <p className="text-muted-foreground">
        Computers serving the {installation.accountLogin} pool. Each belongs to
        the person who enrolled it and leaves this pool when they leave the
        organization. One machine can serve several organizations.
      </p>
      {!machines.length && (
        <p>
          None yet.{" "}
          <Link className="underline" href="/download">
            Install the daemon
          </Link>{" "}
          on an Apple Silicon Mac and sign in with GitHub.
        </p>
      )}
      <ul className="space-y-3">
        {machines.map((machine) => (
          <li
            key={machine.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
          >
            <div>
              <p className="font-medium">
                {machine.name}{" "}
                <span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  {machine.presence}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {machine.model} · {machine.cores} cores ·{" "}
                {gib(machine.memoryBytes)} · speed{" "}
                {machine.speedScore.toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">
                {machine.owner} ·{" "}
                {machine.lastSeenAt
                  ? `last seen ${machine.lastSeenAt.toLocaleString("en-US")}`
                  : "not connected yet"}
              </p>
            </div>
            {(owner || machine.userId === session.user.id) && (
              <ActionButton
                label="Remove from this pool"
                path="/api/machines/revoke"
                body={{ machineId: machine.id, organizationId }}
              />
            )}
          </li>
        ))}
      </ul>
      {addable.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Add one of your machines</h2>
          <p className="text-sm text-muted-foreground">
            These already run HiveWorker for another organization. Adding one
            here needs nothing installed; its daemon picks this pool up within a
            minute.
          </p>
          <ul className="space-y-3">
            {addable.map((machine) => (
              <li
                key={machine.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              >
                <p className="font-medium">
                  {machine.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    {machine.model}
                  </span>
                </p>
                <ActionButton
                  label={`Add to ${installation.accountLogin}`}
                  path="/api/machines/pools"
                  body={{ machineId: machine.id, organizationId }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </AccountPage>
  )
}
