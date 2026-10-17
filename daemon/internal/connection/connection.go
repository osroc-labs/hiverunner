// Package connection remembers, for the owner to read, whether the daemon is
// connected to each hive it serves and since when. The daemon writes it as
// that changes; hived status and hived doctor read it. Without it a machine
// that cannot reach its hives says so only in its log.
package connection

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/config"
)

// Hive is one hive's tunnel as the daemon last knew it.
type Hive struct {
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
	// Since is when it became connected, or stopped being.
	Since time.Time `json:"since"`
	// Error is why the last attempt failed, in Go's words. Empty when
	// connected.
	Error string `json:"error,omitempty"`
}

// State is every hive the daemon is serving, by name.
type State struct {
	Hives []Hive `json:"hives"`
	// Unusable is why the daemon found it cannot run a VM, the last time it
	// looked; empty if it can. It is the service's answer, which can differ
	// from what the owner's own shell is allowed: a group added after the
	// user's services started is the usual reason.
	Unusable string `json:"unusable,omitempty"`
	// WrittenBy is the daemon's process, so a reader can tell a file left
	// by one that is gone from what a running one is saying.
	WrittenBy int `json:"writtenBy"`
}

func path() (string, error) {
	machine, err := config.Path()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(machine), "connection.json"), nil
}

// Load reads what the daemon last wrote; nothing written is not an error.
func Load() (State, error) {
	file, err := path()
	if err != nil {
		return State{}, err
	}
	raw, err := os.ReadFile(file)
	if errors.Is(err, os.ErrNotExist) {
		return State{}, nil
	}
	if err != nil {
		return State{}, err
	}
	var state State
	if json.Unmarshal(raw, &state) != nil {
		return State{}, nil
	}
	return state, nil
}

// Live reports whether the daemon that wrote this is still running. One that
// is gone left the file saying what was true when it stopped.
func (s State) Live() bool {
	return s.WrittenBy > 0 && syscall.Kill(s.WrittenBy, 0) == nil
}

// Recorder is the daemon's side: it is told as tunnels connect and drop, and
// keeps the file in step. Its methods are safe to call from every tunnel.
type Recorder struct {
	mu       sync.Mutex
	hives    map[string]Hive
	unusable string
	// Now and Save are replaced in tests.
	Now  func() time.Time
	Save func(State) error
}

func NewRecorder() *Recorder {
	return &Recorder{hives: map[string]Hive{}, Now: time.Now, Save: save}
}

// Set records one hive's tunnel. A failure that follows a failure keeps the
// time the outage began, and is written only if its reason changed: a
// machine offline for a day retries thousands of times and has one thing
// to say.
func (r *Recorder) Set(name string, connected bool, cause error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	next := Hive{Name: name, Connected: connected, Since: r.Now()}
	if !connected && cause != nil {
		next.Error = cause.Error()
	}
	if last, known := r.hives[name]; known && last.Connected == connected {
		if Reason(last.Error) == Reason(next.Error) {
			return
		}
		next.Since = last.Since
	}
	r.hives[name] = next
	r.write()
}

// Unusable records why the daemon cannot run a VM, or "" once it can.
func (r *Recorder) Unusable(reason string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.unusable == reason {
		return
	}
	r.unusable = reason
	r.write()
}

// Forget drops a hive the machine no longer serves.
func (r *Recorder) Forget(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, known := r.hives[name]; !known {
		return
	}
	delete(r.hives, name)
	r.write()
}

func (r *Recorder) write() {
	state := State{Unusable: r.unusable, WrittenBy: os.Getpid()}
	for _, hive := range r.hives {
		state.Hives = append(state.Hives, hive)
	}
	sort.Slice(state.Hives, func(i, j int) bool { return state.Hives[i].Name < state.Hives[j].Name })
	// Best effort: this is for a person to read, and the log says it too.
	_ = r.Save(state)
}

func save(state State) error {
	file, err := path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	temporary := file + ".tmp"
	if err := os.WriteFile(temporary, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, file)
}

// Reason is a network failure in a few words an owner can act on. Go's own
// text names ports and addresses that differ on every attempt; what is kept
// is what stays true across them.
func Reason(text string) string {
	switch {
	case text == "":
		return ""
	case strings.Contains(text, "no such host"), strings.Contains(text, "server misbehaving"), strings.Contains(text, "lookup ") && strings.Contains(text, "i/o timeout"):
		return "DNS lookup failed"
	case strings.Contains(text, "network is unreachable"), strings.Contains(text, "no route to host"):
		return "no network"
	case strings.Contains(text, "connection refused"):
		return "the server refused the connection"
	case strings.Contains(text, "certificate"), strings.Contains(text, "tls:"):
		return "the secure connection failed"
	case strings.Contains(text, "i/o timeout"), strings.Contains(text, "deadline exceeded"), strings.Contains(text, "timed out"):
		return "the server did not answer"
	case strings.Contains(text, "connection reset"), strings.Contains(text, "EOF"), strings.Contains(text, "broken pipe"):
		return "the connection dropped"
	}
	return "the connection failed"
}

// Quiet decides whether a failure that keeps happening is worth another log
// line: the first is, and after that one every Every, with how many were
// not said. Reset it when the thing works again.
type Quiet struct {
	Every   time.Duration
	said    time.Time
	skipped int
}

// Say reports whether to log now, and how many failures went unsaid since
// the last line.
func (q *Quiet) Say(now time.Time) (bool, int) {
	if q.said.IsZero() || now.Sub(q.said) >= q.Every {
		skipped := q.skipped
		q.said, q.skipped = now, 0
		return true, skipped
	}
	q.skipped++
	return false, 0
}

func (q *Quiet) Reset() { q.said, q.skipped = time.Time{}, 0 }
