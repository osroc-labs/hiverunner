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

func TestMemoryPlanLeavesTheReserve(t *testing.T) {
	const gib = 1 << 30
	facts := host.Facts{Cores: 16, MemoryBytes: 60 * gib}
	// The largest job on 60 GB is 8 vCPUs: 16 GB.
	current := settings.Settings{MaxJobs: 4, ReserveMemory: "24G"}
	p := memoryPlan(facts, current)
	if p.Budget != 36*gib || p.Reserve != 24*gib || p.Largest != 16*gib || p.Jobs != 2 {
		t.Fatalf("plan = %+v, want 36 GB budget, 24 GB reserved, 2 jobs of 16 GB", p)
	}
	// The warm VM (4 GB) comes out of the budget first: 32 GB is two jobs,
	// but 24 GB less 4 GB is one.
	current.Warm = true
	current.ReserveMemory = "28G"
	if p := memoryPlan(facts, current); p.Jobs != 1 {
		t.Errorf("with warm: %+v, want 1 job", p)
	}
	current.ReserveMemory = "40%"
	if p := memoryPlan(facts, current); p.Reserve != 24*gib {
		t.Errorf("40%% of 60 GB = %d", p.Reserve)
	}
	// max-jobs still caps it.
	current = settings.Settings{MaxJobs: 1, ReserveMemory: "4G"}
	if p := memoryPlan(facts, current); p.Jobs != 1 {
		t.Errorf("max-jobs 1: %+v", p)
	}
}

func TestReserveProblemWhenNoJobFits(t *testing.T) {
	const gib = 1 << 30
	facts := host.Facts{Cores: 16, MemoryBytes: 60 * gib}
	current := settings.Settings{MaxJobs: 2, MaxVCPUs: 8, ReserveMemory: "50G"}
	problem, fix := reserveProblem(facts, current)
	if problem == "" || fix == "" || !strings.Contains(problem, "50G") {
		t.Fatalf("reserveProblem = %q, %q; want a warning naming the reserve", problem, fix)
	}
	current.ReserveMemory = "24G"
	if problem, _ := reserveProblem(facts, current); problem != "" {
		t.Errorf("a reserve with room warned: %q", problem)
	}
	current.ReserveMemory = ""
	if problem, _ := reserveProblem(facts, current); problem != "" {
		t.Errorf("no reserve warned: %q", problem)
	}
	lines := budgetLines(host.Facts{Cores: 16, MemoryBytes: 60 * gib}, settings.Settings{MaxJobs: 4, ReserveMemory: "24G"})
	if len(lines) != 2 || lines[0] != "Memory budget 36 of 60 GB (24 GB reserved)" || lines[1] != "Effective: 2 jobs at once" {
		t.Errorf("budgetLines = %q", lines)
	}
}
