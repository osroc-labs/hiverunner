package config

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveLoadRemove(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "machine.json")
	t.Setenv("HIVE_CONFIG", path)

	if _, err := Load(); !errors.Is(err, ErrNotEnrolled) {
		t.Fatalf("Load() before enrolling: %v", err)
	}
	want := Machine{Server: "https://example.test", MachineID: "m", Token: "hwm_secret"}
	if err := Save(want); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("machine file mode is %o, want 600", mode)
	}
	got, err := Load()
	if err != nil || got != want {
		t.Fatalf("Load() = %+v, %v", got, err)
	}
	if err := Remove(); err != nil {
		t.Fatal(err)
	}
	if err := Remove(); err != nil {
		t.Fatalf("Remove() twice: %v", err)
	}
	if _, err := Load(); !errors.Is(err, ErrNotEnrolled) {
		t.Fatalf("Load() after Remove: %v", err)
	}
}
