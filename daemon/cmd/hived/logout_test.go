package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/thecomputerplumbers/hiverunner/daemon/internal/config"
)

func TestLogoutRevokeRetiresTheTokenBeforeForgettingIt(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		kept   bool
	}{
		{"the server retires it", http.StatusOK, false},
		{"the server had already", http.StatusUnauthorized, false},
		{"the server could not be told", http.StatusBadGateway, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var bearer string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/machines/retire" || r.Method != http.MethodPost {
					t.Errorf("asked %s %s", r.Method, r.URL.Path)
				}
				bearer = r.Header.Get("Authorization")
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(`{}`))
			}))
			defer server.Close()
			file := filepath.Join(t.TempDir(), "machine.json")
			t.Setenv("HIVE_CONFIG", file)
			if err := config.Save(config.Machine{Server: server.URL, MachineID: "m-1", Token: "hwm_secret"}); err != nil {
				t.Fatal(err)
			}
			err := logout(context.Background(), []string{"--revoke"})
			if bearer != "Bearer hwm_secret" {
				t.Errorf("asked with %q; want the machine's own token", bearer)
			}
			_, missing := os.Stat(file)
			if kept := missing == nil; kept != test.kept {
				t.Fatalf("token kept = %v, want %v (logout said %v)", kept, test.kept, err)
			}
			if (err != nil) != test.kept {
				t.Fatalf("logout said %v", err)
			}
		})
	}
}

func TestLogoutWithoutRevokeAsksNothing(t *testing.T) {
	file := filepath.Join(t.TempDir(), "machine.json")
	t.Setenv("HIVE_CONFIG", file)
	if err := config.Save(config.Machine{Server: "http://127.0.0.1:1", MachineID: "m-1", Token: "hwm_secret"}); err != nil {
		t.Fatal(err)
	}
	if err := logout(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("the token was not forgotten")
	}
	if err := logout(context.Background(), []string{"--everywhere"}); err == nil {
		t.Fatal("an unknown flag was taken")
	}
}
