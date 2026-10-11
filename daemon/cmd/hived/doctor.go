package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/thecomputerplumbers/hiveworker/daemon/internal/api"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/config"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/connection"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/host"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/settings"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/ui"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/vm"
)

// asleep is what to say when the owner lends with the lid closed but the
// machine would not stay awake closed, and what to do about it. Both are ""
// when there is nothing to say.
func asleep(current settings.Settings, power host.Power) (problem, fix string) {
	if !current.Lid || !power.HasLid {
		return "", ""
	}
	switch awake, known := host.StaysAwake(); {
	case !known:
		return "lid is on, but hived could not check that " + thisMachine + " stays awake closed", host.StayAwake
	case !awake && power.LidClosed:
		// Closed, awake and able to say so: a display is holding it awake.
		return "lid is on, but closed " + thisMachine + " is awake only while a display and power are attached", host.StayAwake
	case !awake:
		return "lid is on, but " + thisMachine + " sleeps when its lid closes, and takes no jobs asleep", host.StayAwake
	}
	return "", ""
}

// doctor is `hived doctor`: whether this machine keeps taking jobs with
// nobody at it, through a closed lid and a restart. It fails if not, so a
// script setting a machine up can ask. What the owner may have chosen, such
// as FileVault, is said and does not fail it.
func doctor() error {
	current, err := settings.Load()
	if err != nil {
		return err
	}
	power := host.ReadPower()
	var checks []host.Check

	if machine, err := config.Load(); err != nil {
		checks = append(checks, host.Check{Name: "sign-in", Found: "this machine is not in a hive", Fix: "hived login"})
	} else {
		checks = append(checks, reach(machine)...)
	}
	if home, err := os.UserHomeDir(); err == nil {
		definition, _ := servicePaths(home)
		if _, err := os.Stat(definition); err != nil {
			checks = append(checks, host.Check{Name: "service", Found: "not installed, so hived runs only while you run it", Fix: "run the installer again"})
		} else {
			checks = append(checks, host.Check{Name: "service", Found: "installed", OK: true})
		}
	}
	if reason, fix := current.Holding(power, time.Now()), current.Fix(power, time.Now()); reason != "" {
		checks = append(checks, host.Check{Name: "jobs", Found: "not taking jobs: " + reason, Fix: fix})
	} else if reason, fix := cannotRunVMs(); reason != "" {
		checks = append(checks, host.Check{Name: "jobs", Found: "not taking jobs: " + reason, Fix: fix})
	} else {
		checks = append(checks, host.Check{Name: "jobs", Found: "taking jobs", OK: true})
	}
	switch {
	case !power.OnBattery:
		checks = append(checks, host.Check{Name: "power", Found: "plugged in", OK: true})
	case current.Battery:
		checks = append(checks, host.Check{Name: "power", Found: "on battery, and taking jobs until it runs out", Note: true, Fix: "plug it in"})
	default:
		checks = append(checks, host.Check{Name: "power", Found: "on battery", Fix: "plug it in or run hived config set battery on"})
	}
	if power.HasLid {
		if current.Lid {
			checks = append(checks, host.Check{Name: "lid", Found: "takes jobs with the lid closed", OK: true})
		} else {
			checks = append(checks, host.Check{Name: "lid", Found: "jobs stop when the lid closes", Fix: "hived config set lid on"})
		}
	}
	// A disk the owner keeps the image or the cache on has to be attached.
	if gone := absent(current); len(gone) > 0 {
		checks = append(checks, host.Check{Name: "storage", Found: strings.Join(gone, " and ") + " is not there, so nothing kept in it can be used",
			Fix: "attach its disk, or run hived config set data-dir default (cache-dir for the cache)"})
	} else if current.DataDir != "" || current.CacheDir != "" {
		kept := []string{}
		if current.DataDir != "" {
			kept = append(kept, "the image in "+current.DataDir)
		}
		if current.CacheDir != "" {
			kept = append(kept, "the cache in "+current.CacheDir)
		}
		checks = append(checks, host.Check{Name: "storage", Found: strings.Join(kept, ", "), OK: true})
	}
	checks = append(checks, host.Unattended()...)

	screen := ui.For(os.Stdout)
	var rows []string
	problems := 0
	for _, check := range checks {
		const name = 14
		for i, line := range wrap(check.Found, ui.Inner-name-2) {
			if i == 0 {
				rows = append(rows, screen.Dot(check.OK || check.Note)+" "+ui.Pad(check.Name, name)+line)
				continue
			}
			rows = append(rows, "  "+ui.Pad("", name)+line)
		}
		if !check.OK {
			if !check.Note {
				problems++
			}
			for _, line := range wrap(check.Fix, ui.Inner-name-2) {
				rows = append(rows, "  "+ui.Pad("", name)+screen.Dim(line))
			}
		}
	}
	fmt.Println()
	fmt.Print(indent(screen.Box("Unattended", rows...)))
	switch problems {
	case 0:
		fmt.Println(indent(screen.Dim(thisMachine + " keeps taking jobs with nobody at it.")))
		return nil
	case 1:
		return fmt.Errorf("one thing would stop %s taking jobs with nobody at it", thisMachine)
	}
	return fmt.Errorf("%d things would stop %s taking jobs with nobody at it", problems, thisMachine)
}

// reach is whether this machine can find and talk to the server and the
// coordinator its jobs arrive through. A machine that cannot takes no jobs
// and, but for this, says so only in its log.
func reach(machine config.Machine) []host.Check {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	const network = "check this machine's network and its DNS; nothing needs restarting, the daemon keeps trying"
	name := func(address string) string {
		if parsed, err := url.Parse(address); err == nil && parsed.Hostname() != "" {
			return parsed.Hostname()
		}
		return address
	}
	// Looked up first and by itself, so a name that does not resolve is
	// said to be that and not a server that is down.
	resolves := func(hostname string) bool {
		if net.ParseIP(hostname) != nil || hostname == "localhost" {
			return true
		}
		_, err := net.DefaultResolver.LookupHost(ctx, hostname)
		return err == nil
	}
	server := name(machine.Server)
	if !resolves(server) {
		return []host.Check{{Name: "server", Found: "cannot look up " + server + ": DNS has no answer for it here", Fix: network}}
	}
	assignment, err := api.New(machine.Server).Me(ctx, machine.Token)
	switch {
	case errors.Is(err, api.ErrUnknownMachine):
		return []host.Check{{Name: "sign-in", Found: "the server no longer knows this machine", Fix: "hived logout, then hived login"}}
	case err != nil:
		return []host.Check{{Name: "server", Found: "cannot reach " + server + ": " + connection.Reason(err.Error()), Fix: network}}
	}
	checks := []host.Check{{Name: "server", Found: "reaches " + server, OK: true}}
	if len(assignment.Pools) == 0 {
		checks = append(checks, host.Check{Name: "sign-in", Found: "signed in, but in no hive", Fix: "hived link"})
	} else {
		checks = append(checks, host.Check{Name: "sign-in", Found: "in a hive", OK: true})
	}
	if tunnel := name(assignment.TunnelURL); tunnel != server && !resolves(tunnel) {
		checks = append(checks, host.Check{Name: "tunnel", Found: "cannot look up " + tunnel + ", which jobs arrive through: DNS has no answer for it here", Fix: network})
		return checks
	}
	// What the running daemon says of each hive's tunnel.
	if remembered, err := connection.Load(); err == nil && remembered.Live() {
		for _, hive := range remembered.Hives {
			switch {
			case hive.Connected:
				checks = append(checks, host.Check{Name: "tunnel", Found: "connected to " + hive.Name + " since " + when(hive.Since, time.Now()), OK: true})
			case hive.Error != "":
				checks = append(checks, host.Check{Name: "tunnel", Found: "not connected to " + hive.Name + " since " + when(hive.Since, time.Now()) + ": " + connection.Reason(hive.Error), Fix: network})
			}
		}
	}
	return checks
}

// cannotRunVMs is why this machine cannot start a VM right now and what
// would put it right, or two empty strings if it can. The daemon declines
// jobs for as long as it is so, whatever the owner's settings say.
func cannotRunVMs() (reason, fix string) {
	err := vm.Preflight()
	if err == nil {
		return "", ""
	}
	// The hypervisor's complaints say what to do after a colon.
	reason, fix, _ = strings.Cut(err.Error(), ": ")
	return reason, fix
}
