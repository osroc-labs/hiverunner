package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/thecomputerplumbers/hiveworker/daemon/internal/protocol"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// coordinator is a stand-in that runs `serve` for each accepted tunnel.
func coordinator(t *testing.T, serve func(ctx context.Context, c *websocket.Conn, attempt int)) string {
	t.Helper()
	var attempts atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer hwm_good" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		serve(r.Context(), c, int(attempts.Add(1)))
	}))
	t.Cleanup(s.Close)
	return "ws" + strings.TrimPrefix(s.URL, "http")
}

func write(ctx context.Context, c *websocket.Conn, message string) {
	_ = c.Write(ctx, websocket.MessageText, []byte(message))
}

func read(ctx context.Context, t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	for {
		_, raw, err := c.Read(ctx)
		if err != nil {
			t.Errorf("coordinator read: %v", err)
			return nil
		}
		if string(raw) == protocol.Ping {
			write(ctx, c, protocol.Pong)
			continue
		}
		var message map[string]any
		_ = json.Unmarshal(raw, &message)
		return message
	}
}

func options(url, token string, presence *atomic.Value) Options {
	return Options{
		URL: url, Token: token, DaemonVersion: "test", Log: quiet,
		PresenceEvery: 10 * time.Millisecond, PingEvery: 20 * time.Millisecond,
		Presence: func() protocol.Presence { return presence.Load().(protocol.Presence) },
	}
}

func TestHelloPresenceAndDecliningJobs(t *testing.T) {
	var presence atomic.Value
	presence.Store(protocol.Online)
	done := make(chan struct{})
	url := coordinator(t, func(ctx context.Context, c *websocket.Conn, _ int) {
		defer close(done)
		write(ctx, c, `{"type":"welcome","machineId":"m","protocol":1}`)
		if hello := read(ctx, t, c); hello["type"] != "hello" || hello["presence"] != "online" {
			t.Errorf("first frame = %v", hello)
		}
		presence.Store(protocol.Paused)
		if update := read(ctx, t, c); update["type"] != "presence" || update["presence"] != "paused" {
			t.Errorf("presence frame = %v", update)
		}
		write(ctx, c, `{"type":"job.assign","assignmentId":"a-1","label":"hive","vcpus":2,"jitConfig":"x","timeoutMinutes":60}`)
		if answer := read(ctx, t, c); answer["type"] != "job.rejected" || answer["assignmentId"] != "a-1" {
			t.Errorf("answer to job.assign = %v", answer)
		}
		// An unknown frame is ignored, not fatal: the next ping still arrives.
		write(ctx, c, `{"type":"something-new"}`)
	})
	ctx, cancel := context.WithCancel(context.Background())
	finished := make(chan error, 1)
	go func() { finished <- Run(ctx, options(url, "hwm_good", &presence)) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the exchange did not complete")
	}
	cancel()
	if err := <-finished; err != nil {
		t.Fatalf("Run() after cancel = %v", err)
	}
}

func TestVerdictsThatReconnectingCannotFix(t *testing.T) {
	var presence atomic.Value
	presence.Store(protocol.Online)
	for code, want := range map[websocket.StatusCode]error{
		protocol.CloseRevoked:     ErrRevoked,
		protocol.CloseReplaced:    ErrReplaced,
		protocol.CloseUnsupported: ErrUnsupported,
	} {
		url := coordinator(t, func(ctx context.Context, c *websocket.Conn, _ int) {
			_ = c.Close(code, "")
		})
		if err := Run(context.Background(), options(url, "hwm_good", &presence)); !errors.Is(err, want) {
			t.Errorf("close %d: Run() = %v, want %v", code, err, want)
		}
	}
	url := coordinator(t, func(context.Context, *websocket.Conn, int) {})
	if err := Run(context.Background(), options(url, "hwm_bad", &presence)); !errors.Is(err, ErrRevoked) {
		t.Errorf("refused token: Run() = %v, want %v", err, ErrRevoked)
	}
}

func TestADroppedConnectionIsRetried(t *testing.T) {
	var presence atomic.Value
	presence.Store(protocol.Online)
	second := make(chan struct{})
	url := coordinator(t, func(ctx context.Context, c *websocket.Conn, attempt int) {
		write(ctx, c, `{"type":"welcome","machineId":"m","protocol":1}`)
		read(ctx, t, c)
		if attempt == 1 {
			return // Drop it, as a deploy would.
		}
		close(second)
		<-ctx.Done()
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = Run(ctx, options(url, "hwm_good", &presence)) }()
	select {
	case <-second:
	case <-time.After(10 * time.Second):
		t.Fatal("the daemon did not reconnect")
	}
}

func TestOneJobSlotIsSharedBetweenPools(t *testing.T) {
	var jobs Jobs
	if !jobs.Claim("acme-1") {
		t.Fatal("an idle machine refused a job")
	}
	if jobs.Claim("globex-1") {
		t.Fatal("a busy machine took a second pool's job")
	}
	if !jobs.Busy() {
		t.Fatal("Busy() = false while a job holds the slot")
	}
	jobs.Release("globex-1")
	if !jobs.Busy() {
		t.Fatal("another pool's release freed the slot")
	}
	jobs.Release("acme-1")
	if jobs.Busy() || !jobs.Claim("globex-1") {
		t.Fatal("the slot was not freed")
	}
}
