//go:build !darwin

package main

import (
	"os"
	"os/exec"
	"path/filepath"
)

// What this kind of machine is called in what hived prints.
const thisMachine = "this machine"

// serviceUnit is the systemd user service install.sh creates.
const serviceUnit = "hiveworker.service"

// servicePaths is where install.sh put the service's definition. The log is
// in the journal, which keeps itself.
func servicePaths(home string) (definition, logs string) {
	return filepath.Join(home, ".config", "systemd", "user", serviceUnit), ""
}

func stopService() {
	_ = exec.Command("systemctl", "--user", "disable", "--now", serviceUnit).Run()
}

// haltService stops the daemon and leaves it enabled, so it is back at the
// next login as it would be on a Mac.
func haltService() error {
	return exec.Command("systemctl", "--user", "stop", serviceUnit).Run()
}

func startService(string) error {
	return exec.Command("systemctl", "--user", "start", serviceUnit).Run()
}

// systemd keeps a unit loaded until it is told the file has gone.
func forgetService() {
	_ = exec.Command("systemctl", "--user", "daemon-reload").Run()
}

// openBrowser shows the sign-in page where there is a browser to show it in.
// The link is printed too, so a machine with no screen loses nothing.
func openBrowser(url string) {
	// Under Windows' Linux subsystem the browser is Windows' own.
	if os.Getenv("WSL_DISTRO_NAME") != "" {
		if explorer := "/mnt/c/Windows/explorer.exe"; exists(explorer) {
			_ = exec.Command(explorer, url).Start()
		}
		return
	}
	if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		return
	}
	if opener, err := exec.LookPath("xdg-open"); err == nil {
		_ = exec.Command(opener, url).Start()
	}
}

func exists(file string) bool {
	_, err := os.Stat(file)
	return err == nil
}
