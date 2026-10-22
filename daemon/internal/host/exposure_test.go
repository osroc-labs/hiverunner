package host

import (
	"net"
	"strings"
	"testing"
)

func TestSSHTakesPasswordsEitherWay(t *testing.T) {
	for settings, want := range map[string]bool{
		"": false,
		"port 22\npasswordauthentication yes\nkbdinteractiveauthentication no\n": true,
		"port 22\npasswordauthentication no\nkbdinteractiveauthentication yes\n": true,
		"port 22\npasswordauthentication no\nkbdinteractiveauthentication no\n":  false,
		// What an older sshd calls keyboard-interactive.
		"passwordauthentication no\nchallengeresponseauthentication yes\n": true,
		"permitemptypasswords yes\npasswordauthentication no\n":            false,
	} {
		if got := sshPasswords(settings); got != want {
			t.Errorf("%q: got %v, want %v", settings, got, want)
		}
	}
}

func TestTheMacFirewall(t *testing.T) {
	for said, want := range map[string][2]bool{
		"Firewall is enabled. (State = 1)\n":  {true, true},
		"Firewall is disabled. (State = 0)\n": {false, true},
		// Blocking every incoming connection is on too.
		"Firewall is blocking all non-essential incoming connections. (State = 2)\n": {true, true},
		"": {false, false},
	} {
		if on, known := firewallState(said); [2]bool{on, known} != want {
			t.Errorf("%q: got on %v known %v, want %v", said, on, known, want)
		}
	}
}

func TestAFirewallDropsWhatItDoesNotAccept(t *testing.T) {
	ufw := "table ip filter {\n\tchain INPUT {\n\t\ttype filter hook input priority filter; policy drop;\n\t\tcounter packets 0 bytes 0 jump ufw-before-logging-input\n\t}\n}\n"
	firewalld := "table inet firewalld {\n\tchain filter_INPUT {\n\t\ttype filter hook input priority filter + 10; policy accept;\n\t\tct state { established, related } accept\n\t\tjump filter_INPUT_ZONES\n\t\tct state { invalid } drop\n\t\treject with icmpx admin-prohibited\n\t}\n}\n"
	docker := "table ip filter {\n\tchain DOCKER {\n\t}\n\tchain INPUT {\n\t\ttype filter hook input priority filter; policy accept;\n\t}\n\tchain FORWARD {\n\t\ttype filter hook forward priority filter; policy drop;\n\t\tcounter packets 0 bytes 0 jump DOCKER\n\t}\n}\n"
	tailscale := "table ip filter {\n\tchain INPUT {\n\t\ttype filter hook input priority filter; policy accept;\n\t\tcounter packets 0 bytes 0 jump ts-input\n\t}\n\tchain ts-input {\n\t\tiifname != \"tailscale0\" ip saddr 100.64.0.0/10 counter packets 0 bytes 0 drop\n\t}\n}\n"
	debian := "table inet filter {\n\tchain input {\n\t\ttype filter hook input priority filter; policy accept;\n\t}\n}\n"
	for name, c := range map[string]struct {
		ruleset string
		want    bool
	}{
		"ufw": {ufw, true}, "firewalld": {firewalld, true}, "nothing": {"", false},
		"Docker's": {docker, false}, "Tailscale's": {tailscale, false}, "Debian's empty one": {debian, false},
	} {
		if got := inputFiltered(c.ruleset); got != c.want {
			t.Errorf("%s: got %v, want %v", name, got, c.want)
		}
	}
}

func TestOnlyWhatListensForOtherMachinesIsShared(t *testing.T) {
	netstat := `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)
tcp4       0      0  10.0.0.5.51785         17.253.23.201.443      ESTABLISHED
tcp4       0      0  127.0.0.1.5037         *.*                    LISTEN
tcp6       0      0  ::1.631                *.*                    LISTEN
tcp6       0      0  fe80::1%lo0.8021       *.*                    LISTEN
tcp4       0      0  *.22                   *.*                    LISTEN
tcp6       0      0  *.7000                 *.*                    LISTEN
tcp4       0      0  10.0.0.5.445           *.*                    LISTEN
`
	if got := netstatListening(netstat); len(got) != 3 || !got[22] || !got[7000] || !got[445] {
		t.Errorf("netstat: got %v, want 22, 445 and 7000", got)
	}

	tcp := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000 100 0 0 10 0
   1: 0100007F:0277 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 2 1 0000000000000000 100 0 0 10 0
   2: 0500000A:01BD 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3 1 0000000000000000 100 0 0 10 0
   3: 0500000A:D2A4 0100A8C0:01BB 01 00000000:00000000 00:00000000 00000000  1000        0 4 1 0000000000000000 100 0 0 10 0
`
	if got := procListening(tcp); len(got) != 2 || !got[22] || !got[445] {
		t.Errorf("tcp: got %v, want 22 and 445", got)
	}
	tcp6 := `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:0019 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 5 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:170C 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 6 1 0000000000000000 100 0 0 10 0
`
	if got := procListening(tcp6); len(got) != 1 || !got[5900] {
		t.Errorf("tcp6: got %v, want 5900", got)
	}

	services := []service{{"Screen Sharing", 5900}, {"File Sharing", 445}}
	if got := sharing(map[int]bool{22: true}, services, "fix"); len(got) != 1 || !got[0].OK {
		t.Errorf("only ssh listening: got %+v", got)
	}
	got := sharing(map[int]bool{445: true, 5900: true}, services, "fix")
	if len(got) != 1 || got[0].OK || !got[0].Note || got[0].Found != "Screen Sharing, File Sharing listening" || got[0].Fix != "fix" {
		t.Errorf("both listening: got %+v", got)
	}
}

func TestANetworkWithOtherMachinesOnIsSaid(t *testing.T) {
	address := func(ip string) net.Addr { return &net.IPNet{IP: net.ParseIP(ip), Mask: net.CIDRMask(32, 32)} }
	addresses := []net.Addr{address("127.0.0.1"), address("100.104.79.38"), address("192.168.1.20")}

	got := network(addresses, net.ParseIP("192.168.1.20"))
	if len(got) != 1 || got[0].OK || !got[0].Note || !strings.Contains(got[0].Found, "a tailnet (100.104.79.38) and a private LAN (192.168.1.20)") ||
		!strings.Contains(got[0].Fix, "tailnet's policy") || !strings.Contains(got[0].Fix, "network of its own") {
		t.Errorf("tailnet and LAN: got %+v", got)
	}
	// Out through a tailnet's exit node is the tailnet, not a LAN.
	if got := network(addresses[:2], net.ParseIP("100.104.79.38")); len(got) != 1 || strings.Contains(got[0].Found, "LAN") || !strings.Contains(got[0].Found, "tailnet") {
		t.Errorf("exit node: got %+v", got)
	}
	if got := network([]net.Addr{address("203.0.113.7")}, net.ParseIP("203.0.113.7")); len(got) != 1 || !got[0].OK {
		t.Errorf("public address: got %+v", got)
	}
	if got := network(nil, nil); len(got) != 0 {
		t.Errorf("no network at all: got %+v", got)
	}
}
