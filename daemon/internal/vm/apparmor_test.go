package vm

import (
	"io/fs"
	"os"
	"strings"
	"testing"
	"time"
)

func TestAppArmorIsBlamedOnlyWhereItWouldStopVirtiofsd(t *testing.T) {
	const bundled = "/home/ada/.config/HiveWorker/bin/virtiofsd"
	machine := func(files map[string]string, unreadable ...string) (func(string) ([]byte, error), func(string) ([]fs.DirEntry, error)) {
		read := func(path string) ([]byte, error) {
			for _, hidden := range unreadable {
				if path == hidden {
					return nil, os.ErrPermission
				}
			}
			if body, ok := files[path]; ok {
				return []byte(body), nil
			}
			return nil, os.ErrNotExist
		}
		list := func(dir string) ([]fs.DirEntry, error) {
			var entries []fs.DirEntry
			for path := range files {
				if name, ok := strings.CutPrefix(path, dir); ok {
					entries = append(entries, fs.FileInfoToDirEntry(file(name)))
				}
			}
			return entries, nil
		}
		return read, list
	}
	const restrict = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns"
	const loaded = "/sys/kernel/security/apparmor/profiles"
	const onDisk = "/etc/apparmor.d/" + AppArmorProfile
	for _, test := range []struct {
		name       string
		virtiofsd  string
		files      map[string]string
		unreadable []string
		blocked    bool
	}{
		{"Ubuntu 26.04, nothing done yet", bundled, map[string]string{restrict: "1\n", loaded: "snap.firefox (enforce)\n"}, nil, true},
		{"the profile is loaded", bundled, map[string]string{restrict: "1\n", loaded: AppArmorProfile + " (unconfined)\n"}, nil, false},
		{"the profile is on disk but not loaded", bundled, map[string]string{restrict: "1\n", loaded: "", onDisk: "x"}, nil, true},
		{"what is loaded cannot be read, and the profile is on disk", bundled, map[string]string{restrict: "1\n", onDisk: "x"}, []string{loaded}, false},
		{"what is loaded cannot be read, and there is no profile", bundled, map[string]string{restrict: "1\n"}, []string{loaded}, true},
		{"a profile of the owner's own names it", bundled, map[string]string{restrict: "1\n", loaded: "", "/etc/apparmor.d/mine": "profile mine " + bundled + " flags=(unconfined) { userns, }"}, nil, false},
		{"the profile cannot be read but is there", bundled, map[string]string{restrict: "1\n", onDisk: ""}, []string{loaded, onDisk}, false},
		{"user namespaces are not restricted", bundled, map[string]string{restrict: "0\n"}, nil, false},
		{"a kernel without the setting", bundled, map[string]string{}, nil, false},
		{"the distribution's own virtiofsd", "/usr/libexec/virtiofsd", map[string]string{restrict: "1\n"}, nil, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			read, list := machine(test.files, test.unreadable...)
			got := appArmorBlocks(test.virtiofsd, bundled, read, list)
			if (got != "") != test.blocked {
				t.Fatalf("said %q; want blocked=%v", got, test.blocked)
			}
			if !test.blocked {
				return
			}
			// status and doctor show what follows the first colon as the fix.
			_, fix, ok := strings.Cut(got, ": ")
			wants := []string{"sudo tee /etc/apparmor.d/" + AppArmorProfile, "sudo apparmor_parser -r", `"` + bundled + `"`, "userns,", "flags=(unconfined)"}
			if _, there := test.files[onDisk]; there {
				// Written already, only not loaded.
				wants = []string{"`sudo apparmor_parser -r " + onDisk + "`"}
				if !strings.HasPrefix(got, "AppArmor has not loaded") {
					t.Errorf("%q does not say the profile is not loaded", got)
				}
			}
			for _, want := range wants {
				if !ok || !strings.Contains(fix, want) {
					t.Errorf("the fix %q lacks %q", fix, want)
				}
			}
		})
	}
}

// file is a plain file of that name, for a listing.
type file string

func (f file) Name() string       { return string(f) }
func (f file) Size() int64        { return 0 }
func (f file) Mode() fs.FileMode  { return 0o644 }
func (f file) ModTime() time.Time { return time.Time{} }
func (f file) IsDir() bool        { return false }
func (f file) Sys() any           { return nil }
