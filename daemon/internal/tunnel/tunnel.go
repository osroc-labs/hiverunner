// Package tunnel keeps the daemon's one outbound connection to the
// coordinator alive, and decides what the daemon says over it.
package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/coder/websocket"

	"github.com/thecomputerplumbers/hiveworker/daemon/internal/protocol"
)

// Fatal errors end the daemon instead of reconnecting: trying again would get
// the same answer.
var (
	ErrRevoked     = errors.New("this machine was removed from its pool; run `hived login` to enroll again")
	ErrReplaced    = errors.New("another daemon connected as this machine; only one can run at a time")
	ErrUnsupported = errors.New("this daemon is too old for the coordinator; update HiveWorker")
)

type Options struct {
	URL           string
	Token         string
	DaemonVersion string
	// Presence is asked whenever the daemon needs to say what state the
	// machine is in. It must be cheap; it is called on a timer.
	Presence func() protocol.Presence
	// PresenceEvery is how often Presence is re-read. Defaults to 5s.
	PresenceEvery time.Duration
	// PingEvery is the keepalive period. Defaults to 30s.
	PingEvery time.Duration
	Log       *slog.Logger
}

// Run holds the tunnel open until ctx is cancelled or the coordinator says
// something reconnecting cannot fix. Network failures are retried with
// backoff, forever: a laptop that slept reconnects when it wakes.
func Run(ctx context.Context, options Options) error {
	if options.PresenceEvery == 0 {
		options.PresenceEvery = 5 * time.Second
	}
	if options.PingEvery == 0 {
		options.PingEvery = 30 * time.Second
	}
	backoff := time.Second
	for {
		connected, err := session(ctx, options)
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, ErrRevoked) || errors.Is(err, ErrReplaced) || errors.Is(err, ErrUnsupported) {
			return err
		}
		if connected {
			backoff = time.Second
		}
		// Jitter, so a coordinator deploy does not bring every daemon back in
		// the same instant.
		wait := backoff/2 + rand.N(backoff/2+1)
		options.Log.Warn("tunnel closed; reconnecting", "error", err, "in", wait.Round(time.Millisecond))
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
		}
		backoff = min(backoff*2, time.Minute)
	}
}

// session is one connection, from dial to close. It reports whether the
// coordinator welcomed us, so the caller knows to reset its backoff.
func session(ctx context.Context, options Options) (bool, error) {
	dialCtx, cancelDial := context.WithTimeout(ctx, 20*time.Second)
	connection, response, err := websocket.Dial(dialCtx, options.URL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + options.Token}},
	})
	cancelDial()
	if err != nil {
		// A refused token before the upgrade is the same verdict as a 4001
		// after it.
		if response != nil && response.StatusCode == http.StatusUnauthorized {
			return false, ErrRevoked
		}
		return false, fmt.Errorf("connect: %w", err)
	}
	defer connection.CloseNow()
	connection.SetReadLimit(1 << 20)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	frames := make(chan []byte)
	readErr := make(chan error, 1)
	go func() {
		for {
			_, raw, err := connection.Read(ctx)
			if err != nil {
				readErr <- err
				return
			}
			select {
			case frames <- raw:
			case <-ctx.Done():
				return
			}
		}
	}()

	send := func(message any) error {
		encoded, ok := message.(string)
		if !ok {
			raw, err := json.Marshal(message)
			if err != nil {
				return err
			}
			encoded = string(raw)
		}
		writeCtx, cancelWrite := context.WithTimeout(ctx, 10*time.Second)
		defer cancelWrite()
		return connection.Write(writeCtx, websocket.MessageText, []byte(encoded))
	}

	presence := options.Presence()
	welcomed := false
	lastPong := time.Now()
	presenceTick := time.NewTicker(options.PresenceEvery)
	defer presenceTick.Stop()
	pingTick := time.NewTicker(options.PingEvery)
	defer pingTick.Stop()

	for {
		select {
		case <-ctx.Done():
			// Tell the coordinator now rather than leaving it to notice.
			_ = send(protocol.NewPresence(protocol.Offline))
			_ = connection.Close(websocket.StatusNormalClosure, "daemon stopping")
			return welcomed, nil

		case err := <-readErr:
			switch websocket.CloseStatus(err) {
			case protocol.CloseRevoked:
				return welcomed, ErrRevoked
			case protocol.CloseReplaced:
				return welcomed, ErrReplaced
			case protocol.CloseUnsupported:
				return welcomed, ErrUnsupported
			}
			return welcomed, err

		case raw := <-frames:
			if string(raw) == protocol.Pong {
				lastPong = time.Now()
				continue
			}
			message, err := protocol.DecodeCoordinator(raw)
			if err != nil {
				options.Log.Warn("ignoring a frame this daemon does not understand", "error", err)
				continue
			}
			switch message := message.(type) {
			case *protocol.Welcome:
				if err := send(protocol.NewHello(options.DaemonVersion, presence)); err != nil {
					return welcomed, err
				}
				welcomed = true
				options.Log.Info("connected to the pool", "machine", message.MachineID, "presence", presence)
			case *protocol.JobAssign:
				// The VM runner is not in this build. Say so at once, so the
				// coordinator offers the job elsewhere instead of waiting.
				options.Log.Info("declining a job: this build cannot run jobs yet", "label", message.Label)
				if err := send(protocol.NewJobRejected(message.AssignmentID, "this daemon build cannot run jobs yet")); err != nil {
					return welcomed, err
				}
			case *protocol.Drain:
				options.Log.Info("the coordinator asked this machine to drain")
			case *protocol.Error:
				options.Log.Warn("the coordinator rejected a message", "message", message.Message)
			}

		case <-presenceTick.C:
			if !welcomed {
				continue
			}
			if next := options.Presence(); next != presence {
				presence = next
				options.Log.Info("presence changed", "presence", presence)
				if err := send(protocol.NewPresence(presence)); err != nil {
					return welcomed, err
				}
			}

		case <-pingTick.C:
			// A laptop lid can close without the socket ever erroring.
			if time.Since(lastPong) > 3*options.PingEvery {
				return welcomed, errors.New("the coordinator stopped answering")
			}
			if err := send(protocol.Ping); err != nil {
				return welcomed, err
			}
		}
	}
}
