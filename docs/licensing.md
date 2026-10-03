# Licensing

This repository is private today and expected to become public. Treat every
commit as if it already were.

## Our code

**Open**: the license for HiveWorker's own code is not chosen yet, so there is
no `LICENSE` file. Until there is one, the code is all rights reserved,
copyright The Computer Plumbers LLC. Choose before the repository is made
public; a public repository without a license cannot legally be used or
contributed to by anyone else.

The parts need not share one license. The daemon runs on other people's
machines and the token contracts hold other people's money, so both have a
stronger case for a permissive, auditable license than the hosted coordinator.

The starter this was copied from is our own code with no license of its own,
so it carries no obligations into this repository.

## Dependencies

`pnpm licenses:check` fails on any dependency whose license is not on the
allowlist in `scripts/check-licenses.mjs`. It runs in `mise run check` and so
in CI. Adding a license to the allowlist, or a package to the exceptions, is a
decision: record the reason in that file.

Not allowed without a deliberate decision: GPL, AGPL, SSPL, source-available
licenses (BSL, FSL, Elastic), and anything with no license.

Current exceptions:

| Package                | License           | Why it is acceptable                                                                              |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `@img/sharp-libvips-*` | LGPL-3.0-or-later | Dynamically linked native library used at build time. Not in the Worker bundle, not redistributed |

## What we will ship to other people

These are distributed, not just run by us, so their licenses bind us directly.
Check each when it is added.

| Component                     | License | Obligation                                                  |
| ----------------------------- | ------- | ----------------------------------------------------------- |
| GitHub Actions runner (in VM) | MIT     | Keep the notice in the image                                |
| Linux guest image             | Mixed   | Publish the package manifest and offer source for GPL parts |
| Go modules in the daemon      | TBD     | Ship a third-party notices file with the signed binary      |

## Before going public

- Choose the license and add `LICENSE`, plus `license` fields in every `package.json`.
- Scan the full git history for secrets and for the Cloudflare account ID.
- Confirm no code was pasted in from a repository under a different license.
- Decide whether outside contributions need a sign-off (DCO) or an agreement.
- Trademark: the name and symbol are still open in the goals doc.
