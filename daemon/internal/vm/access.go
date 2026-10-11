package vm

import "fmt"

// A device the kvm group opens, and what was found when this user could
// not: /dev/kvm for the VMs, /dev/vhost-vsock for the cache.
type deniedDevice struct {
	Path string
	// Group is the device's group, by name where it has one here.
	Group string
	// KVM is whether the device's group is this system's kvm group.
	KVM bool
	// Listed is whether the user is named in the kvm group, and Holds
	// whether this process has it: a service keeps the groups its user had
	// when the user's services started.
	Listed, Holds bool
	// UID is the user's, for the command that restarts their services.
	UID int
	// Windows is whether this Linux is one inside Windows' Linux subsystem,
	// where every Linux shares /dev and there is no password for sudo.
	Windows bool
}

// reason is why the device could not be opened, and after a colon what to
// run. Which of three things it is decides the command: the device was given
// to another group, the service is older than the user's membership, or the
// user was never a member.
func (d deniedDevice) reason() string {
	switch {
	case !d.KVM && d.Windows:
		// Every Linux under Windows shares one /dev, and the group on a
		// device is a number: another Linux starting gives it the number
		// its own kvm group has.
		return fmt.Sprintf("%s was given to group %s, not kvm, by another Linux on this PC: from Windows, run `wsl -d HiveWorker -u root /usr/local/sbin/hive-devices`", d.Path, d.Group)
	case !d.KVM:
		return fmt.Sprintf("%s belongs to group %s, not kvm: run `sudo chgrp kvm %s`", d.Path, d.Group, d.Path)
	case d.Listed && !d.Holds:
		return fmt.Sprintf("your user's services started before your user joined the kvm group, so cannot open %s: run `sudo systemctl restart user@%d`, or restart the machine", d.Path, d.UID)
	default:
		return fmt.Sprintf("your user cannot open %s: run `sudo usermod -aG kvm $USER`, then log out and back in", d.Path)
	}
}
