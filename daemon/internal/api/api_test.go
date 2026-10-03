package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// server answers each path from a queue of canned responses.
func server(t *testing.T, routes map[string][]func(http.ResponseWriter, *http.Request)) *Client {
	t.Helper()
	calls := map[string]int{}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlers := routes[r.URL.Path]
		i := calls[r.URL.Path]
		calls[r.URL.Path]++
		if i >= len(handlers) {
			t.Errorf("unexpected call %d to %s", i+1, r.URL.Path)
			w.WriteHeader(500)
			return
		}
		handlers[i](w, r)
	}))
	t.Cleanup(s.Close)
	return New(s.URL + "/")
}

func reply(status int, body any) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}
}

func TestDeviceSignInThenEnroll(t *testing.T) {
	var bearer string
	c := server(t, map[string][]func(http.ResponseWriter, *http.Request){
		"/api/auth/device/code": {reply(200, map[string]any{
			"device_code": "dc", "user_code": "ABCD", "verification_uri_complete": "/device?user_code=ABCD",
			"expires_in": 600, "interval": 0,
		})},
		"/api/auth/device/token": {
			reply(400, map[string]string{"error": "authorization_pending"}),
			reply(200, map[string]string{"access_token": "session-token"}),
		},
		"/api/machines": {func(w http.ResponseWriter, r *http.Request) {
			bearer = r.Header.Get("Authorization")
			reply(201, Enrollment{MachineID: "m", OrganizationID: "gh-1", Token: "hwm_x", TunnelURL: "wss://c/v1/tunnel"})(w, r)
		}},
	})
	ctx := context.Background()
	code, err := c.StartDevice(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if want := c.Server + "/device?user_code=ABCD"; code.VerificationURIComplete != want {
		t.Errorf("link = %q, want %q", code.VerificationURIComplete, want)
	}
	code.Interval = 0 // Do not make the test wait.
	token, err := c.AwaitToken(ctx, code)
	if err != nil || token != "session-token" {
		t.Fatalf("AwaitToken() = %q, %v", token, err)
	}
	enrollment, err := c.Enroll(ctx, token, Machine{Name: "mac"})
	if err != nil || enrollment.Token != "hwm_x" {
		t.Fatalf("Enroll() = %+v, %v", enrollment, err)
	}
	if bearer != "Bearer session-token" {
		t.Errorf("Authorization = %q", bearer)
	}
}

func TestASignInLinkToAnotherSiteIsRefused(t *testing.T) {
	c := server(t, map[string][]func(http.ResponseWriter, *http.Request){
		"/api/auth/device/code": {reply(200, map[string]any{
			"device_code": "dc", "user_code": "ABCD",
			"verification_uri_complete": "https://evil.example/device?user_code=ABCD",
			"expires_in":                600,
		})},
	})
	if _, err := c.StartDevice(context.Background()); err == nil {
		t.Fatal("StartDevice() accepted a link to another host")
	}
}

func TestDenialAndExpiryEndTheWait(t *testing.T) {
	for refusal, want := range map[string]error{"access_denied": ErrDenied, "expired_token": ErrExpired} {
		c := server(t, map[string][]func(http.ResponseWriter, *http.Request){
			"/api/auth/device/token": {reply(400, map[string]string{"error": refusal})},
		})
		_, err := c.AwaitToken(context.Background(), DeviceCode{DeviceCode: "dc", ExpiresIn: 600})
		if !errors.Is(err, want) {
			t.Errorf("%s: got %v, want %v", refusal, err, want)
		}
	}
}

func TestEnrollSurfacesThePoolChoiceAndRefusals(t *testing.T) {
	c := server(t, map[string][]func(http.ResponseWriter, *http.Request){
		"/api/machines": {
			reply(409, map[string]any{"code": "CHOOSE_POOL", "pools": []Pool{{ID: "gh-1", Name: "acme"}, {ID: "gh-2", Name: "globex"}}}),
			reply(403, map[string]any{"code": "FORBIDDEN", "error": "You cannot add machines to this pool."}),
			reply(400, map[string]any{"code": "INVALID_INPUT", "error": "This machine cannot be enrolled", "fields": map[string]string{"os": "Apple Silicon only"}}),
		},
	})
	ctx := context.Background()

	var choose *ChoosePoolError
	if _, err := c.Enroll(ctx, "t", Machine{}); !errors.As(err, &choose) || len(choose.Pools) != 2 {
		t.Fatalf("want a pool choice, got %v", err)
	}
	var refusal *Error
	if _, err := c.Enroll(ctx, "t", Machine{}); !errors.As(err, &refusal) || refusal.Status != 403 {
		t.Fatalf("want a 403, got %v", err)
	}
	if _, err := c.Enroll(ctx, "t", Machine{}); !errors.As(err, &refusal) || refusal.Fields["os"] == "" {
		t.Fatalf("want field errors, got %v", err)
	}
}
