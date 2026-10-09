"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Notice } from "@/components/console/panel"

/** How long Stripe's event is waited for before Stripe is asked instead. */
const ASK_AFTER_MS = 10_000
/** How long a payment may take to land before the page says so. */
const PATIENCE_MS = 30_000

/**
 * What the page says on the way back from Checkout. The balance is credited
 * by Stripe's signed event, which can arrive after the browser does, so the
 * page asks again until the payment is in and then says that it is. An
 * event that has not come after a while is not waited on: the server checks
 * the payment with Stripe itself. `checkout` names the payment, and is null
 * when the link did not say which one to look for.
 */
export function Funded({
  amount,
  checkout,
  credited,
}: {
  amount: number
  checkout: string | null
  credited: boolean | null
}) {
  const router = useRouter()
  const [late, setLate] = useState(false)

  useEffect(() => {
    if (credited !== false) return
    const started = Date.now()
    let asked = false
    const timer = window.setInterval(async () => {
      const waited = Date.now() - started
      if (waited >= PATIENCE_MS) {
        window.clearInterval(timer)
        setLate(true)
        return
      }
      if (checkout && !asked && waited >= ASK_AFTER_MS) {
        asked = true
        await fetch("/api/wallet/top-up/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkout }),
        }).catch(() => null)
      }
      router.refresh()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [checkout, credited, router])

  if (credited)
    return <Notice>Thanks. ${amount} was added to the balance.</Notice>
  if (credited === false && late)
    return (
      <Notice tone="alert">
        Your ${amount} payment went through, but it has not reached the balance
        yet, which is taking longer than it should. You will not be charged
        again and do not need to pay again. Reload this page in a minute, and if
        it is still missing, tell us and we will add it.
      </Notice>
    )
  return (
    <Notice>
      Thanks. Your ${amount} payment was received. Adding it to the balance…
    </Notice>
  )
}
