package update

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// The daemon's own update must never take a machine's job away: it stops
// new ones and waits for the ones in hand before it runs the installer.
func TestTheDaemonUpdatesItselfOnlyOnceItHasNoJob(t *testing.T) {
	t.Setenv("HIVE_CONFIG", filepath.Join(t.TempDir(), "machine.json"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"version":"9.9.9","commit":"abc","image":{"version":"1-2.0.0"}}`))
	}))
	defer server.Close()
	t.Setenv("HIVE_RELEASES", server.URL)

	// Told already, so that the test does not put a notice on the screen.
	if err := SaveState(State{Notified: "9.9.9"}); err != nil {
		t.Fatal(err)
	}
	var busy, updating atomic.Bool
	var applied atomic.Int32
	busy.Store(true)
	options := Options{
		Version:    "9.9.8",
		Log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		AutoUpdate: func() bool { return true },
		Busy:       busy.Load,
		Updating:   &updating,
		installed:  func() bool { return true },
		poll:       5 * time.Millisecond,
		apply: func(context.Context) error {
			if busy.Load() {
				t.Error("the installer was run while a job was running")
			}
			if !updating.Load() {
				t.Error("the installer was run while the machine could still be offered a job")
			}
			applied.Add(1)
			return nil
		},
	}
	done := make(chan struct{})
	go func() { tick(context.Background(), options); close(done) }()

	// A job is running: no new ones, and no installer.
	time.Sleep(80 * time.Millisecond)
	if applied.Load() != 0 {
		t.Fatal("updated under a running job")
	}
	if !updating.Load() {
		t.Fatal("still open to new jobs while waiting to update")
	}
	// It ends, and the update goes ahead.
	busy.Store(false)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("never updated once the machine was idle")
	}
	if applied.Load() != 1 {
		t.Fatalf("the installer ran %d times", applied.Load())
	}
}

func TestTheDaemonLeavesItselfAloneWhenItIsCurrentOrToldTo(t *testing.T) {
	t.Setenv("HIVE_CONFIG", filepath.Join(t.TempDir(), "machine.json"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"version":"9.9.9","commit":"abc","image":{"version":"1-2.0.0"}}`))
	}))
	defer server.Close()
	t.Setenv("HIVE_RELEASES", server.URL)
	for _, test := range []struct {
		name, version string
		auto          bool
	}{
		{"already the release", "9.9.9", true},
		{"newer than the release", "9.10.0", true},
		{"its owner updates by hand", "9.9.8", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := SaveState(State{Notified: "9.9.9"}); err != nil {
				t.Fatal(err)
			}
			var updating atomic.Bool
			tick(context.Background(), Options{
				Version: test.version, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
				AutoUpdate: func() bool { return test.auto }, Busy: func() bool { return false },
				Updating: &updating, installed: func() bool { return true }, poll: time.Millisecond,
				apply: func(context.Context) error { t.Error("the installer was run"); return nil },
			})
			if updating.Load() {
				t.Error("stopped taking jobs for an update that is not happening")
			}
		})
	}
}
