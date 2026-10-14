import { headers } from "next/headers"
import { listUserMachineHives, listUserMachines } from "@workspace/db/machines"
import { AccountPage } from "@/components/account-page"
import { Panel } from "@/components/console/panel"
import { ActionButton } from "@/components/action-button"
import { getDb } from "@/db"
import { requireServerSession } from "@/lib/session"
import { auth } from "@/lib/auth"
import { AccountForm } from "./account-form"
export default async function Page() {
  const current = await requireServerSession()
  const db = getDb()
  const [sessions, machines, serving] = await Promise.all([
    auth.api.listSessions({ headers: await headers() }),
    listUserMachines(db, current.user.id),
    listUserMachineHives(db, current.user.id),
  ])
  return (
    <AccountPage title="account">
      <p className="font-mono text-sm text-muted-foreground">
        {current.user.email} · signed in with GitHub
      </p>
      <Panel title="profile" className="max-w-3xl">
        <AccountForm name={current.user.name} />
      </Panel>
      {machines.length > 0 && (
        <Panel title="your machines" className="max-w-3xl" flush>
          <p className="border-b border-border p-4 text-sm text-muted-foreground sm:px-6">
            These are yours, whichever hive you are looking at. With auto-join
            on, a machine joins each new hive you are an owner of, as that
            organization installs Hive Runner, without you adding it. It never
            joins a hive you are only a member of, and turning it on adds the
            machine to nothing you are in already. A machine you take out of a
            hive stays out.
          </p>
          <ul className="divide-y divide-border">
            {machines.map((machine) => {
              const hives = serving
                .filter((hive) => hive.machineId === machine.id)
                .map((hive) => hive.login)
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6"
                  key={machine.id}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm break-words">
                      {machine.name}{" "}
                      <span className="text-muted-foreground">
                        {machine.model}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {hives.length
                        ? `Serves ${hives.join(", ")}`
                        : "Serves no hive"}{" "}
                      · auto-join is {machine.autoJoin ? "on" : "off"}
                    </p>
                  </div>
                  <ActionButton
                    label={
                      machine.autoJoin
                        ? "Turn auto-join off"
                        : "Turn auto-join on"
                    }
                    path="/api/machines/auto-join"
                    body={{
                      machineId: machine.id,
                      autoJoin: !machine.autoJoin,
                    }}
                  />
                </li>
              )
            })}
          </ul>
        </Panel>
      )}
      <Panel title="signed-in devices" className="max-w-3xl" flush>
        <ul className="divide-y divide-border">
          {sessions.map((session) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6"
              key={session.id}
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs break-words">
                  {session.userAgent ?? "Unknown device"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Signed in {session.createdAt.toLocaleDateString("en-US")}
                  {session.id === current.session.id ? " · this device" : ""}
                </p>
              </div>
              <ActionButton
                label="Sign out device"
                path="/api/account/sessions"
                body={{ id: session.id }}
                redirectTo={
                  session.id === current.session.id ? "/sign-in" : undefined
                }
              />
            </li>
          ))}
        </ul>
      </Panel>
    </AccountPage>
  )
}
