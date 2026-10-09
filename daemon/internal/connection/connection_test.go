package connection

import (
	"errors"
	"testing"
	"time"
)

func TestAnOutageKeepsTheTimeItBeganAndIsWrittenOnce(t *testing.T) {
	now := time.Date(2026, 10, 8, 6, 56, 0, 0, time.UTC)
	var writes []State
	r := NewRecorder()
	r.Now = func() time.Time { return now }
	r.Save = func(state State) error { writes = append(writes, state); return nil }

	r.Set("acme", true, nil)
	began := now.Add(time.Hour)
	now = began
	dns := errors.New("connect: failed to WebSocket dial: dial tcp: lookup connect.example.com: no such host")
	r.Set("acme", false, dns)
	for i := 0; i < 4000; i++ {
		now = now.Add(30 * time.Second)
		r.Set("acme", false, dns)
	}
	if len(writes) != 2 {
		t.Fatalf("an outage of one cause wrote the file %d times, want 2", len(writes))
	}
	last := writes[len(writes)-1].Hives[0]
	if last.Connected || !last.Since.Equal(began) || Reason(last.Error) != "DNS lookup failed" {
		t.Errorf("got %+v", last)
	}
	// A different reason is news, but the outage began when it began.
	r.Set("acme", false, errors.New("dial tcp 1.2.3.4:443: connect: connection refused"))
	last = writes[len(writes)-1].Hives[0]
	if len(writes) != 3 || !last.Since.Equal(began) {
		t.Errorf("a new reason: %d writes, since %v", len(writes), last.Since)
	}
	r.Set("acme", true, nil)
	r.Set("globex", true, nil)
	r.Forget("acme")
	r.Forget("acme")
	final := writes[len(writes)-1]
	if len(final.Hives) != 1 || final.Hives[0].Name != "globex" || !final.Hives[0].Connected {
		t.Errorf("got %+v", final)
	}
}

func TestReasonsDoNotChangeWithThePort(t *testing.T) {
	a := Reason("failed to read frame header: read tcp 192.168.4.54:54686->172.67.141.141:443: read: connection reset by peer")
	b := Reason("failed to read frame header: read tcp 192.168.4.54:60777->104.21.49.52:443: read: connection reset by peer")
	if a != b || a != "the connection dropped" {
		t.Errorf("%q, %q", a, b)
	}
	if Reason("") != "" {
		t.Error("no failure has no reason")
	}
}

func TestQuietSaysTheFirstThenOneEveryWhile(t *testing.T) {
	q := Quiet{Every: 10 * time.Minute}
	now := time.Date(2026, 10, 8, 6, 56, 0, 0, time.UTC)
	said := 0
	for i := 0; i < 120; i++ { // an hour of retries, one every 30s
		if ok, skipped := q.Say(now); ok {
			said++
			if said > 1 && skipped != 19 {
				t.Errorf("line %d left %d unsaid, want 19", said, skipped)
			}
		}
		now = now.Add(30 * time.Second)
	}
	if said != 6 {
		t.Errorf("said %d lines in an hour, want 6", said)
	}
	q.Reset()
	if ok, _ := q.Say(now); !ok {
		t.Error("the first failure after it worked again was not said")
	}
}
