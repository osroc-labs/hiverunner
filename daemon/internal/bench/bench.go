// Package bench measures how fast one core of this machine is, relative to
// one core of a GitHub standard hosted runner. That ratio is the speed score:
// it scales what a minute on this machine is worth.
package bench

import (
	"bytes"
	"compress/flate"
	"crypto/sha256"
	"sort"
	"time"
)

// ReferenceUnitsPerSecond is what one core of a GitHub standard hosted Linux
// runner scores on Run. It is measured, not chosen: the daemon CI job prints
// the raw figure on that hardware, and this constant is set from it.
//
// PLACEHOLDER until calibrated from CI; see docs/spec.md.
const ReferenceUnitsPerSecond = 100.0

// One unit is a fixed piece of work shaped like CI: compress, hash, sort.
func unit(data []byte, scratch []int) [32]byte {
	var compressed bytes.Buffer
	writer, _ := flate.NewWriter(&compressed, flate.BestSpeed)
	_, _ = writer.Write(data)
	_ = writer.Close()
	for i := range scratch {
		scratch[i] = int(data[(i*31)%len(data)])*len(scratch) - i
	}
	sort.Ints(scratch)
	return sha256.Sum256(compressed.Bytes())
}

// Run works one core for about the given duration and returns units per
// second. Deterministic input, so two machines do identical work.
func Run(duration time.Duration) float64 {
	data := make([]byte, 256*1024)
	state := uint32(2463534242)
	for i := range data {
		// xorshift: reproducible and only loosely compressible, like source.
		state ^= state << 13
		state ^= state >> 17
		state ^= state << 5
		data[i] = byte(state>>24) & 0x3f
	}
	scratch := make([]int, 64*1024)

	// Warm up so frequency scaling has settled before the clock starts.
	for i := 0; i < 3; i++ {
		unit(data, scratch)
	}
	start := time.Now()
	units := 0
	for time.Since(start) < duration {
		unit(data, scratch)
		units++
	}
	return float64(units) / time.Since(start).Seconds()
}

// Score converts a measurement into a speed score.
func Score(unitsPerSecond float64) float64 {
	return unitsPerSecond / ReferenceUnitsPerSecond
}
