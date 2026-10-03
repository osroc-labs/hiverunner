# hived

The HiveWorker daemon. One static Go binary that enrolls a Mac in its
organization's pool and holds the single outbound tunnel jobs arrive through.

```sh
go build -o hived ./cmd/hived
./hived login       # sign in with GitHub in the browser, enroll this machine
./hived run         # connect to every pool it serves and wait for jobs
./hived status
./hived benchmark
```

`HIVE_SERVER` points it at another server (`http://localhost:3000` for local
development) and `HIVE_CONFIG` at another machine file.

## One machine, several organizations

A machine belongs to its owner, not to a pool. At `hived login` someone in
several organizations chooses which of them the machine serves, and can add or
remove pools later from the dashboard without touching the machine: the
running daemon asks the server every minute and opens or closes a tunnel per
pool to match. It runs one job at a time across all of them.

## What it keeps

One file, `~/Library/Application Support/HiveWorker/machine.json`, readable
by its owner only: the server, the machine id and the machine token. Which
pools it serves is not stored; the server is asked. The GitHub sign-in is
used once to obtain that token and is not kept. Moving the token to the
Keychain is planned.

## What it does not do yet

It does not run jobs. It answers a job offer with a refusal so the coordinator
offers the job elsewhere. The VM runner (Virtualization.framework, a warm VM,
copy-on-write job disks) is the next milestone; see `docs/spec.md` §6a.

It pauses on battery and with the lid closed. Throttling when the owner is
active arrives with the VM runner, since there is nothing to throttle before.

## Layout

| Package             | Holds                                                        |
| ------------------- | ------------------------------------------------------------ |
| `cmd/hived`         | The command                                                  |
| `internal/api`      | Device sign-in and enrollment over HTTPS                     |
| `internal/tunnel`   | The reconnecting WebSocket to the coordinator                |
| `internal/protocol` | Tunnel messages, tested against `packages/protocol/fixtures` |
| `internal/host`     | Hardware facts, power and lid state                          |
| `internal/bench`    | The speed score benchmark                                    |
| `internal/config`   | The machine file                                             |

## Tests

`go test ./...` runs everywhere, against stand-in servers. `pnpm test:daemon`
from the repository root runs the built binary against the real web and
coordinator Workers on a fresh local database (macOS only).
