package main

import (
	"testing"

	"github.com/thecomputerplumbers/hiveworker/daemon/internal/api"
)

func TestChoosingHivesByNumber(t *testing.T) {
	pools := []api.Pool{{ID: "gh-1", Name: "acme"}, {ID: "gh-2", Name: "globex"}, {ID: "gh-3", Name: "initech"}}
	for answer, want := range map[string]string{
		"2":     "globex",
		"3, 1":  "initech, acme",
		"all":   "acme, globex, initech",
		"ALL":   "acme, globex, initech",
		" 1 ,2": "acme, globex",
	} {
		chosen, err := choosePools(answer, pools)
		if err != nil || names(chosen) != want {
			t.Errorf("%q chose %q, %v; want %q", answer, names(chosen), err, want)
		}
	}
	for _, answer := range []string{"", "0", "4", "globex", "1,,2"} {
		if chosen, err := choosePools(answer, pools); err == nil {
			t.Errorf("%q chose %q; want a refusal", answer, names(chosen))
		}
	}
	if got := describe(nil); got != "It serves no hives." {
		t.Errorf("describe(nil) = %q", got)
	}
}
