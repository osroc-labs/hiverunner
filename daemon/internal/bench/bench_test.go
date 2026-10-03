package bench

import (
	"testing"
	"time"
)

func TestRunMeasuresSomething(t *testing.T) {
	if got := Run(50 * time.Millisecond); got <= 0 {
		t.Fatalf("Run() = %v, want > 0", got)
	}
}

func TestTheUnitIsDeterministic(t *testing.T) {
	data := []byte("the same work on every machine, or the score means nothing")
	a := unit(data, make([]int, 128))
	b := unit(data, make([]int, 128))
	if a != b {
		t.Fatal("unit() gave different results for the same input")
	}
}

func TestScoreIsRelativeToTheReference(t *testing.T) {
	if got := Score(ReferenceUnitsPerSecond * 2); got != 2 {
		t.Fatalf("Score() = %v, want 2", got)
	}
}
