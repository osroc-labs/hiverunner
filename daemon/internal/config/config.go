// Package config keeps the one thing the daemon must remember between runs:
// which machine it is, and the token that proves it.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Machine is the daemon's identity after enrollment. Which pools it serves is
// not kept here: that can change from the dashboard, so the daemon asks.
type Machine struct {
	// Server is the web origin the machine enrolled with.
	Server    string `json:"server"`
	MachineID string `json:"machineId"`
	// Token is the machine's only credential. It is never logged.
	Token string `json:"token"`
}

// ErrNotEnrolled means there is no saved machine: run `hived login`.
var ErrNotEnrolled = errors.New("this machine is not enrolled; run `hived login`")

// Path is where the machine file lives. HIVE_CONFIG overrides it, for tests
// and for running two daemons on one machine during development.
func Path() (string, error) {
	if override := os.Getenv("HIVE_CONFIG"); override != "" {
		return override, nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "HiveWorker", "machine.json"), nil
}

func Load() (Machine, error) {
	path, err := Path()
	if err != nil {
		return Machine{}, err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Machine{}, ErrNotEnrolled
	}
	if err != nil {
		return Machine{}, err
	}
	var machine Machine
	if err := json.Unmarshal(raw, &machine); err != nil {
		return Machine{}, fmt.Errorf("%s is not readable: %w", path, err)
	}
	if machine.Token == "" || machine.Server == "" {
		return Machine{}, ErrNotEnrolled
	}
	return machine, nil
}

// Save writes the machine file readable by its owner only, replacing it in
// one step so a crash cannot leave half a token behind.
func Save(machine Machine) error {
	path, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(machine, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

// Remove forgets the machine. Not an error if there was nothing to forget.
func Remove() error {
	path, err := Path()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
