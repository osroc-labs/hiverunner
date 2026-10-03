import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { AuthPage } from "@/components/auth-page"
import { auth } from "@/lib/auth"
import { getServerSession } from "@/lib/session"
import { DeviceForm } from "./device-form"

export const metadata = { title: "Connect a machine" }

/**
 * Where the daemon sends the person to approve it. They are already signed
 * in with GitHub, or are about to be; the code ties this browser to that
 * daemon.
 */
export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>
}) {
  const { user_code: userCode } = await searchParams
  const session = await getServerSession()
  if (!session) {
    const here = `/device${userCode ? `?user_code=${encodeURIComponent(userCode)}` : ""}`
    redirect(`/sign-in?next=${encodeURIComponent(here)}`)
  }

  let pending = false
  if (userCode) {
    try {
      const result = await auth.api.deviceVerify({
        query: { user_code: userCode },
        headers: await headers(),
      })
      pending = result.status === "pending"
    } catch {
      pending = false
    }
  }

  return (
    <AuthPage title="Connect a machine">
      <DeviceForm
        userCode={pending ? userCode : undefined}
        invalid={Boolean(userCode) && !pending}
        name={session.user.name}
      />
    </AuthPage>
  )
}
