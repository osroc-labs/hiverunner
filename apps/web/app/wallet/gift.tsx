"use client"

import { useCallback, useEffect, useState } from "react"
import { BuffaloSpin } from "./buffalo-spin"

/**
 * One quiet line under a payment, and everything it leads to. `expecting`
 * says a payment was just made: its gift exists once the card network
 * confirms it, so the line waits for that rather than for a reload.
 */
export function Gift({
  waiting,
  expecting,
  shares,
}: {
  waiting: number
  expecting: boolean
  shares: readonly number[]
}) {
  const [count, setCount] = useState(waiting)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (count > 0 || !expecting) return
    let tries = 0
    const timer = window.setInterval(async () => {
      if (++tries >= 15) window.clearInterval(timer)
      const response = await fetch("/api/wallet/gift").catch(() => null)
      if (!response?.ok) return
      const body = (await response.json().catch(() => ({}))) as {
        waiting?: number
      }
      if (body.waiting) {
        window.clearInterval(timer)
        setCount(body.waiting)
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [count, expecting])

  const close = useCallback((won: boolean) => {
    setOpen(false)
    // The balance and the activity on the page are from before the gift.
    if (won) window.location.assign("/wallet")
  }, [])

  if (!count && !open) return null
  return (
    <>
      <button
        type="button"
        className="self-start font-mono text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-primary"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">🎁 </span>
        {count > 1
          ? `${count} top-ups came with a gift.`
          : "Your top-up came with a gift."}{" "}
        Spin for up to {Math.round(Math.max(...shares) * 100)}% back →
      </button>
      {open && <BuffaloSpin shares={shares} waiting={count} onClose={close} />}
    </>
  )
}
