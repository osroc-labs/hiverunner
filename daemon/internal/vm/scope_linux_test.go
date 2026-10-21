//go:build linux

package vm

import (
	"slices"
	"testing"
)

func TestAVMStartsInItsOwnScopeWhereThereAreScopes(t *testing.T) {
	name, args := inOwnScope(true, "job 1", "/usr/bin/qemu", []string{"-m", "1G"})
	if name != "systemd-run" || !slices.Contains(args, "--scope") || !slices.Contains(args, "OOMPolicy=continue") {
		t.Fatalf("got %s %v", name, args)
	}
	if n := len(args); args[n-3] != "/usr/bin/qemu" || args[n-2] != "-m" || args[n-1] != "1G" {
		t.Errorf("the VM's own command was not last: %v", args)
	}
}

func TestAVMStartsPlainlyWhereThereAreNoScopes(t *testing.T) {
	name, args := inOwnScope(false, "job", "/usr/bin/qemu", []string{"-m", "1G"})
	if name != "/usr/bin/qemu" || len(args) != 2 {
		t.Fatalf("got %s %v", name, args)
	}
}

func TestAUnitNameKeepsOnlyWhatSystemdAllows(t *testing.T) {
	if got := unitSafe("a b/c.d-1"); got != "a-b-c-d-1" {
		t.Errorf("got %q", got)
	}
}
