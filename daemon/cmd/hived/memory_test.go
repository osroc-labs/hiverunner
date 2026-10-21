package main

import (
	"strings"
	"testing"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/host"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/settings"
)

func TestOvercommitWarnsWhenAFullLoadWouldNotFit(t *testing.T) {
	const gib = 1 << 30
	facts := host.Facts{Cores: 16, MemoryBytes: 60 * gib}
	current := settings.Settings{MaxJobs: 4, Warm: true}
	// Four of the largest job plus warm need far more than 10 GB.
	problem, fix := overcommit(facts, current, 10*gib)
	if problem == "" || fix == "" || !strings.Contains(problem, "max-jobs 4") {
		t.Fatalf("overcommit = %q, %q; want a warning naming max-jobs", problem, fix)
	}
	if problem, _ := overcommit(facts, current, 80*gib); problem != "" {
		t.Errorf("plenty of memory still warned: %q", problem)
	}
	if problem, _ := overcommit(facts, current, 0); problem != "" {
		t.Errorf("unknown memory warned: %q", problem)
	}
}
