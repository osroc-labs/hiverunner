package jobs

import "testing"

func TestClassifyNamesTheMostSpecificCause(t *testing.T) {
	host := Evidence{
		Host:        "MacBook-Pro-5",
		Label:       "hive-4cpu",
		MemoryBytes: 8 << 30,
	}
	cases := []struct {
		name   string
		extra  Evidence
		reason string
		want   string
	}{
		{
			name:   "guest OOM wins over a later release",
			extra:  Evidence{GuestOOM: true, PeakUsedBytes: 79 * (1 << 30) / 10, Released: true},
			reason: ReasonGuestOOM,
			want:   "runner killed: guest OOM (7.9/8 GB peak) on MacBook-Pro-5 (hive-4cpu)",
		},
		{
			name:   "host killed the VM",
			extra:  Evidence{HostKilled: true},
			reason: ReasonHostKilled,
			want:   "runner killed: host pressure (8 GB) on MacBook-Pro-5 (hive-4cpu)",
		},
		{
			name:   "disk full",
			extra:  Evidence{DiskFull: true, Timeout: true},
			reason: ReasonDiskFull,
			want:   "runner stopped: disk full on MacBook-Pro-5 (hive-4cpu)",
		},
		{
			name:   "timeout",
			extra:  Evidence{Timeout: true},
			reason: ReasonTimeout,
			want:   "runner stopped: job timed out on MacBook-Pro-5 (hive-4cpu)",
		},
		{
			name:   "daemon shutdown",
			extra:  Evidence{Shutdown: true},
			reason: ReasonDaemonShutdown,
			want:   "runner stopped: daemon shutting down on MacBook-Pro-5 (hive-4cpu)",
		},
		{
			name:   "coordinator released a finished job",
			extra:  Evidence{Released: true, HasExit: true, ExitCode: 0},
			reason: ReasonReleased,
			want:   "runner released on MacBook-Pro-5 (hive-4cpu)",
		},
		{
			name:   "VM vanished",
			extra:  Evidence{},
			reason: ReasonVMCrash,
			want:   "runner crashed on MacBook-Pro-5 (hive-4cpu)",
		},
		{
			name:   "SIGKILL under memory pressure is an OOM",
			extra:  Evidence{HasExit: true, ExitCode: 137, PeakUsedBytes: 7 << 30},
			reason: ReasonGuestOOM,
			want:   "runner killed: guest OOM (7/8 GB peak) on MacBook-Pro-5 (hive-4cpu)",
		},
		{
			name:   "a normal runner failure is not a kill",
			extra:  Evidence{HasExit: true, ExitCode: 1},
			reason: "",
			want:   "",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := host
			e.GuestOOM = c.extra.GuestOOM
			e.DiskFull = c.extra.DiskFull
			e.HostKilled = c.extra.HostKilled
			e.VMFailed = c.extra.VMFailed
			e.PeakUsedBytes = c.extra.PeakUsedBytes
			e.SwapTotalBytes = c.extra.SwapTotalBytes
			e.SwapUsedBytes = c.extra.SwapUsedBytes
			e.HasExit = c.extra.HasExit
			e.ExitCode = c.extra.ExitCode
			e.Timeout = c.extra.Timeout
			e.Released = c.extra.Released
			e.Shutdown = c.extra.Shutdown
			got := Classify(e)
			if got.Reason != c.reason || got.Detail != c.want {
				t.Fatalf("Classify = %+v, want reason %q detail %q", got, c.reason, c.want)
			}
		})
	}
}

func TestParseDiagAndScanConsole(t *testing.T) {
	used, total, swapUsed, swapTotal, oom, disk := ParseDiag("" +
		"peak_used_kb=8126464\n" +
		"mem_total_kb=8388608\n" +
		"swap_used_kb=1048576\n" +
		"swap_total_kb=4194304\n" +
		"oom=1\n" +
		"disk_full=0\n")
	if !oom || disk || used == 0 || total == 0 || swapUsed == 0 || swapTotal == 0 {
		t.Fatalf("ParseDiag = %d %d %d %d oom=%v disk=%v", used, total, swapUsed, swapTotal, oom, disk)
	}
	oom, disk, panic := ScanConsole("Out of memory: Killed process 99 (node)\nNo space left on device\nKernel panic - not syncing")
	if !oom || !disk || !panic {
		t.Fatalf("ScanConsole = oom=%v disk=%v panic=%v", oom, disk, panic)
	}
	if oom, disk, panic = ScanConsole("job printed: killed process by accident"); !oom || disk || panic {
		t.Fatal("ScanConsole is case-insensitive and matches the kernel phrase")
	}
}
