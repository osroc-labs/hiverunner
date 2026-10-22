//go:build darwin

package host

import (
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"golang.org/x/sys/unix"
)

// ReadFacts describes this Mac.
func ReadFacts() (Facts, error) {
	model, err := unix.Sysctl("hw.model")
	if err != nil {
		return Facts{}, err
	}
	memory, err := unix.SysctlUint64("hw.memsize")
	if err != nil {
		return Facts{}, err
	}
	name, err := os.Hostname()
	if err != nil || name == "" {
		name = model
	}
	return Facts{
		Name:        strings.TrimSuffix(name, ".local"),
		Model:       model,
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		Cores:       runtime.NumCPU(),
		MemoryBytes: int64(memory),
	}, nil
}

// ReadPower asks macOS about power and the lid. An unreadable lid pauses jobs.
func ReadPower() Power {
	battery, err := exec.Command("/usr/bin/pmset", "-g", "batt").Output()
	onBattery := err != nil || !strings.Contains(string(battery), "AC Power")

	// Desktops have no clamshell key at all, which reads as "not closed".
	lid, err := exec.Command("/usr/sbin/ioreg", "-r", "-k", "AppleClamshellState", "-d", "4").Output()
	lidClosed := err != nil || strings.Contains(string(lid), `"AppleClamshellState" = Yes`)

	return Power{OnBattery: onBattery, LidClosed: lidClosed, HasLid: strings.Contains(string(lid), "AppleClamshellState")}
}

// StayAwake is how the owner keeps this Mac awake with its lid closed.
const StayAwake = "sudo pmset -a disablesleep 1"

// StaysAwake reports whether this Mac stays awake with its lid closed. A
// closed MacBook sleeps whatever else is set unless sleep is disabled
// outright. known is false when macOS would not say.
func StaysAwake() (awake, known bool) {
	settings, err := exec.Command("/usr/bin/pmset", "-g").Output()
	if err != nil {
		return false, false
	}
	return pmsetValue(string(settings), "SleepDisabled") == "1", true
}

// pmsetValue is one setting from what `pmset -g` prints, or "" if it is not
// there. A value may be followed by a note in brackets.
func pmsetValue(settings, name string) string {
	for _, line := range strings.Split(settings, "\n") {
		if fields := strings.Fields(line); len(fields) >= 2 && fields[0] == name {
			return fields[1]
		}
	}
	return ""
}

// Unattended looks at what stops a Mac taking jobs with its lid closed or
// after a restart nobody was there for.
func Unattended() []Check {
	var checks []Check
	raw, err := exec.Command("/usr/bin/pmset", "-g").Output()
	settings := string(raw)
	power := ReadPower()
	switch {
	case err != nil:
		checks = append(checks, Check{Name: "sleep", Found: "pmset would not say", Fix: "run pmset -g and look for SleepDisabled 1"})
	case pmsetValue(settings, "SleepDisabled") == "1":
		checks = append(checks, Check{Name: "sleep", Found: "disabled, so it stays awake with the lid closed", OK: true})
	case power.LidClosed:
		checks = append(checks, Check{Name: "sleep", Found: "not disabled: closed, this Mac is awake only while a display and power are attached", Fix: StayAwake})
	case power.HasLid:
		checks = append(checks, Check{Name: "sleep", Found: "not disabled: this Mac sleeps when its lid closes", Fix: StayAwake})
	case pmsetValue(settings, "sleep") != "0":
		checks = append(checks, Check{Name: "sleep", Found: "sleeps after " + pmsetValue(settings, "sleep") + " idle minutes", Fix: "sudo pmset -a sleep 0"})
	default:
		checks = append(checks, Check{Name: "sleep", Found: "never sleeps when idle", OK: true})
	}
	// A desktop comes back by itself after a power cut only if told to. A
	// MacBook has no such setting.
	if restart := pmsetValue(settings, "autorestart"); restart == "1" {
		checks = append(checks, Check{Name: "power cut", Found: "starts up again by itself", OK: true})
	} else if restart == "0" {
		checks = append(checks, Check{Name: "power cut", Found: "stays off until someone presses the button", Fix: "sudo pmset -a autorestart 1"})
	}

	// FileVault stops a restart at the unlock screen and rules auto-login
	// out. It is also what protects the disk, so it is the owner's call.
	vault, vaultErr := exec.Command("/usr/bin/fdesetup", "status").Output()
	locked := vaultErr == nil && strings.Contains(string(vault), "FileVault is On")

	// hived is a launch agent: it starts when its user logs in, not at boot.
	user := os.Getenv("USER")
	login := "System Settings > Users & Groups > Automatically log in as " + user
	auto, err := exec.Command("/usr/bin/defaults", "read", "/Library/Preferences/com.apple.loginwindow", "autoLoginUser").Output()
	switch name := strings.TrimSpace(string(auto)); {
	case locked:
		checks = append(checks, Check{Name: "auto-login", Found: "not possible with FileVault on", Note: true, Fix: "after a restart, log in by hand and hived starts"})
	case err != nil || name == "":
		checks = append(checks, Check{Name: "auto-login", Found: "off: after a restart hived waits for someone to log in", Fix: login})
	case name != user:
		checks = append(checks, Check{Name: "auto-login", Found: "logs in " + name + ", and hived runs as " + user, Fix: login})
	default:
		checks = append(checks, Check{Name: "auto-login", Found: "logs in " + name, OK: true})
	}

	switch {
	case vaultErr != nil:
		checks = append(checks, Check{Name: "FileVault", Found: "fdesetup would not say", Fix: "run fdesetup status"})
	case locked:
		checks = append(checks, Check{Name: "FileVault", Found: "on: a restart stops at the unlock screen", Note: true, Fix: "unlock it by hand after each restart, or turn FileVault off in System Settings > Privacy & Security"})
	default:
		checks = append(checks, Check{Name: "FileVault", Found: "off", OK: true})
	}
	return checks
}

// Exposed looks at what this Mac leaves open to the jobs it runs and to its
// network.
func Exposed() []Check {
	var checks []Check
	said, _ := exec.Command("/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate").Output()
	switch on, known := firewallState(string(said)); {
	case on:
		checks = append(checks, Check{Name: "firewall", Found: "on", OK: true})
	case known:
		checks = append(checks, Check{Name: "firewall", Found: "off: whatever listens on this Mac answers its network", Note: true, Fix: "turn it on in System Settings > Network > Firewall"})
	}

	if table, err := exec.Command("/usr/sbin/netstat", "-an", "-p", "tcp").Output(); err == nil {
		listening := netstatListening(string(table))
		// sshd's settings are root's to read, and sudo is never let ask
		// for a password here.
		if !listening[22] {
			checks = append(checks, Check{Name: "ssh", Found: "Remote Login is off", OK: true})
		} else if settings, err := exec.Command("/usr/bin/sudo", "-n", "/usr/sbin/sshd", "-T").Output(); err == nil {
			if sshPasswords(string(settings)) {
				checks = append(checks, Check{Name: "ssh", Found: "Remote Login is on and takes passwords", Note: true, Fix: sshKeysOnly + ", or turn Remote Login off"})
			} else {
				checks = append(checks, Check{Name: "ssh", Found: "Remote Login takes keys only", OK: true})
			}
		}
		checks = append(checks, sharing(listening, []service{
			{"Screen Sharing or Remote Management", 5900},
			{"File Sharing", 445},
			{"AirPlay Receiver", 7000},
		}, "turn off what you do not use in System Settings > General > Sharing; AirPlay Receiver is in General > AirDrop & Handoff")...)
	}
	addresses, _ := net.InterfaceAddrs()
	return append(checks, network(addresses, outbound())...)
}

// AvailableMemory is not read on a Mac, where the system reclaims cached
// memory on demand and no figure says what a new VM can have. Zero means
// unknown, and nothing is declined for it.
func AvailableMemory() uint64 { return 0 }
