# Contributing

Thanks for looking. Hive Runner is small and has opinions, so a few minutes
here saves both of us a pull request that cannot be merged.

## Before you write code

- **A bug**: open an issue with what you did, what happened and what you
  expected. For the daemon, include the output of `hived doctor`.
- **A change in behavior or something new**: open an issue first and wait
  for a yes. [Goals and decisions](docs/goals-and-decisions.md) says what has
  already been agreed and why; a pull request that undoes one of those needs
  the argument made first.
- **A security problem**: not an issue. See [SECURITY.md](SECURITY.md).

## Setting up

You need [mise](https://mise.jdx.dev), which installs the pinned Node, pnpm
and Go.

```sh
mise install
mise run setup
cp apps/web/.dev.vars.example apps/web/.dev.vars
pnpm db:seed
mise run dev
```

The [README](README.md) has the sign-in for the seeded local hive and the
other commands. Nothing here needs a Cloudflare account, a GitHub App or any
secret: local runs use local state and simulated mail.

[AGENTS.md](AGENTS.md) holds the rules of the codebase: the two databases,
where a package's code belongs, how auth is checked. Read the part for what
you are touching, whether or not an agent is doing the typing.

## Before you open a pull request

```sh
mise run check       # lint, format, licenses, types, tests, production build
pnpm test:worker     # after auth, GitHub, OAuth, mail or MCP tool changes
```

Both must pass. In the daemon, `gofmt`, `go vet ./...` and `go test ./...`.

- One change per pull request, with a test for what it changes.
- The title says what is different for a person using it, as a sentence:
  "Wait for a machine's jobs before an update restarts its daemon".
- After a schema change, run `pnpm db:generate` and commit the migration.
  Never edit a migration that is already on `main`.
- A new dependency has to pass `pnpm licenses:check`. See
  [licensing](docs/licensing.md) before adding to its allowlist.
- Do not paste in code from somewhere else unless its license allows it in
  an AGPL-3.0 work, and say where it came from.

## Checks on a pull request from a fork

They run on GitHub's own runners, with no secrets, and never on a hive. A
maintainer may have to approve the run the first time you contribute.
Nothing is deployed from a pull request; `main` is what ships.

## License and sign-off

Hive Runner is [AGPL-3.0-only](LICENSE). What you contribute is under the
same license.

Sign your commits off with `git commit -s`. That adds a `Signed-off-by` line
and says you agree to the
[Developer Certificate of Origin](https://developercertificate.org): you
wrote the change, or have the right to submit it under this license.
