# HiveWorker

GitHub Actions-compatible runners on your own developers' machines. Licensed
under [AGPL-3.0](LICENSE).

| Read                                               | For                                     |
| -------------------------------------------------- | --------------------------------------- |
| [Goals and decisions](docs/goals-and-decisions.md) | What it is and what has been agreed     |
| [Build spec](docs/spec.md)                         | What gets built, on what, in what order |
| [The GitHub App](docs/github-app.md)               | Creating it and how installation works  |
| [Deployment](docs/deployment.md)                   | Environments, secrets, release          |
| [Licensing](docs/licensing.md)                     | Ours and our dependencies'              |

## Get started

```sh
mise install
mise run setup
cp apps/web/.dev.vars.example apps/web/.dev.vars
pnpm db:seed
pnpm run doctor
mise run dev
```

The web app runs at [http://localhost:3000](http://localhost:3000). Sign in
with `owner@example.test` / `Local-demo-only-2026!`. Password sign-in exists on
localhost only; everywhere else GitHub is the only way in.

## Commands

```sh
mise run dev         # Start the development server
mise run check       # Lint, format, licenses, types, tests, production build
mise run format      # Format the workspace with oxfmt
pnpm test:worker     # Install flow against a fake GitHub; tunnel as a fake daemon
pnpm test:daemon     # The real daemon against both local Workers (macOS)
pnpm run doctor      # Check local setup; also accepts staging or production
pnpm db:seed         # Repeatable local pools and users
pnpm db:reset --yes  # Reset local state; stop the dev server first
pnpm cf:typegen      # Regenerate Cloudflare binding and runtime types
```

## Layout

| Path                                                | What it holds                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/web`                                          | Marketing site, dashboard, sign-in, GitHub App endpoints (vinext)   |
| `packages/db`                                       | HiveWorker's D1 tables and the operations on them                   |
| `packages/github`                                   | GitHub App over `fetch` and WebCrypto                               |
| `packages/pricing`                                  | Compute-unit math, the floor, comparison rates. Every price is here |
| `packages/auth`                                     | Better Auth on D1: GitHub sign-in, sessions, pool membership        |
| `packages/ui*`                                      | Primitives, app chrome, data display, forms                         |
| `packages/stripe`, `packages/mcp`, `packages/email` | From the starter; switched off until needed                         |

## Status

Working end to end locally, with tests: GitHub App installation, GitHub
sign-in and membership, pool settings, the ledger and trial grant, daemon
sign-in and enrollment, the tunnel, presence, and revocation.

Not built yet: the scale set listener (so no job reaches a machine), the VM
runner in the daemon (it declines jobs), metering and receipts, the menu bar
item, and anything on chain. Nothing is deployed.

`AGENTS.md` has the rules for working in this codebase: the two databases,
package boundaries, auth, and the checks.
