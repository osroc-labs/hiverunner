package vm

import (
	"strings"
	"testing"
)

func TestWhyADeviceCouldNotBeOpenedSaysWhatToRun(t *testing.T) {
	for _, test := range []struct {
		name   string
		device deniedDevice
		want   []string
	}{
		{"given to another group", deniedDevice{Path: "/dev/kvm", Group: "render", Listed: true, Holds: true},
			[]string{"belongs to group render, not kvm", "sudo chgrp kvm /dev/kvm"}},
		{"given to another group under Windows", deniedDevice{Path: "/dev/kvm", Group: "systemd-resolve", Listed: true, Holds: true, Windows: true},
			[]string{"given to group systemd-resolve", "another Linux on this PC", "wsl -d HiveWorker -u root /usr/local/sbin/hive-devices"}},
		{"a service older than the membership", deniedDevice{Path: "/dev/vhost-vsock", Group: "kvm", KVM: true, Listed: true, UID: 1000},
			[]string{"started before your user joined the kvm group", "sudo setfacl -m u:$USER:rw /dev/kvm /dev/vhost-vsock", "systemctl --user restart hiveworker", "sudo systemctl restart user@1000", "ends every session"}},
		{"never a member", deniedDevice{Path: "/dev/kvm", Group: "kvm", KVM: true},
			[]string{"your user cannot open /dev/kvm", "sudo usermod -aG kvm $USER"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := test.device.reason()
			for _, want := range test.want {
				if !strings.Contains(got, want) {
					t.Errorf("%q lacks %q", got, want)
				}
			}
			// status and doctor show what follows the first colon as the fix.
			if _, fix, ok := strings.Cut(got, ": "); !ok || !strings.Contains(fix, "`") {
				t.Errorf("no command after a colon in %q", got)
			}
		})
	}
}
