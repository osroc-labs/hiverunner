import { eq } from "drizzle-orm"
import { user } from "@workspace/auth/schema"
import { authorize, type OperationContext } from "./context"

export async function currentUser(context: OperationContext) {
  const membership = await authorize(context, "hive:read")
  const [account] = await context.db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, context.actor.userId))
    .limit(1)
  return {
    // Their role in the hive this connection is bound to. get_hive's `you`
    // has the rest: which machines are theirs and what they can change.
    role: membership.role,
    user: account
      ? {
          id: account.id,
          ...(!context.actor.scopes || context.actor.scopes.includes("profile")
            ? { name: account.name }
            : {}),
          ...(!context.actor.scopes || context.actor.scopes.includes("email")
            ? { email: account.email }
            : {}),
        }
      : null,
  }
}
