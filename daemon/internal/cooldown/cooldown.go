// Package cooldown makes a machine lend less for a while after the host
// itself killed a job's VM. A kernel OOM kill means the machine ran short of
// memory at the load it was given; admitting the same load again at once
// repeats it, so the daemon steps down to one job, or none if it was already
// at one, and doubles the wait each time it happens again.
package cooldown

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/config"
)

const (
	// First is the wait after the first kill.
	First = 15 * time.Minute
	// Longest caps the doubling.
	Longest = 4 * time.Hour
	// Forget is how long a machine must go without a kill before the next
	// one counts as the first again, measured from the end of the last wait.
	Forget = 24 * time.Hour
)

// State is what is remembered between daemon runs.
type State struct {
	// Strikes is how many host kills in a row, each within Forget of the
	// last wait ending.
	Strikes int `json:"strikes"`
	// Until is when the current wait ends.
	Until time.Time `json:"until"`
	// Counted is when the host's last kill that counted was seen. One
	// out-of-memory event stops several jobs, each reporting host_killed,
	// and is still one strike.
	Counted time.Time `json:"counted"`
}

// Active reports whether a wait is in force at now.
func (s State) Active(now time.Time) bool {
	return s.Strikes > 0 && now.Before(s.Until)
}

// Wait is how long the nth strike lasts.
func Wait(strikes int) time.Duration {
	wait := First
	for i := 1; i < strikes && wait < Longest; i++ {
		wait *= 2
	}
	return min(wait, Longest)
}

// Hit returns the state after a host kill seen at now, and whether it counted.
// kill is when the host's kill happened, from the marker the VM runner leaves
// (zero if unknown). A kill no later than the last one counted is the same
// event reported again, by a sibling job or a restarted daemon, and changes
// nothing.
func (s State) Hit(now, kill time.Time) (State, bool) {
	if !kill.IsZero() && !kill.After(s.Counted) {
		return s, false
	}
	if kill.IsZero() {
		kill = now
	}
	strikes := s.Strikes + 1
	if s.Strikes == 0 || now.After(s.Until.Add(Forget)) {
		strikes = 1
	}
	return State{Strikes: strikes, Until: now.Add(Wait(strikes)), Counted: kill}, true
}

// Path is the cooldown file, beside the settings file.
func Path() (string, error) {
	machine, err := config.Path()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(machine), "cooldown.json"), nil
}

// Load reads the cooldown file. No file, or one that cannot be read, is no
// cooldown: a damaged file must not stop a machine lending.
func Load() State {
	path, err := Path()
	if err != nil {
		return State{}
	}
	return read(path)
}

func read(path string) State {
	var s State
	raw, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(raw, &s) != nil {
		return State{}
	}
	return s
}

func save(path string, s State) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

// Tracker is the running daemon's copy, kept in step with the file.
type Tracker struct {
	path string

	mu    sync.Mutex
	state State
}

// Watch loads what an earlier run left.
func Watch() *Tracker {
	path, err := Path()
	if err != nil {
		return &Tracker{}
	}
	return &Tracker{path: path, state: read(path)}
}

// Get is the current state.
func (t *Tracker) Get() State {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.state
}

// Hit records a host kill and saves it; see State.Hit. The state is kept in
// memory even when it cannot be saved, and the error says so.
func (t *Tracker) Hit(now, kill time.Time) (State, bool, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	next, counted := t.state.Hit(now, kill)
	if !counted {
		return t.state, false, nil
	}
	t.state = next
	if t.path == "" {
		return t.state, true, errors.New("no place to keep the cooldown")
	}
	return t.state, true, save(t.path, t.state)
}

// Cap is how many jobs a machine may run at now when its owner allows
// maxJobs: unchanged outside a wait, one during it, and none if one was all
// it was allowed already, since the job the host killed was that one.
func (s State) Cap(now time.Time, maxJobs int) (jobs int, hold bool) {
	if !s.Active(now) {
		return maxJobs, false
	}
	if maxJobs <= 1 {
		return 1, true
	}
	return 1, false
}
