/**
 * The HiveWorker mark: one cell of comb carrying two lines of a diff, the
 * shorter one being the line that replaced the longer.
 */
export function HiveMark({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className ?? "size-6"}
      {...props}
    >
      <path
        d="M12 1.2 21.35 6.6v10.8L12 22.8 2.65 17.4V6.6z"
        className="fill-primary"
      />
      <path
        d="M7 9.6h10M7 14.4h5.2"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
