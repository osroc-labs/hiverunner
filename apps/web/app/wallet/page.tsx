import { getBalance, listEntries } from "@workspace/db/ledger"
import { TRIAL_GRANT_USD } from "@workspace/pricing"

import { AccountPage } from "@/components/account-page"
import { getDb } from "@/db"
import { formatTokens, formatUsdEstimate } from "@/lib/format"
import { requirePool } from "@/lib/session"

export const metadata = { title: "Wallet" }

const kinds: Record<string, string> = {
  grant: "Trial grant",
  purchase: "Purchase",
  charge: "Job",
  earning: "Earned by a machine",
  tax: "Network tax",
}

export default async function WalletPage() {
  const { organizationId, installation } = await requirePool()
  const account = {
    accountType: "organization" as const,
    accountId: organizationId,
  }
  const db = getDb()
  const [balance, entries] = await Promise.all([
    getBalance(db, account),
    listEntries(db, account),
  ])
  return (
    <AccountPage title="Wallet">
      <section>
        <p className="text-sm text-muted-foreground">
          {installation.accountLogin} balance
        </p>
        <p className="text-4xl font-semibold tabular-nums">
          {formatTokens(balance)}
        </p>
        <p className="text-sm text-muted-foreground">
          HiveWorker tokens, about {formatUsdEstimate(balance)}. Every new
          organization starts with a ${TRIAL_GRANT_USD} grant.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Activity</h2>
        {!entries.length && <p>Nothing yet.</p>}
        <ul className="divide-y rounded-lg border">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div>
                <p className="font-medium">{kinds[entry.kind] ?? entry.kind}</p>
                <p className="text-sm text-muted-foreground">
                  {entry.createdAt.toLocaleDateString("en-US", {
                    dateStyle: "medium",
                  })}
                </p>
              </div>
              <p className="tabular-nums">
                {entry.amount > 0 ? "+" : ""}
                {formatTokens(entry.amount)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </AccountPage>
  )
}
