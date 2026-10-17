package main

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/api"
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

func TestEnrollingAfterChoosingHivesReturnsWhatTheSecondAttemptSaid(t *testing.T) {
	pools := []api.Pool{{ID: "gh-1", Name: "acme"}, {ID: "gh-2", Name: "globex"}}
	var asked [][]string
	enroll := func(machine api.Machine) (api.Enrollment, error) {
		asked = append(asked, machine.OrganizationIDs)
		if len(machine.OrganizationIDs) == 0 {
			return api.Enrollment{}, &api.ChoosePoolError{Pools: pools}
		}
		return api.Enrollment{MachineID: "m-1", Token: "secret", Pools: pools}, nil
	}
	all := func(offered []api.Pool) ([]api.Pool, error) { return offered, nil }

	enrollment, err := enrollChoosing(api.Machine{Name: "box"}, enroll, all)
	if err != nil || enrollment.Token != "secret" {
		t.Fatalf("enrolled as %+v, %v; want the second attempt's token", enrollment, err)
	}
	if len(asked) != 2 || len(asked[1]) != 2 || asked[1][0] != "gh-1" || asked[1][1] != "gh-2" {
		t.Fatalf("the server was asked %v; want once with no hives, then with both", asked)
	}

	// A hive named up front is never asked about.
	asked = nil
	never := func([]api.Pool) ([]api.Pool, error) { t.Fatal("asked which hive"); return nil, nil }
	if _, err := enrollChoosing(api.Machine{OrganizationIDs: []string{"gh-2"}}, enroll, never); err != nil || len(asked) != 1 {
		t.Fatalf("asked %v, %v; want one attempt", asked, err)
	}
}

func TestAQuestionNobodyAnswersSaysTheCommandForEachHive(t *testing.T) {
	pools := []api.Pool{{ID: "gh-1", Name: "acme"}, {ID: "gh-2", Name: "globex"}}
	err := unanswered(pools, func(pool api.Pool) string { return "hived login --hive " + pool.Name }, "hived login --hive all")
	for _, want := range []string{"hived login --hive acme", "hived login --hive globex", "hived login --hive all"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not say %q", err, want)
		}
	}
}

func TestNobodyIsAskedWithoutATerminal(t *testing.T) {
	// A pipe left open, as ssh leaves one: reading it would wait for ever.
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	if interactive(reader) {
		t.Fatal("a pipe was taken for a terminal")
	}
	stdin := os.Stdin
	os.Stdin = reader
	defer func() { os.Stdin = stdin }()
	pools := []api.Pool{{ID: "gh-1", Name: "acme"}, {ID: "gh-2", Name: "globex"}}
	done := make(chan error, 1)
	go func() {
		_, err := askPools("Which?", pools, func(pool api.Pool) string { return "hived link " + pool.Name }, "hived link --all")
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "hived link --all") {
			t.Fatalf("askPools said %v; want the commands to run", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("askPools waited for an answer with no terminal to give one")
	}
}

func TestHivesAsJSONNameEachOneAndItsID(t *testing.T) {
	var out bytes.Buffer
	if err := writeHives(&out, api.Assignment{MachineID: "m-1", Pools: []api.Pool{{ID: "gh-1", Name: "acme"}}}); err != nil {
		t.Fatal(err)
	}
	var listed struct {
		MachineID string `json:"machineId"`
		Hives     []struct{ ID, Name string }
	}
	if err := json.Unmarshal(out.Bytes(), &listed); err != nil || listed.MachineID != "m-1" || len(listed.Hives) != 1 || listed.Hives[0].ID != "gh-1" || listed.Hives[0].Name != "acme" {
		t.Fatalf("%s decoded as %+v, %v", out.String(), listed, err)
	}
	out.Reset()
	if err := writeHives(&out, api.Assignment{MachineID: "m-1"}); err != nil || !strings.Contains(out.String(), `"hives": []`) {
		t.Fatalf("a machine in no hive said %s, %v; want an empty list, not null", out.String(), err)
	}
}

func TestAHiveFlagIsSplitOnCommas(t *testing.T) {
	if got := strings.Join(splitHives("acme, Globex,,gh-3 "), "|"); got != "acme|Globex|gh-3" {
		t.Fatalf("got %q", got)
	}
}
