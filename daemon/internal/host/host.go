// Package host reads what the daemon needs to know about the machine it runs
// on: what the hardware is, and whether its owner would mind a job right now.
package host

// Facts describes the hardware, reported once at enrollment.
type Facts struct {
	Name        string
	Model       string
	OS          string
	Arch        string
	Cores       int
	MemoryBytes int64
}

// Power is what decides whether the machine may take jobs at all.
type Power struct {
	// OnBattery is true when the machine is not on external power.
	OnBattery bool
	// LidClosed is true for a laptop with its lid shut.
	LidClosed bool
}

// Available reports whether the machine may accept a job. A job never starts
// on battery or with the lid closed: the first drains the owner's battery and
// the second is about to sleep under it.
func (p Power) Available() bool {
	return !p.OnBattery && !p.LidClosed
}
