"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"

/**
 * The slot machine a gift is opened in. It is theatre: the prize was decided
 * and credited by the server before a reel stops, and the reels are dealt to
 * match it. How many buffalo land is the prize, as the paytable says.
 */

/** What the server answers when a gift is opened. Amounts are micro-tokens. */
type Gift = {
  prize: number
  amount: number
  capped: boolean
  paid: number
  left: number
}

const REELS = 5
const ROWS = 3
const BUFFALO = "🦬"
const OTHERS = ["🦅", "🐺", "🐆", "🦌", "🌵", "💰", "A", "K", "Q", "J", "10"]
/** How many buffalo land for each prize, commonest first. */
const HERD = [3, 4, 5, 7, 10, 15]
const CALLS = [
  "NICE WIN",
  "SWEET WIN",
  "BIG WIN",
  "HUGE WIN",
  "MEGA WIN",
  "STAMPEDE JACKPOT",
]
const COUNT_UP_MS = [1200, 1600, 2400, 3400, 4800, 7000]
const COINS = [40, 70, 120, 200, 320, 600]
const STAMPEDE = [4, 7, 12, 18, 26, 40]
const FIREWORKS = [0, 0, 5, 10, 18, 36]
const TITLE = "HIVE STAMPEDE"
const CHEERS = [
  "BUFFALO!",
  "BUFFALO!!",
  "MORE BUFFALO!",
  "SO MANY BUFFALO!!",
  "BUFFALOOOOO!!!",
]

const pick = <T,>(from: readonly T[]) =>
  from[Math.floor(Math.random() * from.length)]!
const filler = (length: number) => Array.from({ length }, () => pick(OTHERS))
const dollars = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`

type Round = {
  /** What each reel stops on, top to bottom. */
  columns: string[][]
  /** What rolls past before it does. */
  fills: string[][]
  /** When each reel stops, in milliseconds from the start. */
  stops: number[]
  /** Reels that hang on, because enough buffalo are already down. */
  hot: boolean[]
}

/** Reels that show `herd` buffalo, wherever they happen to fall. */
function deal(herd: number, calm: boolean): Round {
  const cells = Array.from({ length: REELS * ROWS }, (_, index) => index)
  for (let index = cells.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[cells[index], cells[other]] = [cells[other]!, cells[index]!]
  }
  const buffalo = new Set(cells.slice(0, herd))
  const columns = Array.from({ length: REELS }, (_, reel) =>
    Array.from({ length: ROWS }, (_, row) =>
      buffalo.has(reel * ROWS + row) ? BUFFALO : pick(OTHERS)
    )
  )
  const stops: number[] = []
  const hot: boolean[] = []
  let down = 0
  for (const [reel, column] of columns.entries()) {
    hot.push(!calm && reel > 0 && down >= 3)
    stops.push(calm ? 300 : (stops[reel - 1] ?? 650) + (hot[reel] ? 1500 : 450))
    down += column.filter((symbol) => symbol === BUFFALO).length
  }
  return {
    columns,
    stops,
    hot,
    fills: stops.map((stop) => filler(Math.round(stop / 55))),
  }
}

/** Every sound is synthesized, so there is no audio to ship or license. */
function makeSound() {
  const context = new AudioContext()
  const out = context.createGain()
  out.gain.value = 0.6
  out.connect(context.destination)

  function tone(
    frequency: number,
    {
      at = 0,
      length = 0.1,
      type = "square" as OscillatorType,
      volume = 0.12,
      to = 0,
    } = {}
  ) {
    const start = context.currentTime + at
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, start)
    if (to)
      oscillator.frequency.exponentialRampToValueAtTime(to, start + length)
    gain.gain.setValueAtTime(volume, start)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
    oscillator.connect(gain).connect(out)
    oscillator.start(start)
    oscillator.stop(start + length + 0.02)
  }

  function rumble(length: number, volume: number) {
    const buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * length),
      context.sampleRate
    )
    const samples = buffer.getChannelData(0)
    for (let index = 0; index < samples.length; index++)
      samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length)
    const source = context.createBufferSource()
    const low = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    low.type = "lowpass"
    low.frequency.value = 220
    gain.gain.value = volume
    source.connect(low).connect(gain).connect(out)
    source.start()
  }

  return {
    mute: (muted: boolean) => (out.gain.value = muted ? 0 : 0.6),
    wake: () => void context.resume(),
    close: () => void context.close(),
    tick: () =>
      tone(700 + Math.random() * 500, { length: 0.03, volume: 0.035 }),
    thud: () =>
      tone(180, { length: 0.12, type: "triangle", volume: 0.3, to: 70 }),
    stomp() {
      tone(130, { length: 0.4, type: "sine", volume: 0.7, to: 32 })
      rumble(0.35, 0.5)
    },
    riser: () =>
      tone(180, { length: 1.5, type: "sawtooth", volume: 0.07, to: 1400 }),
    coin: () =>
      tone(1700 + Math.random() * 900, {
        length: 0.08,
        type: "triangle",
        volume: 0.07,
      }),
    /** Hooves, for as long as the herd is on screen. */
    gallop(seconds: number) {
      for (let at = 0; at < seconds; at += 0.34)
        for (const beat of [0, 0.08, 0.17])
          tone(95, {
            at: at + beat,
            length: 0.09,
            type: "sine",
            volume: 0.4,
            to: 42,
          })
    },
    /** The win being called up a size. */
    level(step: number) {
      const lift = 2 ** (step / 6)
      tone(392 * lift, { length: 0.3, type: "sawtooth", volume: 0.1 })
      tone(196 * lift, { length: 0.35, volume: 0.1 })
      tone(784 * lift, { length: 0.2, type: "triangle", volume: 0.08 })
    },
    fanfare(prize: number) {
      const notes = [523.25, 659.25, 783.99, 1046.5]
      const runs = 2 + prize * 2
      for (let run = 0; run < runs; run++)
        for (const [step, note] of notes.entries()) {
          const at = (run * notes.length + step) * 0.085
          const lift = 2 ** ((run % 3) / 12)
          tone(note * lift, { at, length: 0.12, volume: 0.1 })
          tone(note * lift * 2, {
            at,
            length: 0.1,
            type: "triangle",
            volume: 0.06,
          })
        }
      const end = runs * notes.length * 0.085
      for (const note of [523.25, 659.25, 783.99, 1046.5, 1318.5])
        tone(note, { at: end, length: 1.4, type: "sawtooth", volume: 0.05 })
    },
  }
}

type Sound = ReturnType<typeof makeSound>

function Cell({ symbol, hit }: { symbol: string; hit?: boolean }) {
  const face = symbol.length <= 2 && /^[AKQJ1]/.test(symbol)
  return (
    <span
      className={`bfl-symbol${face ? " bfl-face" : ""}${hit ? " bfl-hit" : ""}`}
      data-face={face ? symbol : undefined}
    >
      {symbol}
    </span>
  )
}

function Reel({
  mode,
  column,
  fill,
  ms,
  landed,
  hot,
}: {
  mode: "still" | "roll" | "land"
  column: string[]
  fill: string[]
  ms: number
  landed: boolean
  hot: boolean
}) {
  // A roll ends on the symbols it began with, so the loop has no seam.
  const [loop] = useState(() => {
    const strip = filler(9)
    return [...strip, ...strip.slice(0, ROWS)]
  })
  const [spare] = useState(() => pick(OTHERS))
  if (mode === "roll")
    return (
      <div className="bfl-reel">
        <div className="bfl-strip bfl-rolling">
          {loop.map((symbol, index) => (
            <Cell key={index} symbol={symbol} />
          ))}
        </div>
      </div>
    )
  // One spare symbol sits above the window for the reel to bounce into.
  const strip = [spare, ...column, ...(mode === "land" ? fill : [])]
  return (
    <div className={`bfl-reel${hot && !landed ? " bfl-hot" : ""}`}>
      <div
        className={`bfl-strip${mode === "land" ? " bfl-landing" : ""}`}
        style={
          {
            "--from": -(strip.length - ROWS),
            animationDuration: `${ms}ms`,
          } as CSSProperties
        }
      >
        {strip.map((symbol, index) => (
          <Cell
            key={index}
            symbol={symbol}
            hit={landed && symbol === BUFFALO && index > 0 && index <= ROWS}
          />
        ))}
      </div>
    </div>
  )
}

/** Gold coins, thrown up from the bottom of the screen. */
function Coins({ count, ms }: { count: number; ms: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext("2d")
    if (!element || !context) return
    const scale = window.devicePixelRatio || 1
    const width = window.innerWidth
    const height = window.innerHeight
    element.width = width * scale
    element.height = height * scale
    context.scale(scale, scale)
    // A phone has less sky to fill, and the winnings should stay readable.
    const fits = Math.round(count * Math.min(1, Math.max(0.3, width / 1400)))
    const coins = Array.from({ length: fits }, () => ({
      born: Math.random() * ms,
      x: width * (0.15 + Math.random() * 0.7),
      y: height + 30,
      dx: (Math.random() - 0.5) * 14,
      dy: -(14 + Math.random() * 16),
      size: 9 + Math.random() * 13,
      turn: Math.random() * Math.PI,
      rate: 0.15 + Math.random() * 0.25,
    }))
    const began = performance.now()
    let frame = 0
    function draw(now: number) {
      const age = now - began
      context!.clearRect(0, 0, width, height)
      let live = false
      for (const coin of coins) {
        if (age < coin.born) {
          live = true
          continue
        }
        coin.dy += 0.55
        coin.x += coin.dx
        coin.y += coin.dy
        coin.turn += coin.rate
        if (coin.y > height + 60 && coin.dy > 0) continue
        live = true
        const squash = Math.abs(Math.cos(coin.turn))
        context!.beginPath()
        context!.ellipse(
          coin.x,
          coin.y,
          Math.max(1, coin.size * squash),
          coin.size,
          0,
          0,
          Math.PI * 2
        )
        context!.fillStyle = squash > 0.5 ? "#ffd84a" : "#e39a12"
        context!.fill()
        context!.lineWidth = 2
        context!.strokeStyle = "#8a4b00"
        context!.stroke()
      }
      if (live) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [count, ms])
  return <canvas ref={canvas} className="bfl-coins" aria-hidden="true" />
}

/** Fireworks over the mesas, for a win worth them. */
function Fireworks({ bursts, ms }: { bursts: number; ms: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext("2d")
    if (!element || !context) return
    const scale = window.devicePixelRatio || 1
    const width = window.innerWidth
    const height = window.innerHeight
    element.width = width * scale
    element.height = height * scale
    context.scale(scale, scale)
    context.globalCompositeOperation = "lighter"
    const sparks = Array.from({ length: bursts }, () => {
      const born = Math.random() * ms
      const x = width * (0.08 + Math.random() * 0.84)
      const y = height * (0.08 + Math.random() * 0.4)
      const hue = Math.random() * 360
      return Array.from({ length: 46 }, () => {
        const angle = Math.random() * Math.PI * 2
        const speed = 2 + Math.random() * 7
        return {
          born,
          x,
          y,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          hue: hue + Math.random() * 40,
          life: 50 + Math.random() * 40,
          age: 0,
        }
      })
    }).flat()
    const began = performance.now()
    let frame = 0
    function draw(now: number) {
      context!.clearRect(0, 0, width, height)
      let live = false
      for (const spark of sparks) {
        if (now - began < spark.born) {
          live = true
          continue
        }
        if (spark.age >= spark.life) continue
        live = true
        spark.age++
        spark.dx *= 0.97
        spark.dy = spark.dy * 0.97 + 0.06
        spark.x += spark.dx
        spark.y += spark.dy
        const fade = 1 - spark.age / spark.life
        context!.beginPath()
        context!.arc(spark.x, spark.y, 1 + 3 * fade, 0, Math.PI * 2)
        context!.fillStyle = `hsl(${spark.hue} 100% 65% / ${fade})`
        context!.fill()
      }
      if (live) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [bursts, ms])
  return <canvas ref={canvas} className="bfl-coins" aria-hidden="true" />
}

/** The herd, crossing the bottom of the screen. */
function Stampede({ herd }: { herd: number }) {
  const [runners] = useState(() =>
    Array.from({ length: herd }, () => ({
      bottom: Math.random() * 22,
      size: 2.5 + Math.random() * 4.5,
      delay: Math.random() * 2.2,
      ms: 1700 + Math.random() * 1600,
    }))
  )
  return (
    <div className="bfl-stampede" aria-hidden="true">
      {runners.map((runner, index) => (
        <span
          key={index}
          style={{
            bottom: `${runner.bottom}vh`,
            fontSize: `${runner.size}rem`,
            animationDelay: `${runner.delay}s`,
            animationDuration: `${runner.ms}ms`,
            zIndex: Math.round(30 - runner.bottom),
          }}
        >
          <i>{BUFFALO}</i>
        </span>
      ))}
    </div>
  )
}

export function BuffaloSpin({
  shares,
  waiting,
  onClose,
}: {
  /** The share of a payment each prize gives back, commonest first. */
  shares: readonly number[]
  waiting: number
  /** `won` says a gift was opened, so the balance on the page is stale. */
  onClose: (won: boolean) => void
}) {
  const [stage, setStage] = useState<
    "ready" | "asking" | "landing" | "won" | "error"
  >("ready")
  const [round, setRound] = useState<Round>(() => deal(2, true))
  const [landed, setLanded] = useState(REELS)
  const [gift, setGift] = useState<Gift | null>(null)
  const [left, setLeft] = useState(waiting)
  const [shown, setShown] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [spins, setSpins] = useState(0)
  /** How big the win has been called so far, as the count climbs. */
  const [level, setLevel] = useState(0)
  const [pops, setPops] = useState<
    { id: number; x: number; y: number; turn: number; words: string }[]
  >([])

  const machine = useRef<HTMLDivElement>(null)
  const cabinet = useRef<HTMLDivElement>(null)
  const popped = useRef(0)
  const sound = useRef<Sound | null>(null)
  const quiet = useRef(false)
  const timers = useRef<number[]>([])
  const ticking = useRef(0)
  const alive = useRef(true)
  const won = useRef(false)

  const busy = stage === "asking" || stage === "landing"

  function later(ms: number, run: () => void) {
    timers.current.push(window.setTimeout(run, ms))
  }

  function shout(words: string) {
    if (quiet.current || !("speechSynthesis" in window)) return
    const line = new SpeechSynthesisUtterance(words)
    line.pitch = 0.1
    line.rate = 0.75
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(line)
  }

  function shake(how: "shake" | "quake" | "rumble" = "shake") {
    const element = machine.current
    if (!element) return
    element.classList.remove("bfl-shake", "bfl-quake", "bfl-rumble")
    // Reading the width restarts the animation on the same element.
    void element.offsetWidth
    element.classList.add(`bfl-${how}`)
  }

  /** Words thrown at the screen, somewhere around the reels. */
  function pop(words: string) {
    const id = ++popped.current
    setPops((all) => [
      ...all,
      {
        id,
        words,
        x: 28 + Math.random() * 44,
        y: 16 + Math.random() * 44,
        turn: Math.random() * 36 - 18,
      },
    ])
    later(1200, () => setPops((all) => all.filter((one) => one.id !== id)))
  }

  /** The cabinet leans toward the pointer. */
  function lean(event: { clientX: number; clientY: number }) {
    const element = cabinet.current
    if (!element) return
    element.style.setProperty(
      "--lean-y",
      `${(event.clientX / window.innerWidth - 0.5) * 14}deg`
    )
    element.style.setProperty(
      "--lean-x",
      `${(0.5 - event.clientY / window.innerHeight) * 10}deg`
    )
  }

  function stopTicking() {
    window.clearInterval(ticking.current)
    ticking.current = 0
  }

  useEffect(() => {
    alive.current = true
    const scroll = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const pending = timers.current
    return () => {
      alive.current = false
      document.body.style.overflow = scroll
      pending.forEach((timer) => window.clearTimeout(timer))
      window.clearInterval(ticking.current)
      window.speechSynthesis?.cancel()
      sound.current?.close()
      sound.current = null
    }
  }, [])

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose(won.current)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [onClose])

  // The winnings count up; the credit itself was made before a reel stopped.
  useEffect(() => {
    if (stage !== "won" || !gift) return
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const ms = calm ? 1 : COUNT_UP_MS[gift.prize]!
    const began = performance.now()
    let frame = 0
    let rung = 0
    let called = 0
    function count(now: number) {
      const done = Math.min(1, (now - began) / ms)
      // A big win is called up a size at a time on the way to its total.
      const reached = Math.min(
        gift!.prize,
        Math.floor(done * (gift!.prize + 1))
      )
      if (reached !== called) {
        called = reached
        setLevel(reached)
        sound.current?.level(reached)
        const element = machine.current
        if (element && !calm) {
          element.classList.remove("bfl-shake", "bfl-quake", "bfl-rumble")
          void element.offsetWidth
          element.classList.add("bfl-quake")
        }
      }
      setShown(
        Math.round((gift!.amount * (1 - (1 - done) ** 2)) / 10_000) * 10_000
      )
      if (now - rung > 70 && done < 1) {
        sound.current?.coin()
        rung = now
      }
      if (done < 1) frame = requestAnimationFrame(count)
    }
    frame = requestAnimationFrame(count)
    return () => cancelAnimationFrame(frame)
  }, [stage, gift])

  async function spin() {
    if (busy) return
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    try {
      sound.current ??= makeSound()
      sound.current.mute(quiet.current)
      sound.current.wake()
    } catch {
      // No sound on this browser; the reels still turn.
    }
    setStage("asking")
    setError(null)
    setGift(null)
    setShown(0)
    setLevel(0)
    setLanded(0)
    setSpins((count) => count + 1)
    stopTicking()
    ticking.current = window.setInterval(() => sound.current?.tick(), 75)
    const began = performance.now()
    let opened: Gift
    try {
      const response = await fetch("/api/wallet/gift", { method: "POST" })
      const body = (await response
        .json()
        .catch(() => ({}))) as Partial<Gift> & {
        error?: string
      }
      if (!response.ok || typeof body.prize !== "number")
        throw new Error(body.error ?? "Could not open the gift.")
      opened = body as Gift
      // Let the reels run a beat even when the answer is quick.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 700 - (performance.now() - began)))
      )
    } catch (cause) {
      if (!alive.current) return
      stopTicking()
      setStage("error")
      setError(
        cause instanceof Error ? cause.message : "Could not open the gift."
      )
      return
    }
    if (!alive.current) return
    won.current = true
    const next = deal(HERD[opened.prize] ?? HERD[0]!, calm)
    setRound(next)
    setGift(opened)
    setLeft(opened.left)
    setStage("landing")
    let cheers = 0
    for (const [reel, stop] of next.stops.entries())
      later(stop, () => {
        setLanded(reel + 1)
        sound.current?.thud()
        if (next.columns[reel]!.includes(BUFFALO)) {
          sound.current?.stomp()
          shake()
          shout("Buffalo!")
          if (!calm) pop(CHEERS[Math.min(cheers++, CHEERS.length - 1)]!)
        }
        if (next.hot[reel + 1]) sound.current?.riser()
      })
    later(next.stops.at(-1)! + 550, () => {
      stopTicking()
      setTotal((sum) => sum + opened.amount)
      setStage("won")
      sound.current?.fanfare(opened.prize)
      if (!calm) {
        shake(opened.prize >= 2 ? "rumble" : "quake")
        sound.current?.gallop(opened.prize >= 2 ? 4 : 2)
      }
      shout(
        opened.prize === CALLS.length - 1
          ? "Buffalo! Buffalo! Buffalo! Stampede jackpot!"
          : opened.prize >= 2
            ? `Buffalo! ${CALLS[opened.prize]}!`
            : "Buffalo!"
      )
    })
  }

  function toggleSound() {
    quiet.current = !quiet.current
    setMuted(quiet.current)
    sound.current?.mute(quiet.current)
    if (quiet.current) window.speechSynthesis?.cancel()
  }

  const prize = stage === "won" && gift ? gift.prize : null
  const dealt = stage === "landing" || stage === "won"
  /** Buffalo on the reels that have stopped. */
  const herd = dealt
    ? round.columns
        .slice(0, landed)
        .flat()
        .filter((symbol) => symbol === BUFFALO).length
    : 0
  const next = HERD.findIndex((needed) => needed > herd)
  const tease =
    stage === "asking" || !herd
      ? "here they come…"
      : next < 0
        ? "ALL. THE. BUFFALO."
        : `${herd} buffalo · ${HERD[next]! - herd} more for +${Math.round(shares[next]! * 100)}%`

  return createPortal(
    <div
      className={`bfl${prize !== null ? ` bfl-won bfl-won-${prize}` : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Spin to open your gift"
      onPointerMove={lean}
    >
      <style>{css}</style>
      <div className="bfl-sky" aria-hidden="true">
        <div className="bfl-stars" />
        <div className="bfl-rays" />
        <div className="bfl-sun" />
        <div className="bfl-mesa bfl-mesa-far" />
        <span className="bfl-wanderer">
          <i>{BUFFALO}</i>
        </span>
        <div className="bfl-mesa bfl-mesa-near" />
      </div>
      <div className="bfl-gift" aria-hidden="true">
        🎁
      </div>

      <div className="bfl-bar">
        <button type="button" onClick={toggleSound} aria-pressed={muted}>
          {muted ? "🔇 sound off" : "🔊 sound on"}
        </button>
        <button type="button" onClick={() => onClose(won.current)}>
          {total > 0 ? "collect & close ✕" : "close ✕"}
        </button>
      </div>

      <div className="bfl-machine" ref={machine}>
        <h2 className="bfl-title" aria-label={TITLE}>
          <span aria-hidden="true">{BUFFALO}</span>
          {[...TITLE].map((letter, index) => (
            <b
              key={index}
              aria-hidden="true"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              {letter === " " ? "\u00a0" : letter}
            </b>
          ))}
          <span aria-hidden="true">{BUFFALO}</span>
        </h2>
        <p className="bfl-tag">every spin wins · more buffalo, more credit</p>

        <div className="bfl-cabinet" ref={cabinet}>
          <div className="bfl-lights" aria-hidden="true" />
          {herd > 0 && (
            <div className="bfl-herd" key={herd} aria-hidden="true">
              {BUFFALO}×{herd}
            </div>
          )}
          <div
            className={`bfl-window${stage === "ready" ? " bfl-idle" : ""}`}
            aria-hidden="true"
          >
            {round.columns.map((column, reel) => (
              <Reel
                key={`${spins}:${reel}:${stage === "asking" ? "roll" : "set"}`}
                mode={
                  stage === "asking"
                    ? "roll"
                    : stage === "landing" || stage === "won"
                      ? "land"
                      : "still"
                }
                column={column}
                fill={round.fills[reel]!}
                ms={round.stops[reel]!}
                landed={
                  (stage === "landing" || stage === "won") && landed > reel
                }
                hot={stage === "landing" && round.hot[reel]!}
              />
            ))}
            {stage === "landing" &&
              landed > 0 &&
              round.columns[landed - 1]!.includes(BUFFALO) && (
                <div className="bfl-flash" key={landed} />
              )}
          </div>
        </div>

        <ol className="bfl-pays" aria-label="What each spin can win">
          {shares.map((share, index) => (
            <li key={index} className={prize === index ? "bfl-paid" : ""}>
              <b>
                {HERD[index]}
                <span aria-hidden="true">{BUFFALO}</span>
                <span className="sr-only"> buffalo</span>
              </b>
              +{Math.round(share * 100)}%
            </li>
          ))}
        </ol>

        <div className="bfl-result" aria-live="assertive">
          {prize !== null && gift ? (
            <>
              <p className="bfl-call" key={level}>
                {CALLS[level]}!
              </p>
              <p className="bfl-sum">
                <span aria-hidden="true">+{dollars(shown)}</span>
                <span className="sr-only">
                  You won {dollars(gift.amount)} of credit.
                </span>
              </p>
              <p className="bfl-note">
                {HERD[prize]} buffalo ·{" "}
                {gift.capped ? "the most a gift can be · " : ""}already added to
                your balance
              </p>
            </>
          ) : error ? (
            <p className="bfl-note bfl-error">{error}</p>
          ) : (
            <p className="bfl-note">
              {busy
                ? tease
                : "Your gift is a share of your top-up, back as credit."}
            </p>
          )}
        </div>

        <div className="bfl-actions">
          {stage === "won" || stage === "error" ? (
            <>
              {left > 0 && (
                <button type="button" className="bfl-spin" onClick={spin}>
                  SPIN AGAIN
                  <small>
                    {left} gift{left === 1 ? "" : "s"} left
                  </small>
                </button>
              )}
              <button
                type="button"
                className={left > 0 ? "bfl-collect" : "bfl-spin"}
                autoFocus
                onClick={() => onClose(won.current)}
              >
                {total > 0 ? `COLLECT ${dollars(total)}` : "CLOSE"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="bfl-spin"
              autoFocus
              disabled={busy}
              onClick={spin}
            >
              {busy ? "…" : "SPIN"}
            </button>
          )}
        </div>
      </div>

      {prize !== null && (
        <>
          <Coins
            key={`coins:${spins}`}
            count={COINS[prize]!}
            ms={COUNT_UP_MS[prize]!}
          />
          <Fireworks
            key={`sky:${spins}`}
            bursts={FIREWORKS[prize]!}
            ms={COUNT_UP_MS[prize]! + 1500}
          />
          <Stampede key={`herd:${spins}`} herd={STAMPEDE[prize]!} />
        </>
      )}
      <div className="bfl-pops" aria-hidden="true">
        {pops.map((one) => (
          <span
            key={one.id}
            style={
              {
                left: `${one.x}%`,
                top: `${one.y}%`,
                "--turn": `${one.turn}deg`,
              } as CSSProperties
            }
          >
            {one.words}
          </span>
        ))}
      </div>
    </div>,
    document.body
  )
}

const css = `
.bfl {
  --cell: clamp(3.1rem, min(16vw, 13.5vh), 8.5rem);
  --gold: #ffd84a;
  position: fixed; inset: 0; z-index: 100; overflow: hidden;
  display: grid; place-items: center;
  color: #fff7d6; background: #14041f;
  font-family: Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif;
  letter-spacing: 0.04em;
  animation: bfl-fade .25s both;
}
.bfl-sky { position: absolute; inset: 0;
  background: linear-gradient(#1b0636 0%, #5a0f55 32%, #c22c3c 58%, #ff8a2b 78%, #ffd36b 100%); }
.bfl-rays { position: absolute; left: 50%; top: 72%; width: 240vmax; height: 240vmax;
  margin: -120vmax 0 0 -120vmax; opacity: .22;
  background: repeating-conic-gradient(#fff3b0 0 6deg, transparent 6deg 18deg);
  animation: bfl-turn 60s linear infinite; }
.bfl-won .bfl-rays { opacity: .5; animation-duration: 9s; }
.bfl-sun { position: absolute; left: 50%; top: 72%; width: 62vmin; height: 62vmin;
  margin: -31vmin 0 0 -31vmin; border-radius: 50%;
  background: radial-gradient(#fffbe0 0 30%, #ffd84a 55%, #ff8a2b 100%);
  box-shadow: 0 0 12vmin 4vmin #ffb44a99; }
.bfl-stars { position: absolute; inset: 0 0 55% 0;
  background:
    radial-gradient(circle, #fff 0 1.2px, transparent 2px) 0 0 / 97px 83px,
    radial-gradient(circle, #ffe9a8 0 1.6px, transparent 2.4px) 31px 47px / 131px 109px,
    radial-gradient(circle, #fff 0 1px, transparent 1.8px) 61px 19px / 71px 67px;
  animation: bfl-twinkle 2.6s ease-in-out infinite alternate; }
.bfl-wanderer { position: absolute; left: 0; bottom: 15vh; font-size: 2.2rem; line-height: 1;
  transform: translateX(110vw); animation: bfl-run 16s 3s linear infinite; }
.bfl-wanderer i, .bfl-pops { position: absolute; inset: 0; z-index: 55; pointer-events: none; }
.bfl-pops span { position: absolute; translate: -50% -50%; white-space: nowrap;
  font-size: clamp(1.6rem, 7vw, 4rem); line-height: 1; color: #fff;
  -webkit-text-stroke: .06em #3b0010; paint-order: stroke fill;
  text-shadow: 0 .08em 0 #c8102e, 0 .16em 0 #3b0010, 0 0 .5em var(--gold);
  animation: bfl-pop-word 1.2s cubic-bezier(.2,1.6,.4,1) both; }
.bfl-gift { position: absolute; inset: 0; z-index: 70; display: grid; place-items: center;
  font-size: 38vmin; line-height: 1; pointer-events: none;
  animation: bfl-unwrap 1.05s cubic-bezier(.5,0,.6,1) both; }
.bfl-mesa { position: absolute; inset: auto 0 0 0; }
.bfl-mesa-far { height: 30vh; background: #6e1638;
  clip-path: polygon(0 60%, 8% 60%, 10% 22%, 24% 22%, 26% 55%, 40% 55%, 43% 35%, 55% 35%, 58% 62%, 72% 62%, 74% 12%, 88% 12%, 90% 50%, 100% 50%, 100% 100%, 0 100%); }
.bfl-mesa-near { height: 17vh; background: #2a0822;
  clip-path: polygon(0 35%, 14% 35%, 17% 70%, 33% 70%, 36% 20%, 52% 20%, 55% 75%, 78% 75%, 81% 40%, 100% 40%, 100% 100%, 0 100%); }

.bfl-bar { position: absolute; inset: 0 0 auto 0; z-index: 60; display: flex;
  justify-content: space-between; padding: .75rem 1rem;
  font: 500 .75rem ui-monospace, monospace; letter-spacing: 0; }
.bfl-bar button { padding: .35rem .6rem; color: #fff7d6; background: #14041faa;
  border: 1px solid #fff7d655; border-radius: 999px; cursor: pointer; }
.bfl-bar button:hover { background: #14041f; border-color: var(--gold); }

.bfl-machine { position: relative; z-index: 40; display: flex; flex-direction: column;
  align-items: center; gap: clamp(.35rem, 1.4vh, .9rem); padding: 2.75rem .5rem 1rem;
  max-height: 100dvh; animation: bfl-in .6s .8s cubic-bezier(.2,1.5,.4,1) both; }
.bfl-title { margin: 0; font-size: clamp(1.9rem, min(9.5vw, 8vh), 5rem); line-height: 1;
  white-space: nowrap; display: flex; align-items: center; gap: .02em;
  filter: drop-shadow(0 .06em 0 #5a1500) drop-shadow(0 0 .35em #ff3d6e); }
.bfl-title b { display: inline-block; font-weight: inherit; color: var(--gold);
  background: linear-gradient(#fff9c9 10%, #ffd84a 45%, #c96a00 55%, #ffe889 90%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  animation: bfl-wave 1.5s ease-in-out infinite; }
.bfl-title span { margin: 0 .12em; animation: bfl-gallop .3s ease-in-out infinite alternate; }
.bfl-won .bfl-title b { animation-duration: .5s; }
.bfl-tag { margin: 0; font-size: clamp(.7rem, 2.4vw, 1rem); text-transform: uppercase;
  color: #fff; text-shadow: 0 2px 0 #5a1500; }

.bfl-cabinet { transform: perspective(900px) rotateX(var(--lean-x, 0deg)) rotateY(var(--lean-y, 0deg));
  transition: transform .2s ease-out; position: relative; padding: clamp(.8rem, 2.4vw, 1.3rem); border-radius: 1.2rem;
  background: linear-gradient(#b0102e, #5c0620);
  box-shadow: 0 0 0 4px var(--gold), 0 0 0 9px #7a3b00, 0 1.2rem 3rem #000a,
    0 0 5rem #ff3d6e88; }
.bfl-lights { position: absolute; inset: 0; border-radius: inherit;
  background:
    radial-gradient(circle, #fff 0 3px, #ffd84a 4px 6px, transparent 7px) 0 0 / 28px 28px;
  pointer-events: none;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  padding: clamp(.8rem, 2.4vw, 1.3rem);
  animation: bfl-chase .7s steps(2, jump-none) infinite; }
.bfl-window { position: relative; display: flex; gap: clamp(2px, .8vw, 6px); padding: 4px;
  border-radius: .5rem; background: #12020c; box-shadow: inset 0 0 1.2rem #000; }
.bfl-reel { width: var(--cell); height: calc(var(--cell) * ${ROWS}); overflow: hidden;
  border-radius: .3rem;
  background: linear-gradient(#d9c9a5, #fff8e7 22%, #fff8e7 78%, #d9c9a5); }
.bfl-idle .bfl-symbol { animation: bfl-bob 1.4s ease-in-out infinite; }
.bfl-idle .bfl-reel:nth-child(2) .bfl-symbol { animation-delay: .12s; }
.bfl-idle .bfl-reel:nth-child(3) .bfl-symbol { animation-delay: .24s; }
.bfl-idle .bfl-reel:nth-child(4) .bfl-symbol { animation-delay: .36s; }
.bfl-idle .bfl-reel:nth-child(5) .bfl-symbol { animation-delay: .48s; }
.bfl-flash { position: absolute; inset: 0; border-radius: inherit; background: #fff;
  pointer-events: none; animation: bfl-flash .35s ease-out both; }
.bfl-herd { position: absolute; z-index: 5; top: -1.1rem; right: -1.1rem; padding: .3rem .7rem;
  font-size: clamp(1.2rem, 4.5vw, 2rem); line-height: 1; color: #3b1500; white-space: nowrap;
  border: 3px solid #fff; border-radius: 999px; rotate: 8deg;
  background: radial-gradient(circle at 50% 20%, #fff3a8, #ffb300 60%, #e07a00);
  box-shadow: 0 .3rem 0 #7a3b00, 0 0 1.5rem var(--gold);
  animation: bfl-slam .4s cubic-bezier(.2,2,.4,1) both; }
.bfl-won .bfl-hit { animation: bfl-dance .32s ease-in-out infinite alternate; }
.bfl-won .bfl-lights { animation-duration: .4s; }
.bfl-hot { animation: bfl-hot .45s ease-in-out infinite alternate; }
.bfl-strip { display: flex; flex-direction: column;
  transform: translateY(calc(var(--cell) * -1)); }
.bfl-rolling { filter: blur(2px);
  animation: bfl-roll .42s linear infinite; }
.bfl-landing { animation: bfl-land 1s both; }
.bfl-symbol { flex: none; display: grid; place-items: center; width: var(--cell);
  height: var(--cell); font-size: calc(var(--cell) * .64); line-height: 1; }
.bfl-face { font-size: calc(var(--cell) * .6); color: #c8102e;
  -webkit-text-stroke: 2px #3b0010; text-shadow: 0 3px 0 #ffd84a; }
.bfl-face[data-face="K"] { color: #1d6fe0; }
.bfl-face[data-face="Q"] { color: #a31ad6; }
.bfl-face[data-face="J"] { color: #0b9d58; }
.bfl-face[data-face="10"] { color: #e86a00; letter-spacing: -.06em; }
.bfl-hit { background: radial-gradient(#fff 0, #ffd84a 45%, #ff7a00 100%);
  box-shadow: inset 0 0 0 3px #c8102e;
  animation: bfl-hit .5s cubic-bezier(.3,1.8,.5,1) both, bfl-glow 1s .5s ease-in-out infinite alternate; }

.bfl-pays { display: flex; flex-wrap: wrap; justify-content: center; gap: .3rem;
  margin: 0; padding: 0; list-style: none;
  font: 600 clamp(.6rem, 2.2vw, .8rem) ui-monospace, monospace; letter-spacing: 0; }
.bfl-pays li { display: flex; gap: .35rem; align-items: center; padding: .2rem .5rem;
  color: #fff7d6; background: #14041fcc; border: 1px solid #fff7d633; border-radius: 999px; }
.bfl-pays b { color: var(--gold); }
.bfl-pays .bfl-paid { color: #14041f; background: var(--gold); border-color: #fff;
  transform: scale(1.18); box-shadow: 0 0 1rem var(--gold); }
.bfl-pays .bfl-paid b { color: #7a0018; }

.bfl-result { min-height: clamp(4.6rem, 15vh, 8.5rem); display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  gap: .3rem; padding: .6rem 1.5rem; border-radius: 1rem; background: #14041fd9;
  box-shadow: 0 0 0 2px var(--gold), 0 .6rem 2rem #0008; }
.bfl-result p { margin: 0; }
.bfl-call { font-size: clamp(1.3rem, 6vw, 2.6rem); line-height: 1; color: #fff;
  text-shadow: 0 .08em 0 #c8102e, 0 0 .5em #ff3d6e;
  animation: bfl-slam .5s cubic-bezier(.2,2,.4,1) both; }
.bfl-sum { font-size: clamp(2.4rem, 12vw, 5.5rem); line-height: 1; color: var(--gold);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 .06em 0 #7a3b00, 0 .12em 0 #3b0010, 0 0 .4em #ffb44a;
  animation: bfl-throb .5s ease-in-out infinite; }
.bfl-note { font: 500 clamp(.7rem, 2.4vw, .85rem) ui-monospace, monospace;
  letter-spacing: 0; color: #fff; text-shadow: 0 1px 2px #000; }
.bfl-error { padding: .4rem .7rem; background: #14041f; border: 1px solid #ff6b6b; }

.bfl-actions { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: center; }
.bfl-spin, .bfl-collect { display: flex; flex-direction: column; align-items: center;
  min-width: 9.5rem; padding: .7rem 1.6rem; font: inherit;
  font-size: clamp(1.3rem, 5vw, 2rem); line-height: 1.1; color: #fff; cursor: pointer;
  border: 4px solid var(--gold); border-radius: 999px;
  background: radial-gradient(circle at 50% 20%, #ff6a85, #d1002f 55%, #7a0018);
  box-shadow: 0 .4rem 0 #5c0620, 0 .5rem 1.6rem #000a, 0 0 2rem #ff3d6e;
  text-shadow: 0 2px 0 #5c0620;
  animation: bfl-throb 1s ease-in-out infinite; }
.bfl-collect { background: radial-gradient(circle at 50% 20%, #fff3a8, #ffb300 55%, #b86a00);
  color: #3b1500; text-shadow: 0 1px 0 #fff3a8; }
.bfl-spin small, .bfl-collect small { font: 600 .65rem ui-monospace, monospace; letter-spacing: 0; }
.bfl-spin:active, .bfl-collect:active { transform: translateY(.3rem); box-shadow: 0 .1rem 0 #5c0620; }
.bfl-spin:disabled { cursor: progress; filter: saturate(.5); animation: none; }
.bfl-spin:focus-visible, .bfl-collect:focus-visible, .bfl-bar button:focus-visible {
  outline: 3px solid #fff; outline-offset: 3px; }

.bfl-coins { position: absolute; inset: 0; z-index: 50; width: 100%; height: 100%;
  pointer-events: none; }
.bfl-stampede { position: absolute; inset: 0; z-index: 45; pointer-events: none; }
.bfl-stampede span { position: absolute; left: 0; line-height: 1;
  transform: translateX(110vw); animation: bfl-run 2.4s linear both; }
.bfl-stampede i { display: block; font-style: normal;
  animation: bfl-gallop .22s ease-in-out infinite alternate; }

.bfl-won-3 .bfl-sky, .bfl-won-4 .bfl-sky, .bfl-won-5 .bfl-sky {
  animation: bfl-wash 1.4s ease-in-out infinite alternate; }
.bfl-shake { animation: bfl-shake .35s linear; }
.bfl-quake { animation: bfl-shake .9s linear; }
.bfl-rumble { animation: bfl-shake .45s linear 8; }

@keyframes bfl-fade { from { opacity: 0; } }
@keyframes bfl-in { from { opacity: 0; transform: scale(.1) rotate(-14deg); } }
@keyframes bfl-unwrap {
  0% { transform: scale(.2) rotate(0); opacity: 0; }
  20% { transform: scale(1) rotate(-10deg); opacity: 1; }
  35% { transform: scale(1.05) rotate(10deg); }
  50% { transform: scale(1.1) rotate(-12deg); }
  65% { transform: scale(1.15) rotate(12deg); }
  78% { transform: scale(.9) rotate(0); opacity: 1; }
  100% { transform: scale(9) rotate(0); opacity: 0; } }
@keyframes bfl-twinkle { from { opacity: .35; } to { opacity: 1; } }
@keyframes bfl-wave { 50% { transform: translateY(-.14em) rotate(-3deg); } }
@keyframes bfl-bob { 50% { transform: translateY(-6%) scale(1.06); } }
@keyframes bfl-flash { from { opacity: .7; } to { opacity: 0; } }
@keyframes bfl-dance { from { transform: rotate(-9deg) scale(1); }
  to { transform: rotate(9deg) scale(1.12); } }
@keyframes bfl-pop-word {
  0% { opacity: 0; transform: scale(.2) rotate(var(--turn)); }
  18% { opacity: 1; transform: scale(1.25) rotate(var(--turn)); }
  70% { opacity: 1; transform: scale(1) rotate(var(--turn)) translateY(-.3em); }
  100% { opacity: 0; transform: scale(1.1) rotate(var(--turn)) translateY(-1.4em); } }
@keyframes bfl-turn { to { transform: rotate(360deg); } }
@keyframes bfl-throb { 50% { transform: scale(1.05); } }
@keyframes bfl-chase { to { background-position: 14px 14px; } }
@keyframes bfl-roll { from { transform: translateY(calc(var(--cell) * -9)); }
  to { transform: translateY(0); } }
@keyframes bfl-land {
  from { transform: translateY(calc(var(--cell) * var(--from))); filter: blur(3px);
    animation-timing-function: cubic-bezier(.12,.75,.3,1); }
  88% { transform: translateY(calc(var(--cell) * -.72)); filter: blur(0);
    animation-timing-function: ease-in-out; }
  to { transform: translateY(calc(var(--cell) * -1)); filter: blur(0); } }
@keyframes bfl-hot { from { box-shadow: 0 0 0 2px #ffd84a, 0 0 .6rem #ffd84a; }
  to { box-shadow: 0 0 0 4px #fff, 0 0 2.2rem .4rem #ff3d6e; } }
@keyframes bfl-hit { from { transform: scale(1.7) rotate(-12deg); } }
@keyframes bfl-glow { to { filter: brightness(1.25) saturate(1.4); } }
@keyframes bfl-slam { from { opacity: 0; transform: scale(4) rotate(8deg); } }
@keyframes bfl-run { to { transform: translateX(-40vw); } }
@keyframes bfl-gallop { from { transform: translateY(0) rotate(-5deg); }
  to { transform: translateY(-.35em) rotate(6deg); } }
@keyframes bfl-wash { to { filter: hue-rotate(50deg) brightness(1.2); } }
@keyframes bfl-shake {
  10% { transform: translate(-9px, 5px) rotate(-1deg); }
  25% { transform: translate(8px, -7px) rotate(1deg); }
  40% { transform: translate(-7px, -4px) rotate(-.6deg); }
  55% { transform: translate(6px, 6px) rotate(.6deg); }
  70% { transform: translate(-4px, 3px); }
  85% { transform: translate(3px, -2px); } }

@media (prefers-reduced-motion: reduce) {
  .bfl, .bfl *, .bfl-shake, .bfl-quake { animation: none !important; }
  .bfl-coins, .bfl-stampede, .bfl-gift, .bfl-pops, .bfl-wanderer, .bfl-flash { display: none; }
}
`
