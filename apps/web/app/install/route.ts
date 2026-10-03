import { installUrl } from "@/lib/github"
import { seeOther } from "@/lib/redirect"

/** The one link the site uses for "install". */
export function GET() {
  return seeOther(installUrl() ?? "/github/status?state=unconfigured")
}
