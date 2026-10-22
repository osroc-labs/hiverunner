package macvm

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/jobs"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/native"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/vm"
)

const (
	// MostVMs is how many macOS VMs a Mac runs at once: Apple's licence
	// allows two besides the Mac's own macOS.
	MostVMs = 2
	// VCPUs is a job VM's size, which is what a hive-macos job is billed as.
	VCPUs = 4
	// ShareTag is the virtio-fs tag the guest agent mounts.
	ShareTag = "hive"
	// DigestFile is the image's digest in the share, which the guest agent
	// gives the job as HIVE_IMAGE_DIGEST.
	DigestFile = "image-digest"
	// runnerShared is GitHub's runner in the share, which the guest agent
	// unpacks onto the VM's own disk.
	runnerShared = "runner.tar.gz"
)

// ReasonStaleRunner is why a Mac declines macOS jobs once GitHub has refused
// the runner it hands its VMs as too old.
const ReasonStaleRunner = "the runner this Mac gives its macOS VMs is too old for GitHub; update hived and run hived macos image seal"

// How long a VM has to boot and log in before the job is given up on, and
// how long the guest has to power off once it has reported. Variables so
// the tests need not wait.
var (
	bootTimeout   = 5 * time.Minute
	powerOffGrace = 30 * time.Second
	stopGrace     = 5 * time.Second
	poll          = time.Second
)

// Memory is what a job's VM is given on a host with this much: as much as a
// Linux VM of the same size.
func Memory(hostBytes uint64) uint64 { return vm.GuestMemoryBytes(VCPUs, hostBytes) }

// Runner implements jobs.Runner for hive-macos jobs, each in a VM of its
// own. It is built once and asked often; readiness is checked at most once
// a minute.
type Runner struct {
	// Dir is the image. WorkDir holds each job's clone while it runs, and
	// must be on the same volume, so a clone takes no room until written.
	Dir     string
	WorkDir string
	Log     *slog.Logger

	mu sync.Mutex
	// slots are the VMs running, by network identity.
	slots [MostVMs]bool
	// claimed is whether WorkDir is this process's and has been swept, and
	// unclaim gives it up. Kept, so the lock's file is never collected.
	claimed bool
	unclaim func()
	checked time.Time
	problem string
	stale   atomic.Bool
	// launch and clone stand in for the host's own in tests.
	launch func(*instance) error
	clone  func(from, to string) error
}

var _ jobs.Runner = (*Runner)(nil)
var _ jobs.Unusable = (*Runner)(nil)

// ErrFull means MostVMs are already running. The pool is told the limit,
// so an offer past it is declined before it gets here.
var ErrFull = errors.New("this Mac is already running as many macOS VMs as Apple's licence allows")

// Ready reports whether a job could start now.
func (r *Runner) Ready() bool { return r.Unusable() == "" }

// Unusable implements jobs.Unusable.
func (r *Runner) Unusable() string {
	if r.stale.Load() {
		return ReasonStaleRunner
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.checked.IsZero() || time.Since(r.checked) > time.Minute {
		r.problem = r.inspect()
		r.checked = time.Now()
	}
	return r.problem
}

// Status checks now and says what it found.
func (r *Runner) Status() (Image, string) {
	image, err := Load(r.Dir)
	if err != nil {
		return image, err.Error()
	}
	return image, r.inspect()
}

func (r *Runner) inspect() string {
	if problem := platformProblem(); problem != "" {
		return problem
	}
	image, err := Load(r.Dir)
	if err != nil {
		return err.Error()
	}
	return image.Problem()
}

// instance is one job's VM and everything on the host that belongs to it.
type instance struct {
	dir   string
	share string
	// The clones, and the image's hardware model, which is not cloned:
	// nothing writes it.
	disk, auxiliary, hardwareModel string
	mac                            net.HardwareAddr
	vcpus                          int
	// ended is closed, by end, when the VM stops; failure says whether it
	// stopped any way but powering itself off, and is written before.
	ended   chan struct{}
	ending  sync.Once
	failure error
	// stop pulls the plug. It is safe to call more than once, and on a VM
	// that has already stopped.
	stop func()
}

// end says the VM has stopped. It may be said more than once.
func (guest *instance) end() { guest.ending.Do(func() { close(guest.ended) }) }

func (guest *instance) alive() bool {
	select {
	case <-guest.ended:
		return false
	default:
		return true
	}
}

// Run implements jobs.Runner: a clone of the image, booted, handed the job,
// waited for, stopped and deleted. Run returns only once the clone is gone.
func (r *Runner) Run(ctx context.Context, job jobs.Job) (jobs.Result, error) {
	started := time.Now()
	slot, err := r.take()
	if err != nil {
		return jobs.Result{ExitCode: -1}, err
	}
	defer r.give(slot)
	image, err := Load(r.Dir)
	if err == nil {
		if problem := image.Problem(); problem != "" {
			err = errors.New(problem)
		}
	}
	if err != nil {
		return jobs.Result{ExitCode: -1}, err
	}
	guest, err := r.prepare(image, job, slot)
	if err != nil {
		return jobs.Result{ExitCode: -1}, err
	}
	// Whatever happens: the VM stops and its clone, share and credential go.
	defer func() {
		if err := guest.destroy(); err != nil {
			r.Log.Error("could not delete a macOS VM's clone; the next start of hived will", "job", job.AssignmentID, "error", err)
			return
		}
		r.Log.Info("macOS VM deleted", "job", job.AssignmentID, "image", image.Digest)
	}()
	launch := r.launch
	if launch == nil {
		launch = start
	}
	if err := launch(guest); err != nil {
		// Nothing to wait for: a VM that did not start is not running.
		guest.end()
		return jobs.Result{ExitCode: -1}, fmt.Errorf("start the macOS VM: %w", err)
	}
	r.Log.Info("macOS VM has the job", "job", job.AssignmentID, "image", image.Digest, "vcpus", guest.vcpus)

	err = guest.wait(ctx)
	code, hasExit := readExit(guest.share)
	if !hasExit && err == nil {
		err = errors.New("the macOS VM stopped without reporting a result")
	}
	if code == native.ExitRunnerDeprecated && err == nil {
		r.stale.Store(true)
		r.Log.Error("GitHub refused the macOS VMs' runner as too old; macOS jobs are declined until hived is updated", "runner", native.RunnerVersion)
	}
	r.Log.Info("macOS job ended", "job", job.AssignmentID, "exit", code, "seconds", int(time.Since(started).Seconds()))
	return jobs.Result{ExitCode: code}, err
}

// take reserves one of the VMs. The first one this process runs also makes
// the work directory its own and clears what a daemon that died left there.
func (r *Runner) take() (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.claimed {
		// Never given back: the kernel drops it when the process ends.
		release, err := vm.LockWorkDir(r.WorkDir)
		if err != nil {
			return -1, err
		}
		r.unclaim = release
		if swept, err := vm.SweepWorkDir(r.WorkDir); err != nil {
			return -1, err
		} else if swept > 0 {
			r.Log.Info("cleared the macOS VMs a previous run left behind", "directories", swept)
		}
		r.claimed = true
	}
	for slot, used := range r.slots {
		if !used {
			r.slots[slot] = true
			return slot, nil
		}
	}
	return -1, ErrFull
}

func (r *Runner) give(slot int) {
	r.mu.Lock()
	r.slots[slot] = false
	r.mu.Unlock()
}

// prepare makes the job's directory: clones of the image's disk and
// auxiliary storage, and the share, with everything the guest needs in it.
// The job file goes last and appears whole, so the guest never reads half.
func (r *Runner) prepare(image Image, job jobs.Job, slot int) (*instance, error) {
	dir, err := os.MkdirTemp(r.WorkDir, "job-")
	if err != nil {
		return nil, err
	}
	vcpus := job.VCPUs
	if vcpus < 1 {
		vcpus = VCPUs
	}
	guest := &instance{
		dir:           dir,
		share:         filepath.Join(dir, "share"),
		disk:          filepath.Join(dir, DiskFile),
		auxiliary:     filepath.Join(dir, AuxiliaryFile),
		hardwareModel: image.path(HardwareModelFile),
		mac:           mac(r.WorkDir, slot),
		vcpus:         vcpus,
		ended:         make(chan struct{}),
		stop:          func() {},
	}
	fail := func(err error) (*instance, error) {
		os.RemoveAll(dir)
		return nil, err
	}
	// The whole of what the guest can see of the host.
	if err := os.Mkdir(guest.share, 0o700); err != nil {
		return fail(err)
	}
	clone := r.clone
	if clone == nil {
		clone = cloneFile
	}
	release, err := lockImage(image.Dir, false)
	if err != nil {
		return fail(err)
	}
	for from, to := range map[string]string{
		image.path(DiskFile):      guest.disk,
		image.path(AuxiliaryFile): guest.auxiliary,
		image.RunnerPath():        filepath.Join(guest.share, runnerShared),
	} {
		if err := clone(from, to); err != nil {
			release()
			return fail(fmt.Errorf("clone %s: %w", filepath.Base(from), err))
		}
	}
	release()
	extras := map[string]string{"host": hostName(), DigestFile: image.Digest}
	if job.Label != "" {
		extras["label"] = job.Label
	}
	for name, value := range extras {
		if err := os.WriteFile(filepath.Join(guest.share, name), []byte(value), 0o600); err != nil {
			return fail(err)
		}
	}
	temporary := filepath.Join(dir, "jitconfig.tmp")
	if err := os.WriteFile(temporary, []byte(job.JITConfig), 0o600); err != nil {
		return fail(err)
	}
	if err := os.Rename(temporary, filepath.Join(guest.share, "jitconfig")); err != nil {
		return fail(err)
	}
	return guest, nil
}

// wait returns when the VM has stopped, when the guest has reported and
// had its moment to power off, or when ctx ends, which stops the VM. A VM
// whose agent has not said it is ready within bootTimeout is stopped too:
// an image that does not boot, or has no agent, would otherwise hold the
// job until its timeout.
func (guest *instance) wait(ctx context.Context) error {
	booted := time.Now()
	tick := time.NewTicker(poll)
	defer tick.Stop()
	for {
		select {
		case <-guest.ended:
			return guest.failure
		case <-ctx.Done():
			_ = os.WriteFile(filepath.Join(guest.share, "stop-reason"), []byte(stopReason(ctx)+"\n"), 0o600)
			select {
			case <-guest.ended:
			case <-time.After(stopGrace):
			}
			return ctx.Err()
		case <-tick.C:
		}
		if exists(filepath.Join(guest.share, "exit")) {
			select {
			case <-guest.ended:
			case <-time.After(powerOffGrace):
			}
			return nil
		}
		if !exists(filepath.Join(guest.share, "ready")) && time.Since(booted) > bootTimeout {
			return errors.New("the macOS VM did not start its agent; check the image with hived macos image open")
		}
	}
}

func stopReason(ctx context.Context) string {
	cause := context.Cause(ctx)
	switch {
	case errors.Is(cause, jobs.ErrTimeout) || errors.Is(ctx.Err(), context.DeadlineExceeded):
		return jobs.ReasonTimeout
	case errors.Is(cause, jobs.ErrReleased):
		return jobs.ReasonReleased
	}
	return jobs.ReasonDaemonShutdown
}

// destroy stops the VM if it is still running and deletes its files.
func (guest *instance) destroy() error {
	if guest.alive() {
		guest.stop()
		select {
		case <-guest.ended:
		case <-time.After(15 * time.Second):
		}
	}
	return os.RemoveAll(guest.dir)
}

// mac is a VM's network identity. The host's network remembers each card it
// has seen for a while, so each slot keeps one, derived from the work
// directory so that two daemons on one Mac do not share them.
func mac(workDir string, slot int) net.HardwareAddr {
	seed := sha256.Sum256([]byte(workDir + "\x00macos"))
	// 0x02: locally administered, unicast.
	return net.HardwareAddr{0x02, 0x6d, seed[0], seed[1], seed[2], seed[3]&0xf0 | byte(slot)}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func readExit(share string) (int, bool) {
	raw, err := os.ReadFile(filepath.Join(share, "exit"))
	if err != nil {
		return -1, false
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		return -1, false
	}
	return parsed, true
}

func hostName() string {
	name, err := os.Hostname()
	if err != nil || name == "" {
		return "this machine"
	}
	return name
}
