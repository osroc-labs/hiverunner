// Secrets and plain vars. Bindings live in the generated `worker-env.d.ts`
// (`pnpm cf:typegen`); these are merged into both env shapes it declares, so
// `env.STRIPE_SECRET_KEY` type-checks alongside `env.APP_DATABASE`.
//
// Set them with `wrangler secret put <NAME>`; never commit a key.
interface AppSecrets {
  BUILD_ID?: string
  /** The app's own origin, used for auth callbacks and Stripe return URLs. */
  APP_URL?: string
  /** Sender on a domain onboarded to Cloudflare Email Service. */
  EMAIL_FROM?: string

  /**
   * Signs session cookies. Generate with `openssl rand -base64 32`.
   * Required outside localhost; rotating it signs everyone out.
   */
  BETTER_AUTH_SECRET?: string

  /**
   * The HiveWorker GitHub App. One App per environment; see
   * docs/github-app.md. The private key may be the PKCS#1 file GitHub issues.
   */
  GITHUB_APP_ID?: string
  GITHUB_APP_SLUG?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_WEBHOOK_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  /** Honored on localhost only, so tests can stand in for GitHub. */
  GITHUB_API_URL?: string

  STRIPE_API_VERSION?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE_PRO_MONTHLY?: string
  STRIPE_PRICE_PRO_YEARLY?: string
}

declare global {
  interface CloudflareEnv extends AppSecrets {}
  namespace Cloudflare {
    interface Env extends AppSecrets {}
  }
}

export {}
