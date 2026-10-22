package main

import (
	"context"
	"errors"
	"log/slog"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/jobs"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/macvm"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/native"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/settings"
)

// macosWay is one way of running a hive-macos job.
type macosWay interface {
	jobs.Runner
	jobs.Unusable
}

// macosRunner runs a hive-macos job the way the owner's macos-isolation
// setting says when the job is offered and when it starts: as the
// hiveworker user on the Mac itself, or in a throwaway macOS VM. Either
// way may be missing, with the reason it is.
type macosRunner struct {
	user, vm               macosWay
	userMissing, vmMissing string
	settings               func() settings.Settings
}

var _ macosWay = (*macosRunner)(nil)

func (m *macosRunner) way() (macosWay, string) {
	if m.settings().MacOSInVM() {
		return m.vm, m.vmMissing
	}
	return m.user, m.userMissing
}

// Run implements jobs.Runner.
func (m *macosRunner) Run(ctx context.Context, job jobs.Job) (jobs.Result, error) {
	way, missing := m.way()
	if way == nil {
		return jobs.Result{ExitCode: -1}, errors.New(missing)
	}
	return way.Run(ctx, job)
}

// Unusable implements jobs.Unusable.
func (m *macosRunner) Unusable() string {
	way, missing := m.way()
	if way == nil {
		return missing
	}
	return way.Unusable()
}

// limit is what the setting asks of the pool's offers: two macOS VMs at
// most, and each one's memory free on the host. Jobs on the Mac itself are
// limited by max-jobs alone, as they always were.
func (m *macosRunner) limit(limits *jobs.Limits, hostBytes uint64) {
	if m.settings().MacOSInVM() {
		limits.MostMacOS = macvm.MostVMs
		limits.MacOSMemory = macvm.Memory(hostBytes)
	}
}

// newMacOSRunner builds both ways, for a daemon that may be asked either.
func newMacOSRunner(log *slog.Logger, live func() settings.Settings) *macosRunner {
	runner := &macosRunner{settings: live}
	if user, err := native.New(log); err != nil {
		runner.userMissing = "macOS jobs are not available: " + err.Error()
	} else {
		runner.user = user
	}
	if dir, err := macosImageDir(live()); err != nil {
		runner.vmMissing = "the macOS image is not available: " + err.Error()
	} else {
		runner.vm = &macvm.Runner{Dir: dir, WorkDir: workDir(dir), Log: log}
	}
	return runner
}
