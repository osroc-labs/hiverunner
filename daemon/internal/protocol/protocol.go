// Package protocol is the daemon's copy of the tunnel protocol defined in
// packages/protocol. The JSON fixtures there are the contract: this package's
// tests decode every one of them, so the two sides cannot drift silently.
package protocol

import (
	"encoding/json"
	"fmt"
)

// Version is bumped on any change an older peer could not safely ignore.
const Version = 1

// Keepalive frames. The coordinator answers Ping at the edge without waking.
const (
	Ping = "ping"
	Pong = "pong"
)

// Presence is what the daemon tells the coordinator about this machine.
type Presence string

const (
	Offline  Presence = "offline"
	Paused   Presence = "paused"
	Online   Presence = "online"
	Busy     Presence = "busy"
	Draining Presence = "draining"
)

// Close codes the daemon acts on.
const (
	// CloseReplaced: another connection for this machine took over.
	CloseReplaced = 4000
	// CloseRevoked: the machine token is no longer valid. Enroll again.
	CloseRevoked = 4001
	// CloseUnsupported: this daemon is too old for the coordinator.
	CloseUnsupported = 4002
)

// Hello is the first frame the daemon sends.
type Hello struct {
	Type          string   `json:"type"`
	Protocol      int      `json:"protocol"`
	DaemonVersion string   `json:"daemonVersion"`
	Presence      Presence `json:"presence"`
}

// PresenceUpdate reports a change of state.
type PresenceUpdate struct {
	Type     string   `json:"type"`
	Presence Presence `json:"presence"`
}

// JobAccepted, JobRejected and JobExited answer a JobAssign.
type JobAccepted struct {
	Type         string `json:"type"`
	AssignmentID string `json:"assignmentId"`
}

type JobRejected struct {
	Type         string `json:"type"`
	AssignmentID string `json:"assignmentId"`
	Reason       string `json:"reason"`
}

type JobExited struct {
	Type         string `json:"type"`
	AssignmentID string `json:"assignmentId"`
	ExitCode     int    `json:"exitCode"`
}

// Welcome is the coordinator's first frame.
type Welcome struct {
	MachineID string `json:"machineId"`
	Protocol  int    `json:"protocol"`
}

// JobAssign offers this machine one job.
type JobAssign struct {
	AssignmentID string `json:"assignmentId"`
	// Label is the runs-on label, which is also the scale set.
	Label string `json:"label"`
	VCPUs int    `json:"vcpus"`
	// JITConfig is GitHub's one-time runner configuration, passed to the
	// runner unchanged. It is a credential: never log it.
	JITConfig      string `json:"jitConfig"`
	TimeoutMinutes int    `json:"timeoutMinutes"`
}

// Error is the coordinator rejecting a frame without closing the tunnel.
type Error struct {
	Message string `json:"message"`
}

// Drain asks the daemon to finish its job and take no more.
type Drain struct{}

func NewHello(daemonVersion string, presence Presence) Hello {
	return Hello{Type: "hello", Protocol: Version, DaemonVersion: daemonVersion, Presence: presence}
}

func NewPresence(presence Presence) PresenceUpdate {
	return PresenceUpdate{Type: "presence", Presence: presence}
}

func NewJobAccepted(id string) JobAccepted {
	return JobAccepted{Type: "job.accepted", AssignmentID: id}
}

func NewJobRejected(id, reason string) JobRejected {
	return JobRejected{Type: "job.rejected", AssignmentID: id, Reason: reason}
}

func NewJobExited(id string, exitCode int) JobExited {
	return JobExited{Type: "job.exited", AssignmentID: id, ExitCode: exitCode}
}

// DecodeCoordinator turns a frame from the coordinator into one of Welcome,
// JobAssign, Drain or Error. Unknown types are an error rather than ignored:
// a frame this daemon does not understand may be one it must not skip.
func DecodeCoordinator(raw []byte) (any, error) {
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, fmt.Errorf("decode frame: %w", err)
	}
	decode := func(target any) (any, error) {
		if err := json.Unmarshal(raw, target); err != nil {
			return nil, fmt.Errorf("decode %s: %w", envelope.Type, err)
		}
		return target, nil
	}
	switch envelope.Type {
	case "welcome":
		return decode(&Welcome{})
	case "job.assign":
		message, err := decode(&JobAssign{})
		if err != nil {
			return nil, err
		}
		assign := message.(*JobAssign)
		if assign.AssignmentID == "" || assign.JITConfig == "" || assign.VCPUs < 1 {
			return nil, fmt.Errorf("incomplete job.assign")
		}
		return assign, nil
	case "drain":
		return &Drain{}, nil
	case "error":
		return decode(&Error{})
	default:
		return nil, fmt.Errorf("unknown frame type %q", envelope.Type)
	}
}
