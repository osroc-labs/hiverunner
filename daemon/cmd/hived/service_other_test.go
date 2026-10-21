//go:build !darwin

package main

import "testing"

func TestAUnitNeedsOOMPolicyContinue(t *testing.T) {
	for unit, want := range map[string]bool{
		"[Service]\nExecStart=x\nOOMPolicy=continue\n": true,
		"[Service]\nOOMPolicy = continue\n":            true,
		"[Service]\nExecStart=x\n":                     false,
		"[Service]\nOOMPolicy=stop\n":                  false,
	} {
		if got := hasOOMPolicyContinue(unit); got != want {
			t.Errorf("%q: got %v, want %v", unit, got, want)
		}
	}
}
