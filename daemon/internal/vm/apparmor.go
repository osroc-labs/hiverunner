package vm

import (
	"errors"
	"fmt"
	"io/fs"
	"strings"
)

// AppArmorProfile is the name of the profile that lets Hive Runner's own
// virtiofsd make the user namespace it sandboxes itself in.
const AppArmorProfile = "hiverunner-virtiofsd"

// appArmorBlocks is why AppArmor will stop virtiofsd, after a colon what to
// run, or "" if it will not. Ubuntu 24.04 and later forbid unprivileged
// programs a user namespace unless a profile allows them one, and virtiofsd
// cannot share a job's directory without it: it fails with "Error entering
// sandbox: CleanMount(PermissionDenied)". Only the copy the installer puts
// under the user's home is asked about: a distribution's own virtiofsd is
// its packager's to allow.
//
// read is os.ReadFile and list os.ReadDir, given here so a test can be any
// machine.
func appArmorBlocks(virtiofsd, bundled string, read func(string) ([]byte, error), list func(string) ([]fs.DirEntry, error)) string {
	if virtiofsd == "" || virtiofsd != bundled {
		return ""
	}
	restricted, err := read("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
	if err != nil || strings.TrimSpace(string(restricted)) != "1" {
		return ""
	}
	// What is loaded, where this user may read it. Not every kernel lets
	// anyone but root, and then a profile on disk is taken to be loaded.
	loaded, err := read("/sys/kernel/security/apparmor/profiles")
	known := err == nil
	if known && strings.Contains(string(loaded), AppArmorProfile+" ") {
		return ""
	}
	const dir = "/etc/apparmor.d/"
	if _, err := read(dir + AppArmorProfile); !errors.Is(err, fs.ErrNotExist) {
		if !known {
			return ""
		}
		return "AppArmor has not loaded " + dir + AppArmorProfile + ", so virtiofsd cannot make the user namespace it needs and jobs cannot start: run `sudo apparmor_parser -r " + dir + AppArmorProfile + "`"
	}
	// A profile of the owner's own that names this virtiofsd is theirs to
	// have got right.
	entries, _ := list(dir)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if body, err := read(dir + entry.Name()); err == nil && strings.Contains(string(body), virtiofsd) {
			return ""
		}
	}
	return "AppArmor stops virtiofsd making the user namespace it needs, so jobs cannot start: run " + AppArmorFix(virtiofsd)
}

// AppArmorFix is the command that allows virtiofsd at this path a user
// namespace, and nothing else it would not have had: the profile is
// unconfined, and exists only to say so.
func AppArmorFix(virtiofsd string) string {
	profile := fmt.Sprintf(`abi <abi/4.0>,\ninclude <tunables/global>\nprofile %s "%s" flags=(unconfined) {\n  userns,\n  include if exists <local/%s>\n}\n`, AppArmorProfile, virtiofsd, AppArmorProfile)
	file := "/etc/apparmor.d/" + AppArmorProfile
	return fmt.Sprintf("`printf '%s' | sudo tee %s >/dev/null && sudo apparmor_parser -r %s`", profile, file, file)
}
