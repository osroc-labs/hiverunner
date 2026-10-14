package main

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/settings"
)

// installedService is the service the installer set up, or an error saying
// there is none: a daemon started by hand is stopped where it was started.
func installedService() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	definition, _ := servicePaths(home)
	if _, err := os.Stat(definition); err != nil {
		return "", errors.New("the installer's service is not on " + thisMachine + ", so there is nothing to start or stop here.\nRun the installer again, or run the daemon in this terminal with: hived run")
	}
	return definition, nil
}

// waitFor polls until the daemon is, or is not, running.
func waitFor(running bool, current settings.Settings, limit time.Duration) bool {
	for deadline := time.Now().Add(limit); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if daemonRunning(current) == running {
			return true
		}
	}
	return daemonRunning(current) == running
}

// halt is `hived stop`: the daemon stops, and so does a job it is running.
// It returns once the daemon has let go of its work directory, so what
// follows it on a command line has the machine to itself.
func halt() error {
	current, err := settings.Load()
	if err != nil {
		return err
	}
	if !daemonRunning(current) {
		fmt.Println("The daemon is not running.")
		return nil
	}
	if _, err := installedService(); err != nil {
		return errors.New("a hived is running, but not as the installer's service; stop it where it was started, with Ctrl-C")
	}
	_ = haltService()
	// It destroys its VMs before it exits, which takes a few seconds.
	if !waitFor(false, current, 90*time.Second) {
		return errors.New("the daemon was told to stop and is still running; it may be finishing a job's VM. Try again in a moment")
	}
	fmt.Println("Stopped. It takes no jobs until it is started: hived start")
	fmt.Println("It also starts by itself when you next log in. To keep it from jobs for longer, use: hived pause")
	return nil
}

// start is `hived start`.
func start() error {
	current, err := settings.Load()
	if err != nil {
		return err
	}
	if daemonRunning(current) {
		fmt.Println("The daemon is already running.")
		return nil
	}
	definition, err := installedService()
	if err != nil {
		return err
	}
	if err := startService(definition); err != nil {
		return fmt.Errorf("the service would not start: %w", err)
	}
	if !waitFor(true, current, 20*time.Second) {
		return errors.New("the service was started, but the daemon is not running. See why with: hived status, and its log")
	}
	fmt.Println("Started.")
	return nil
}
