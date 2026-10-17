# The GitHub App

One App does two jobs: organizations install it, and people sign in with it.
Each environment has its own App, so staging webhooks never reach production.

`apps/web/github-app.json` is the production App's definition. It is the
record of what the App is allowed to do; change it in a pull request, then
make GitHub match.

The production App is **HiveWorker CI**, at `github.com/apps/hiveworker-ci`:
"Hive Runner" was already taken as an App name on GitHub. Its slug is what
`GITHUB_APP_SLUG` holds.

## Change it

GitHub has no API to edit an existing App: its URLs, permissions and events
are changed by hand on its settings page. Moving the site to another origin
meant changing the Callback URL and Setup URL there. After any change to the
manifest, or to the App,

```sh
GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY_FILE=path/to/key.pem pnpm run github-app check
```

compares the App, as `GET /app` and `GET /app/hook/config` describe it, with
`apps/web/github-app.json`. It prints each difference, the settings that the
API does not show (Callback URL, Setup URL and the installation switches) for
checking by eye, and the settings page's URL, and fails if anything differs.
Pass `--origin` for an environment whose App lives at another origin. It
only reads, and prints neither the key nor a token.

## Create it

1. On GitHub, open the owning organization's **Settings → Developer settings →
   GitHub Apps → New GitHub App**, and enter the values from
   `apps/web/github-app.json`. For staging, use the staging origin and name it
   `Hive Runner (staging)`.
2. Permissions, exactly:

   | Permission                        | Access       | Why                                |
   | --------------------------------- | ------------ | ---------------------------------- |
   | Organization: Self-hosted runners | Read & write | Scale sets and JIT runner configs  |
   | Organization: Members             | Read         | Who may join the pool, and teams   |
   | Repository: Actions               | Read         | `workflow_job` events              |
   | Repository: Metadata              | Read         | Mandatory                          |
   | Account: Email addresses          | Read         | Sign-in. Without it, sign-in fails |

   Nothing else. The App cannot read code, contents or secrets, and the site
   says so.

3. Events: Workflow job, Organization, Membership, Team, Installation target.
4. Leave **Request user authorization (OAuth) during installation** off. The
   Setup URL is where GitHub returns the browser, and the app confirms the
   installation there with the person's own token.
5. Leave **Expire user authorization tokens** on. The token is used once, at
   sign-in.
6. Generate a webhook secret (`openssl rand -hex 32`), a client secret, and a
   private key.

## Configure the Worker

```sh
cd apps/web
for name in GITHUB_APP_ID GITHUB_APP_SLUG GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET \
  GITHUB_WEBHOOK_SECRET; do pnpm exec wrangler secret put "$name"; done
pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY < path/to/downloaded.pem
```

Add `--env staging` for staging. `GITHUB_APP_SLUG` is the last segment of the
App's public URL (`github.com/apps/<slug>`). The private key works as GitHub
issues it; there is no conversion step.

`pnpm run doctor production` checks the names are set, and `/api/health`
reports which parts are configured without echoing any value.

## How installation works

| Step                                        | Code                                       |
| ------------------------------------------- | ------------------------------------------ |
| "Install" on the site                       | `apps/web/app/install/route.ts`            |
| GitHub sends `installation.created`         | `apps/web/app/api/github/webhook/route.ts` |
| The webhook provisions the pool             | `packages/db/src/installations.ts`         |
| GitHub returns the browser to the Setup URL | `apps/web/app/github/setup/route.ts`       |
| Membership is brought in line with GitHub   | `packages/db/src/membership.ts`            |

The webhook is the source of truth and does not need a browser. The Setup URL
only links a person to a pool, and only after `GET /user/installations`, asked
with their own token, lists the installation. The `installation_id` in that
URL is never trusted by itself.

Provisioning is idempotent and keyed by the GitHub account, not the
installation: uninstalling and reinstalling returns to the same pool, balance
and history, and the trial grant is given once.

## Local development

No App is needed. `pnpm db:seed` creates two pools as an installation would
have, and seeded users sign in with a password, which is enabled on localhost
only. To exercise the real flow locally, create a third App whose URLs point
at a tunnel to `localhost:3000` and put its values in `apps/web/.dev.vars`.

`pnpm test:worker` runs the whole flow against a fake GitHub
(`tests/fake-github.mjs`) that verifies the App's signature the way GitHub
does.
