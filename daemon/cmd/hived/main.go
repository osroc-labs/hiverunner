// hived is the HiveWorker daemon: it enrolls this machine in its
// organization's pool and holds the tunnel jobs arrive through.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/thecomputerplumbers/hiveworker/daemon/internal/api"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/bench"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/config"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/host"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/protocol"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/tunnel"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "0.0.0-dev"

const defaultServer = "https://hiveworkr.thecomputerplumbers.com"

const usage = `hived, the HiveWorker daemon

  hived login       Sign in with GitHub and add this machine to your pool
  hived run         Connect to the pool and wait for jobs
  hived status      Show what this machine is enrolled as
  hived logout      Forget this machine's token
  hived benchmark   Measure this machine's speed score
  hived version

Set HIVE_SERVER to use a server other than ` + defaultServer + `.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var err error
	switch os.Args[1] {
	case "login":
		err = login(ctx, os.Args[2:])
	case "run":
		err = run(ctx)
	case "status":
		err = status()
	case "logout":
		err = config.Remove()
	case "benchmark":
		err = benchmark(os.Args[2:])
	case "version", "--version":
		fmt.Println(version)
	case "help", "-h", "--help":
		fmt.Print(usage)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "hived:", err)
		os.Exit(1)
	}
}

func server() string {
	if override := os.Getenv("HIVE_SERVER"); override != "" {
		return override
	}
	return defaultServer
}

func login(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("login", flag.ExitOnError)
	pool := flags.String("pool", "", "the pool to join, if you belong to several")
	noBrowser := flags.Bool("no-browser", false, "print the sign-in link instead of opening it")
	_ = flags.Parse(args)

	facts, err := host.ReadFacts()
	if err != nil {
		return err
	}
	fmt.Printf("Measuring this machine (%s, %d cores)...\n", facts.Model, facts.Cores)
	score := bench.Score(bench.Run(3 * time.Second))

	client := api.New(server())
	code, err := client.StartDevice(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("\nTo add this machine, approve this code in your browser:\n\n    %s\n\n%s\n\n", code.UserCode, code.VerificationURIComplete)
	if !*noBrowser && runtime.GOOS == "darwin" {
		_ = exec.Command("/usr/bin/open", code.VerificationURIComplete).Start()
	}
	fmt.Println("Waiting for approval...")
	token, err := client.AwaitToken(ctx, code)
	if err != nil {
		return err
	}

	machine := api.Machine{
		OrganizationID: *pool,
		Name:           facts.Name,
		Model:          facts.Model,
		OS:             facts.OS,
		Arch:           facts.Arch,
		Cores:          facts.Cores,
		MemoryBytes:    facts.MemoryBytes,
		DaemonVersion:  version,
		SpeedScore:     score,
	}
	enrollment, err := client.Enroll(ctx, token, machine)
	var choose *api.ChoosePoolError
	if errors.As(err, &choose) {
		machine.OrganizationID, err = askPool(choose.Pools)
		if err != nil {
			return err
		}
		enrollment, err = client.Enroll(ctx, token, machine)
	}
	if err != nil {
		return err
	}
	if err := config.Save(config.Machine{
		Server:         client.Server,
		TunnelURL:      enrollment.TunnelURL,
		MachineID:      enrollment.MachineID,
		OrganizationID: enrollment.OrganizationID,
		Token:          enrollment.Token,
	}); err != nil {
		return err
	}
	fmt.Printf("\n%s is in the pool. Start it with: hived run\n", facts.Name)
	return nil
}

func askPool(pools []api.Pool) (string, error) {
	fmt.Println("\nYou belong to more than one pool. Which should this machine join?")
	for i, pool := range pools {
		fmt.Printf("  %d. %s\n", i+1, pool.Name)
	}
	fmt.Print("> ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		return "", errors.New("no pool chosen; run again with --pool")
	}
	choice, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil || choice < 1 || choice > len(pools) {
		return "", errors.New("that is not one of the pools listed")
	}
	return pools[choice-1].ID, nil
}

func run(ctx context.Context) error {
	machine, err := config.Load()
	if err != nil {
		return err
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	log.Info("starting", "version", version, "machine", machine.MachineID)
	return tunnel.Run(ctx, tunnel.Options{
		URL:           machine.TunnelURL,
		Token:         machine.Token,
		DaemonVersion: version,
		Log:           log,
		Presence: func() protocol.Presence {
			if host.ReadPower().Available() {
				return protocol.Online
			}
			return protocol.Paused
		},
	})
}

func status() error {
	machine, err := config.Load()
	if err != nil {
		return err
	}
	power := host.ReadPower()
	fmt.Printf("Machine:  %s\nPool:     %s\nServer:   %s\nTunnel:   %s\n", machine.MachineID, machine.OrganizationID, machine.Server, machine.TunnelURL)
	switch {
	case power.OnBattery:
		fmt.Println("Jobs:     paused (on battery)")
	case power.LidClosed:
		fmt.Println("Jobs:     paused (lid closed)")
	default:
		fmt.Println("Jobs:     would accept")
	}
	return nil
}

func benchmark(args []string) error {
	flags := flag.NewFlagSet("benchmark", flag.ExitOnError)
	raw := flags.Bool("raw", false, "print units per second, for calibrating the reference")
	seconds := flags.Int("seconds", 5, "how long to measure")
	_ = flags.Parse(args)
	unitsPerSecond := bench.Run(time.Duration(*seconds) * time.Second)
	if *raw {
		fmt.Printf("%.2f\n", unitsPerSecond)
		return nil
	}
	fmt.Printf("%.2f units/s on one core: speed score %.2f\n", unitsPerSecond, bench.Score(unitsPerSecond))
	return nil
}
