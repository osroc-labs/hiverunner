package main

import (
	"fmt"
	"sync"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/host"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/jobs"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/settings"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/vm"
)

// hostMemory is this machine's total memory, read once: it does not change
// while the daemon runs.
var hostMemory = sync.OnceValue(func() uint64 {
	facts, err := host.ReadFacts()
	if err != nil || facts.MemoryBytes < 0 {
		return 0
	}
	return uint64(facts.MemoryBytes)
})

// guestMemory is the memory a job of this many vCPUs is given on this host.
func guestMemory(vcpus int) uint64 { return vm.GuestMemoryBytes(vcpus, hostMemory()) }

// overcommit says so when the owner's settings would, at their fullest, ask
// for more memory than the host can give now: every job slot filled with the
// largest job it takes, and the warm VM on top. It is "" when they fit, and
// when the host cannot say what is available.
func overcommit(facts host.Facts, current settings.Settings, available uint64) (problem, fix string) {
	if available == 0 {
		return "", ""
	}
	largest := uint64(0)
	for _, vcpus := range most(facts, current) {
		largest = max(largest, vm.GuestMemoryBytes(vcpus, uint64(facts.MemoryBytes)))
	}
	if largest == 0 {
		return "", ""
	}
	wanted := uint64(current.MaxJobs) * largest
	if current.Warm {
		wanted += vm.GuestMemoryBytes(warmVCPUs, uint64(facts.MemoryBytes))
	}
	wanted += jobs.MemoryMargin
	if wanted <= available {
		return "", ""
	}
	const gib = 1 << 30
	each := fmt.Sprintf("%d GB each", largest/gib)
	if current.Warm {
		each += ", plus the warm VM,"
	}
	return fmt.Sprintf("max-jobs %d of %s needs %d GB with a margin, but only %d GB is available now; a full load would run out of memory and take the daemon with it",
		current.MaxJobs, each, (wanted+gib-1)/gib, available/gib), "lower it with hived config set max-jobs or max-vcpus, or turn warm off"
}
