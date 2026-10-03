import { cn } from "@workspace/ui/lib/utils"

const BEFORE = "runs-on: ubuntu-latest"
const AFTER = "runs-on: hive"

/**
 * The whole product in two lines. `hero` sets it as display type across the
 * page; the default is a diff the size of the code around it.
 */
export function WorkflowDiff({
  variant = "inline",
  className,
}: {
  variant?: "hero" | "inline"
  className?: string
}) {
  const hero = variant === "hero"
  return (
    <figure
      aria-label={`Change ${BEFORE} to ${AFTER}`}
      className={cn(
        "overflow-hidden bg-code font-mono text-code-foreground",
        hero
          ? "text-[clamp(0.95rem,4.6vw,3.75rem)] leading-[1.9] font-medium tracking-tight"
          : "rounded-lg text-[0.8125rem] leading-7",
        className
      )}
    >
      <pre aria-hidden="true" className="font-mono">
        <DiffLine sign="-" hero={hero}>
          {BEFORE}
        </DiffLine>
        <DiffLine
          sign="+"
          hero={hero}
          className={hero ? "motion-safe:animate-diff-in" : undefined}
        >
          {AFTER}
        </DiffLine>
      </pre>
    </figure>
  )
}

function DiffLine({
  sign,
  hero,
  className,
  children,
}: {
  sign: "+" | "-"
  hero: boolean
  className?: string
  children: string
}) {
  const added = sign === "+"
  return (
    <span
      className={cn(
        "block whitespace-pre",
        added ? "bg-diff-add/15" : "bg-diff-remove/15",
        className
      )}
    >
      <span
        className={cn(
          "mx-auto block w-full",
          hero ? "max-w-6xl px-5 sm:px-8" : "px-4"
        )}
      >
        <span
          className={cn(
            "inline-block w-[2ch] select-none",
            added ? "text-diff-add" : "text-diff-remove"
          )}
        >
          {sign}
        </span>
        <span className={added ? undefined : "text-code-foreground/55"}>
          {children}
        </span>
      </span>
    </span>
  )
}
