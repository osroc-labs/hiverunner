package macvm

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/jobs"
	"github.com/thecomputerplumbers/hiverunner/daemon/internal/native"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func init() {
	bootTimeout = 300 * time.Millisecond
	powerOffGrace = 200 * time.Millisecond
	stopGrace = 50 * time.Millisecond
	poll = 10 * time.Millisecond
}

// newImage is an image as Create leaves one: not sealed, no runner beside it.
func newImage(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "macos-image")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		HardwareModelFile: "model",
		AuxiliaryFile:     "aux",
		DiskFile:          "disk",
		IdentifierFile:    "identifier",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := (Image{Dir: dir, MacOS: "26.0 (25A354)", Created: time.Now()}).save(); err != nil {
		t.Fatal(err)
	}
	return dir
}

// fetch stands in for GitHub: it writes a runner where the real one goes.
func fetch(dir string) (string, error) {
	path := filepath.Join(dir, native.RunnerFile)
	return path, os.WriteFile(path, []byte("runner"), 0o644)
}

func sealedImage(t *testing.T) string {
	t.Helper()
	dir := newImage(t)
	if _, err := Seal(dir, fetch, io.Discard); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAnImageRunsJobsOnlyOnceSealed(t *testing.T) {
	dir := newImage(t)
	image, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if problem := image.Problem(); !strings.Contains(problem, "not sealed") {
		t.Fatalf("a new image: %q", problem)
	}
	var said strings.Builder
	sealed, err := Seal(dir, fetch, &said)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(sealed.Digest, "sha256:") || sealed.Problem() != "" {
		t.Fatalf("sealed: digest %q, problem %q", sealed.Digest, sealed.Problem())
	}
	if !strings.Contains(said.String(), "digest") || !strings.Contains(said.String(), native.RunnerVersion) {
		t.Errorf("Seal said %q", said.String())
	}
	loaded, err := Load(dir)
	if err != nil || loaded.Digest != sealed.Digest || loaded.Problem() != "" {
		t.Fatalf("read back: %+v %v", loaded, err)
	}

	// Sealing an unchanged image again neither reads it nor fetches again.
	said.Reset()
	again, err := Seal(dir, func(string) (string, error) { return "", errors.New("fetched again") }, &said)
	if err != nil || again.Digest != sealed.Digest || said.Len() != 0 {
		t.Fatalf("sealed again: %q %v, said %q", again.Digest, err, said.String())
	}
}

func TestAnImageChangedSinceItWasSealedIsRefused(t *testing.T) {
	dir := sealedImage(t)
	before, _ := Load(dir)
	if err := os.WriteFile(filepath.Join(dir, DiskFile), []byte("disk, with Xcode on it"), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if problem := changed.Problem(); !strings.Contains(problem, "changed since it was sealed") {
		t.Fatalf("a changed disk: %q", problem)
	}
	after, err := Seal(dir, fetch, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if after.Digest == before.Digest || after.Problem() != "" {
		t.Fatalf("resealed: %q (was %q), problem %q", after.Digest, before.Digest, after.Problem())
	}
}

func TestAnImageWithoutItsRunnerIsRefused(t *testing.T) {
	dir := sealedImage(t)
	if err := os.Remove(filepath.Join(dir, native.RunnerFile)); err != nil {
		t.Fatal(err)
	}
	image, _ := Load(dir)
	if problem := image.Problem(); !strings.Contains(problem, native.RunnerVersion) {
		t.Fatalf("no runner: %q", problem)
	}
}

func TestNoImageSaysHowToMakeOne(t *testing.T) {
	if _, err := Load(filepath.Join(t.TempDir(), "macos-image")); !errors.Is(err, ErrNoImage) {
		t.Fatalf("Load() = %v, want ErrNoImage", err)
	}
}

// An image that is open is not sealed, removed or cloned from under it.
func TestAnOpenImageIsLeftAlone(t *testing.T) {
	dir := sealedImage(t)
	release, err := lockImage(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Seal(dir, fetch, io.Discard); !errors.Is(err, ErrImageInUse) {
		t.Errorf("Seal() = %v, want in use", err)
	}
	if err := Remove(dir); !errors.Is(err, ErrImageInUse) {
		t.Errorf("Remove() = %v, want in use", err)
	}
	r := newRunner(t, dir, func(*instance) error { t.Error("a VM booted from an open image"); return nil })
	if _, err := r.Run(context.Background(), job("a-1")); !errors.Is(err, ErrImageInUse) {
		t.Errorf("Run() = %v, want in use", err)
	}
	release()
	if err := Remove(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("the image is still there")
	}
}

func copyFile(from, to string) error {
	raw, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, raw, 0o600)
}

func newRunner(t *testing.T, image string, launch func(*instance) error) *Runner {
	t.Helper()
	return &Runner{Dir: image, WorkDir: image + "-jobs", Log: quiet, launch: launch, clone: copyFile}
}

func job(id string) jobs.Job {
	return jobs.Job{AssignmentID: id, Kind: "macos", Pool: "acme", JITConfig: "jit-" + id, VCPUs: 4, Label: "hive-macos"}
}

// guest plays the agent: it reads what it was given, says it is ready and
// reports code, then powers off.
func guest(t *testing.T, code string, seen *map[string]string) func(*instance) error {
	return func(vm *instance) error {
		got := map[string]string{}
		for _, name := range []string{"jitconfig", DigestFile, runnerShared, "label"} {
			raw, err := os.ReadFile(filepath.Join(vm.share, name))
			if err != nil {
				t.Errorf("the share has no %s", name)
			}
			got[name] = string(raw)
		}
		for _, clone := range []string{vm.disk, vm.auxiliary} {
			if _, err := os.Stat(clone); err != nil {
				t.Errorf("no clone at %s", clone)
			}
		}
		*seen = got
		go func() {
			_ = os.WriteFile(filepath.Join(vm.share, "ready"), nil, 0o600)
			_ = os.WriteFile(filepath.Join(vm.share, "exit"), []byte(code+"\n"), 0o600)
			vm.end()
		}()
		return nil
	}
}

func jobDirs(t *testing.T, r *Runner) []string {
	t.Helper()
	found, _ := filepath.Glob(filepath.Join(r.WorkDir, "job-*"))
	return found
}

func TestAJobRunsInAClonedVMThatIsThenDeleted(t *testing.T) {
	dir := sealedImage(t)
	image, _ := Load(dir)
	var seen map[string]string
	r := newRunner(t, dir, guest(t, "0", &seen))
	result, err := r.Run(context.Background(), job("a-1"))
	if err != nil || result.ExitCode != 0 {
		t.Fatalf("Run() = %+v, %v", result, err)
	}
	if seen["jitconfig"] != "jit-a-1" || seen[DigestFile] != image.Digest || seen[runnerShared] != "runner" || seen["label"] != "hive-macos" {
		t.Fatalf("the guest was given %v", seen)
	}
	if left := jobDirs(t, r); len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}
	// The image itself is as it was.
	if after, _ := Load(dir); after.Problem() != "" {
		t.Fatalf("the image after a job: %q", after.Problem())
	}
}

func TestAFailedJobIsDeletedToo(t *testing.T) {
	var seen map[string]string
	r := newRunner(t, sealedImage(t), guest(t, "1", &seen))
	result, err := r.Run(context.Background(), job("a-1"))
	if err != nil || result.ExitCode != 1 {
		t.Fatalf("Run() = %+v, %v", result, err)
	}
	if left := jobDirs(t, r); len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}
}

func TestAVMThatWillNotStartLeavesNothing(t *testing.T) {
	r := newRunner(t, sealedImage(t), func(*instance) error { return errors.New("no hypervisor") })
	if _, err := r.Run(context.Background(), job("a-1")); err == nil || !strings.Contains(err.Error(), "no hypervisor") {
		t.Fatalf("Run() = %v", err)
	}
	if left := jobDirs(t, r); len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}
}

// running is a guest that boots and never finishes its job, and counts the
// times its plug is pulled.
func running(stops *atomic.Int32, ready bool) func(*instance) error {
	return func(vm *instance) error {
		if ready {
			_ = os.WriteFile(filepath.Join(vm.share, "ready"), nil, 0o600)
		}
		vm.stop = func() {
			if stops.Add(1) == 1 {
				vm.end()
			}
		}
		return nil
	}
}

func TestACancelledJobStopsItsVM(t *testing.T) {
	var stops atomic.Int32
	r := newRunner(t, sealedImage(t), running(&stops, true))
	ctx, cancel := context.WithCancelCause(context.Background())
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel(jobs.ErrTimeout)
	}()
	result, err := r.Run(ctx, job("a-1"))
	if !errors.Is(err, context.Canceled) || result.ExitCode != -1 {
		t.Fatalf("Run() = %+v, %v", result, err)
	}
	if stops.Load() == 0 {
		t.Fatal("the VM was never stopped")
	}
	if left := jobDirs(t, r); len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}
}

// An image with no agent, or one that does not boot, gives the job up
// rather than holding it until its timeout.
func TestAGuestThatNeverSaysItIsReadyIsStopped(t *testing.T) {
	var stops atomic.Int32
	r := newRunner(t, sealedImage(t), running(&stops, false))
	_, err := r.Run(context.Background(), job("a-1"))
	if err == nil || !strings.Contains(err.Error(), "did not start its agent") {
		t.Fatalf("Run() = %v", err)
	}
	if stops.Load() == 0 {
		t.Fatal("the VM was never stopped")
	}
	if left := jobDirs(t, r); len(left) != 0 {
		t.Fatalf("left behind: %v", left)
	}
}

func TestAnUnsealedImageRunsNothing(t *testing.T) {
	r := newRunner(t, newImage(t), func(*instance) error { t.Error("a VM booted"); return nil })
	if _, err := r.Run(context.Background(), job("a-1")); err == nil || !strings.Contains(err.Error(), "not sealed") {
		t.Fatalf("Run() = %v", err)
	}
}

// Two VMs at most, whatever else asks: Apple's licence.
func TestAThirdVMIsRefused(t *testing.T) {
	booted := make(chan *instance, MostVMs)
	r := newRunner(t, sealedImage(t), func(vm *instance) error {
		_ = os.WriteFile(filepath.Join(vm.share, "ready"), nil, 0o600)
		vm.stop = func() {}
		booted <- vm
		return nil
	})
	done := make(chan error, MostVMs)
	for i := range MostVMs {
		go func() {
			_, err := r.Run(context.Background(), job("a-"+string(rune('1'+i))))
			done <- err
		}()
	}
	var vms []*instance
	for range MostVMs {
		select {
		case vm := <-booted:
			vms = append(vms, vm)
		case <-time.After(3 * time.Second):
			t.Fatal("a VM never booted")
		}
	}
	if vms[0].mac.String() == vms[1].mac.String() {
		t.Errorf("two VMs share the network identity %s", vms[0].mac)
	}
	if _, err := r.Run(context.Background(), job("a-3")); !errors.Is(err, ErrFull) {
		t.Fatalf("a third VM: %v, want ErrFull", err)
	}
	for _, vm := range vms {
		_ = os.WriteFile(filepath.Join(vm.share, "exit"), []byte("0"), 0o600)
		vm.end()
	}
	for range MostVMs {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	var seen map[string]string
	r.launch = guest(t, "0", &seen)
	if _, err := r.Run(context.Background(), job("a-3")); err != nil {
		t.Fatalf("once the others are gone: %v", err)
	}
}

// A daemon that was killed leaves its VMs' clones; the next one clears them
// before it runs anything.
func TestWhatAKilledDaemonLeftIsCleared(t *testing.T) {
	var seen map[string]string
	r := newRunner(t, sealedImage(t), guest(t, "0", &seen))
	left := filepath.Join(r.WorkDir, "job-1234")
	if err := os.MkdirAll(filepath.Join(left, "share"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(left, "share", "jitconfig"), []byte("a credential"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Run(context.Background(), job("a-1")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(left); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("a previous run's VM is still there")
	}
}

func TestARunnerGitHubRefusesDeclinesFromThenOn(t *testing.T) {
	var seen map[string]string
	r := newRunner(t, sealedImage(t), guest(t, "7", &seen))
	if _, err := r.Run(context.Background(), job("a-1")); err != nil {
		t.Fatal(err)
	}
	if got := r.Unusable(); got != ReasonStaleRunner {
		t.Fatalf("Unusable() = %q, want %q", got, ReasonStaleRunner)
	}
}

func TestTheGuestsFilesAreWhatTheOwnerInstalls(t *testing.T) {
	dir := t.TempDir()
	if err := WriteGuestFiles(dir); err != nil {
		t.Fatal(err)
	}
	for name, executable := range map[string]bool{"hive-agent": true, "install.sh": true, "dev.hiverunner.agent.plist": false} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			t.Fatalf("no %s: %v", name, err)
		}
		if got := info.Mode()&0o100 != 0; got != executable {
			t.Errorf("%s executable = %v", name, got)
		}
	}
	agent, _ := os.ReadFile(filepath.Join(dir, "hive-agent"))
	for _, want := range []string{"mount_virtiofs " + ShareTag, DigestFile, "HIVE_IMAGE_DIGEST", runnerShared, "--jitconfig"} {
		if !strings.Contains(string(agent), want) {
			t.Errorf("the agent does not mention %q", want)
		}
	}
}

func TestSealingNoImageSaysHowToMakeOne(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "macos-image")
	if _, err := Seal(missing, fetch, io.Discard); !errors.Is(err, ErrNoImage) {
		t.Fatalf("Seal() = %v, want ErrNoImage", err)
	}
	if err := Remove(missing); err != nil {
		t.Fatalf("Remove() = %v", err)
	}
}
