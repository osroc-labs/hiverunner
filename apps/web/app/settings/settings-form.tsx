"use client"
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import { post } from "@/components/action-button"

export function SettingsForm({
  organizationId,
  login,
  allowedTeams,
  earningsDestination,
  version,
  editable,
}: {
  organizationId: string
  login: string
  allowedTeams: string[]
  earningsDestination: "organization" | "developer"
  version: number
  editable: boolean
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const data = new FormData(event.currentTarget)
    try {
      await post("/api/pool/settings", {
        organizationId,
        version,
        earningsDestination: data.get("earningsDestination"),
        allowedTeams: String(data.get("allowedTeams") ?? "")
          .split(/[\s,]+/)
          .filter(Boolean),
      })
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again")
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <Field>
        <FieldLabel htmlFor="allowedTeams">
          Teams that can add machines
        </FieldLabel>
        <Input
          id="allowedTeams"
          name="allowedTeams"
          defaultValue={allowedTeams.join(", ")}
          placeholder="Everyone in the organization"
          disabled={!editable || busy}
        />
        <FieldDescription>
          Team slugs from {login} on GitHub, separated by commas. Leave empty to
          let every member add machines. Owners always can.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="earningsDestination">
          Who is paid when a machine runs a job
        </FieldLabel>
        <select
          id="earningsDestination"
          name="earningsDestination"
          className="h-10 rounded-md border bg-background px-3"
          defaultValue={earningsDestination}
          disabled={!editable || busy}
        >
          <option value="organization">The organization</option>
          <option value="developer">The developer whose machine it is</option>
        </select>
        <FieldDescription>
          Paying the organization returns most of each job&apos;s price to your
          own balance.
        </FieldDescription>
      </Field>
      {editable ? (
        <div>
          <Button disabled={busy}>Save settings</Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only owners of {login} on GitHub can change these.
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
    </form>
  )
}
