package cooldown

import (
	"path/filepath"
	"testing"
	"time"
)

// hit is a kill seen the moment it happened.
func hit(s State, at time.Time) State {
	next, _ := s.Hit(at, at)
	return next
}

var start = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

func TestWaitDoublesAndStops(t *testing.T) {
	for strikes, want := range map[int]time.Duration{
		1: 15 * time.Minute, 2: 30 * time.Minute, 3: time.Hour, 4: 2 * time.Hour, 5: 4 * time.Hour, 9: 4 * time.Hour,
	} {
		if got := Wait(strikes); got != want {
			t.Errorf("strike %d: waited %s, want %s", strikes, got, want)
		}
	}
}

func TestRepeatedKillsDouble(t *testing.T) {
	s := hit(State{}, start)
	if s.Strikes != 1 || !s.Active(start.Add(14*time.Minute)) || s.Active(start.Add(15*time.Minute)) {
		t.Fatalf("first strike: %+v", s)
	}
	s = hit(s, start.Add(20*time.Minute))
	if s.Strikes != 2 || !s.Until.Equal(start.Add(50*time.Minute)) {
		t.Fatalf("second strike: %+v", s)
	}
}

func TestAKillLongAfterIsTheFirstAgain(t *testing.T) {
	s := hit(hit(State{}, start), start.Add(time.Minute))
	s = hit(s, s.Until.Add(Forget+time.Minute))
	if s.Strikes != 1 {
		t.Fatalf("strikes = %d, want 1", s.Strikes)
	}
}

func TestSurvivesARestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cooldown.json")
	first := &Tracker{path: path}
	if _, _, err := first.Hit(start, start); err != nil {
		t.Fatal(err)
	}
	again := &Tracker{path: path, state: read(path)}
	if !again.Get().Active(start.Add(time.Minute)) || again.Get().Strikes != 1 {
		t.Fatalf("after a restart: %+v", again.Get())
	}
}

func TestUnreadableFileIsNoCooldown(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cooldown.json")
	if err := save(path, State{Strikes: 2, Until: start}); err != nil {
		t.Fatal(err)
	}
	if got := read(filepath.Join(t.TempDir(), "none.json")); got.Strikes != 0 {
		t.Fatalf("missing file: %+v", got)
	}
}

func TestCap(t *testing.T) {
	s := hit(State{}, start)
	during := start.Add(time.Minute)
	for _, c := range []struct {
		now       time.Time
		max, jobs int
		hold      bool
	}{
		{start.Add(time.Hour), 4, 4, false},
		{during, 4, 1, false},
		{during, 2, 1, false},
		{during, 1, 1, true},
	} {
		jobs, hold := s.Cap(c.now, c.max)
		if jobs != c.jobs || hold != c.hold {
			t.Errorf("max %d at %s: got %d, hold %v", c.max, c.now.Sub(start), jobs, hold)
		}
	}
	if jobs, hold := (State{}).Cap(during, 3); jobs != 3 || hold {
		t.Errorf("no cooldown: %d, %v", jobs, hold)
	}
}

// A kill stops its sibling jobs too, each of which reports host_killed; the
// restarted daemon sees the same marker. They are one strike.
func TestOneOutOfMemoryEventIsOneStrike(t *testing.T) {
	kill := start.Add(-time.Second)
	s, counted := State{}.Hit(start, kill)
	if !counted {
		t.Fatal("the first report did not count")
	}
	again, counted := s.Hit(start.Add(2*time.Second), kill)
	if counted || again != s {
		t.Fatalf("the same kill counted twice: %+v", again)
	}
	later, counted := s.Hit(start.Add(20*time.Minute), start.Add(19*time.Minute))
	if !counted || later.Strikes != 2 {
		t.Fatalf("a later kill: %+v", later)
	}
}
