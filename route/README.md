# Hive Runner route

Sends a job to your hive when one of its machines is free, and to a fallback
runner when none is. Nothing waits in a queue because a laptop lid is shut.

```yaml
jobs:
  route:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    outputs:
      runner: ${{ steps.hive.outputs.runner }}
    steps:
      - id: hive
        uses: thecomputerplumbers/hiverunner/route@v1

  test:
    needs: route
    runs-on: ${{ needs.route.outputs.runner }}
    steps:
      - uses: actions/checkout@v7
      - uses: oven-sh/setup-bun@v2
      - run: bun test
```

| Input      | Default         | What it is                                            |
| ---------- | --------------- | ----------------------------------------------------- |
| `label`    | `hive`          | The hive label to use when a machine is free          |
| `fallback` | `ubuntu-latest` | The runner to use when none is                        |
| `wait`     | `15`            | Seconds to keep asking before falling back, up to 120 |

| Output   | What it is                                        |
| -------- | ------------------------------------------------- |
| `runner` | The label to give `runs-on`                       |
| `routed` | `true` if the job goes to your hive, else `false` |

The step proves which repository is asking with the job's own OIDC token,
which is what `id-token: write` allows. It reads nothing from the repository
and has no other permission. It never fails: if the coordinator cannot be
reached, or the label is not one your hive serves, the job falls back and the
step says why.

For x64 jobs, set `label: hive-x64`.

## Checking it yourself

The whole action is [`index.js`](index.js): about a hundred lines, no
dependencies, nothing bundled or minified. It makes two kinds of request and
no others: one to GitHub for the job's OIDC token, and one to the Hive Runner
coordinator asking whether a machine is free. Pin it to a commit if you want
it never to change under you:

```yaml
- uses: thecomputerplumbers/hiverunner/route@<commit sha>
```

[Hive Runner](https://hiveworkr.thecomputerplumbers.com) runs GitHub Actions
jobs on your own team's machines. This action is MIT licensed, unlike the rest
of the repository, so it can sit in anyone's workflow without a second
thought.

## Versions

`v1` is a tag that follows this folder on `main`: the Route action workflow
moves it whenever something here changes. A change that would break a
workflow written for `v1` goes out as `v2` instead. Until its move in October 2026
into this repository it was `thecomputerplumbers/hive-route@v1`, which keeps
working.
