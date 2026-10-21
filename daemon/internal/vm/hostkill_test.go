package vm

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseMemAvailable(t *testing.T) {
	got := parseMemAvailable("MemTotal:       61000000 kB\nMemFree:  100 kB\nMemAvailable:    1048576 kB\n")
	if got != 1<<30 {
		t.Fatalf("parseMemAvailable = %d, want 1 GiB", got)
	}
	if parseMemAvailable("MemTotal: 1 kB\n") != 0 {
		t.Fatal("a missing MemAvailable must read as unknown")
	}
}

func TestASiblingKillMarksJobsBootedBeforeIt(t *testing.T) {
	work := t.TempDir()
	newVM := func(name string, booted time.Time) *instance {
		return &instance{dir: filepath.Join(work, name), booted: booted}
	}
	before := newVM("job-a", time.Now().Add(-time.Minute))
	victim := newVM("job-b", time.Now().Add(-time.Minute))
	if siblingKilled(before) {
		t.Fatal("no kill yet, but a sibling was reported")
	}
	hostKilledVM(victim)
	if !victim.hostKilled || siblingKilled(victim) {
		t.Fatal("the killed VM is the victim, not its own sibling")
	}
	if !siblingKilled(before) {
		t.Fatal("a VM running during the kill must see it")
	}
	// A VM booted after the kill, such as one after a restart, does not.
	after := newVM("job-c", time.Now().Add(time.Minute))
	if siblingKilled(after) {
		t.Fatal("a VM booted after the kill was blamed on it")
	}
	if err := os.WriteFile(filepath.Join(work, hostKillMarker), []byte("1073741824\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := hostAvailable(before); got != 1<<30 {
		t.Fatalf("hostAvailable = %d, want the marker's 1 GiB", got)
	}
}
