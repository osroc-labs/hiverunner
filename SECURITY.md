# Security

Hive Runner runs other people's CI jobs on machines that belong to
developers, so a hole here matters. It has not had an external audit.
[What a job can and cannot reach](docs/running-jobs.md) is written down, and
the short version for someone deciding whether to run it is on the site's
`/security` page.

## Reporting a problem

Please do not open a public issue for a vulnerability.

- Use **Report a vulnerability** under this repository's Security tab. It
  opens a private thread with the maintainers.
- If you cannot use that, write to auth@thecomputerplumbers.com.

Say what you found, how to reproduce it, and what it lets someone do. We
will answer as soon as we can, tell you what we plan to do and when, credit you in the fix unless you would rather we did not, and
ask that you give us a reasonable time to ship it before writing about it.

## What counts

Most wanted, roughly in order:

- A job escaping its VM, or a macOS job reading its Mac owner's files.
- One hive reading or changing another's machines, jobs, balance or settings.
- A machine or daemon acting as one it is not, or taking a job it was not
  offered.
- Getting past sign-in, membership, an agent's granted scopes, or a revoked
  connection.
- Moving money: the ledger, receipts, top-ups, the budget.
- The installer or updater running something that was not released by us.

Not a vulnerability here: a job doing what a workflow's author told it to,
on a hive that author is allowed to use; and reports from a scanner with no
way shown to use them.

## Versions

The hosted service runs `main`. The daemon updates itself; only the latest
release is fixed. If you host your own copy, follow `main`.
