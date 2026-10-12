import { ActionButton } from "@/components/action-button"

/**
 * Adds every one of the caller's machines that does not serve this hive yet,
 * in one request. Nothing when there is only one: its own button says it.
 */
export function AddAllButton({
  machines,
  organizationId,
  organization,
}: {
  machines: Array<{ id: string }>
  organizationId: string
  organization: string
}) {
  if (machines.length < 2) return null
  return (
    <ActionButton
      label={`Add all ${machines.length} to ${organization}`}
      path="/api/machines/pools"
      body={{
        machineIds: machines.map((machine) => machine.id),
        organizationId,
      }}
    />
  )
}
