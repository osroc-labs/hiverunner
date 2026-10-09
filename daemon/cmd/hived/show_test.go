package main

import (
	"strings"
	"testing"
	"time"

	"github.com/thecomputerplumbers/hiveworker/daemon/internal/ui"
	"github.com/thecomputerplumbers/hiveworker/daemon/internal/vm"
)

func TestASelfTestReportSaysEachLineOnceAndWhatTheVMIs(t *testing.T) {
	old := "RUNNER_VERSION=2.337.0\nKERNEL=6.8.0-146-generic\nNETWORK=ok\n" +
		"NODE=http://127.0.0.1:47071/\nINPUTS=kept https://example.com/ a,b c\n" +
		"NODE=http://127.0.0.1:47071/\nINPUTS=kept https://example.com/ a,b c\n"
	got := tidyReport(old, vm.Image{ImageVersion: 8, Architecture: "arm64"})
	for _, line := range []string{"NODE=http://127.0.0.1:47071/", "INPUTS=kept https://example.com/ a,b c", "ARCH=arm64", "IMAGE=8", "NETWORK=ok"} {
		if strings.Count(got, line+"\n") != 1 {
			t.Errorf("%q appears %d times in:\n%s", line, strings.Count(got, line+"\n"), got)
		}
	}
	// A guest that says its own architecture is not contradicted.
	got = tidyReport("ARCH=aarch64\nOS=Ubuntu 24.04.3 LTS\nNODE[node20]=x\nNODE[node24]=x\n", vm.Image{ImageVersion: 9})
	if strings.Count(got, "ARCH=") != 1 || !strings.Contains(got, "NODE[node24]=x") {
		t.Errorf("got:\n%s", got)
	}
}

func TestTunnelRowsFitTheBoxAndSayWhenAndWhy(t *testing.T) {
	now := time.Date(2026, 10, 9, 13, 0, 0, 0, time.Local)
	screen := ui.For(nil)
	rows := tunnelRows(screen, []tunnelState{
		{Hive: "acme", Connected: true, Since: now.Add(-2 * time.Hour)},
		{Hive: "a-hive-with-quite-a-long-name", Since: now.Add(-30 * time.Hour), Reason: "DNS lookup failed"},
		{Hive: "new"},
	}, now)
	text := strings.Join(rows, "\n")
	for _, want := range []string{"Tunnel", "acme  connected since 11:00", "disconnected since Oct 8 07:00", "DNS lookup failed", "new  connecting", "hived doctor"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in:\n%s", want, text)
		}
	}
	for _, row := range rows {
		if ui.Width(row) > ui.Inner {
			t.Errorf("%d columns, wider than the box: %q", ui.Width(row), row)
		}
	}
	if len(tunnelRows(screen, nil, now)) != 0 {
		t.Error("no daemon running should say nothing of tunnels")
	}
}
