package host

import (
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
)

// fake is a machine that answers the commands in said, and fails the rest.
type fake struct {
	said  map[string]string
	files map[string]string
	ran   []string
}

func (f *fake) system(sudoer bool, addresses ...address) system {
	return system{
		run: func(name string, args ...string) (string, error) {
			line := strings.Join(append([]string{name}, args...), " ")
			f.ran = append(f.ran, line)
			if out, ok := f.said[line]; ok {
				return out, nil
			}
			return "", errors.New("exit status 1")
		},
		read:      func(pattern string) string { return f.files[pattern] },
		addresses: addresses,
		user:      "ada",
		sudoer:    sudoer,
	}
}

func (f *fake) sudid() bool {
	for _, line := range f.ran {
		if strings.HasPrefix(line, "sudo ") {
			return true
		}
	}
	return false
}

func only(t *testing.T, checks []Check, name string) Check {
	t.Helper()
	var found []Check
	for _, check := range checks {
		if check.Name == name {
			found = append(found, check)
		}
	}
	if len(found) != 1 {
		t.Fatalf("%d %s checks in %+v", len(found), name, checks)
	}
	return found[0]
}

// listen is a /proc/net/tcp with something listening on each port, given in
// hex, on every address.
func listen(ports ...string) string {
	table := "  sl  local_address rem_address   st\n"
	for _, port := range ports {
		table += "   0: 00000000:" + port + " 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1\n"
	}
	return table
}

func TestSSHTakesPasswordsEitherWay(t *testing.T) {
	for settings, want := range map[string]bool{
		"": false,
		"port 22\npasswordauthentication yes\nkbdinteractiveauthentication no\n": true,
		"port 22\npasswordauthentication no\nkbdinteractiveauthentication yes\n": true,
		"port 22\npasswordauthentication no\nkbdinteractiveauthentication no\n":  false,
		// What an older sshd calls keyboard-interactive.
		"passwordauthentication no\nchallengeresponseauthentication yes\n": true,
		"permitemptypasswords yes\npasswordauthentication no\n":            false,
		// Methods that all have to succeed: a password alone is not enough.
		"passwordauthentication yes\nauthenticationmethods publickey\n":                                false,
		"passwordauthentication yes\nauthenticationmethods publickey,password\n":                       false,
		"passwordauthentication yes\nauthenticationmethods any\n":                                      true,
		"passwordauthentication yes\nauthenticationmethods publickey password\n":                       true,
		"kbdinteractiveauthentication yes\nauthenticationmethods keyboard-interactive:pam\n":           true,
		"passwordauthentication no\nkbdinteractiveauthentication no\nauthenticationmethods password\n": false,
	} {
		if got := sshPasswords(settings); got != want {
			t.Errorf("%q: got %v, want %v", settings, got, want)
		}
	}
}

func TestSSHPortsAreWhatSSHDAndLaunchdSay(t *testing.T) {
	if got := fmt.Sprint(sshPorts("port 2222\nport 22\nlistenaddress [::]:2222\nlistenaddress 0.0.0.0:2200\npasswordauthentication no\n")); got != "[2222 22 2222 2200]" {
		t.Errorf("sshd: got %v", got)
	}
	job := "system/com.openssh.sshd = {\n\tsockets = {\n\t\t\"Listeners\" = {\n\t\t\ttype = stream\n\t\t\tservice name = ssh\n\t\t}\n\t\t\"Other\" = {\n\t\t\tservice name = 2222\n\t\t}\n\t}\n}\n"
	if got := fmt.Sprint(launchdPorts(job)); got != "[22 2222]" {
		t.Errorf("launchd: got %v", got)
	}
	if sshMatches("#Match User anoncvs\nPasswordAuthentication no\n") || !sshMatches("PasswordAuthentication no\n  match Address 10.0.0.0/8\n") {
		t.Error("a Match block was misread")
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
	chain := func(family, body string) string {
		return "table " + family + " filter {\n\tchain INPUT {\n" + body + "\t}\n}\n"
	}
	drop := "\t\ttype filter hook input priority filter; policy drop;\n"
	accept := "\t\ttype filter hook input priority filter; policy accept;\n"
	for name, c := range map[string]struct {
		ruleset string
		v4, v6  bool
	}{
		"nothing":                 {"", false, false},
		"ufw, both families":      {chain("ip", drop+"\t\tcounter packets 0 bytes 0 jump ufw-before-input\n") + chain("ip6", drop), true, true},
		"IPv4 alone":              {chain("ip", drop), true, false},
		"inet":                    {chain("inet", drop), true, true},
		"firewalld's last reject": {"table inet firewalld {\n\tchain filter_INPUT {\n\t\ttype filter hook input priority filter + 10; policy accept;\n\t\tct state { established, related } accept\n\t\tjump filter_INPUT_ZONES\n\t\tct state { invalid } drop\n\t\treject with icmpx admin-prohibited\n\t}\n}\n", true, true},
		"a last counted drop":     {chain("inet", accept+"\t\tiifname \"lo\" accept\n\t\tcounter packets 3 bytes 180 drop\n"), true, true},
		"Docker's":                {"table ip filter {\n\tchain DOCKER {\n\t}\n\tchain INPUT {\n" + accept + "\t}\n\tchain FORWARD {\n\t\ttype filter hook forward priority filter; policy drop;\n\t\tcounter packets 0 bytes 0 jump DOCKER\n\t}\n}\n", false, false},
		"Tailscale's":             {chain("ip", accept+"\t\tcounter packets 0 bytes 0 jump ts-input\n") + "table ip ts {\n\tchain ts-input {\n\t\tiifname != \"tailscale0\" ip saddr 100.64.0.0/10 counter packets 0 bytes 0 drop\n\t}\n}\n", false, false},
		"Debian's empty one":      {chain("inet", accept), false, false},
		// What blocks some addresses or ports, and lets the rest in.
		"fail2ban's":     {"table inet f2b-table {\n\tset addr-set-sshd {\n\t\ttype ipv4_addr\n\t}\n\tchain f2b-chain {\n\t\ttype filter hook input priority filter - 1; policy accept;\n\t\ttcp dport 22 ip saddr @addr-set-sshd reject\n\t}\n}\n", false, false},
		"CrowdSec's":     {chain("ip", accept+"\t\tip saddr @crowdsec-blacklists counter packets 9 bytes 540 drop\n"), false, false},
		"one port":       {chain("inet", accept+"\t\ttcp dport 25 reject\n"), false, false},
		"invalid states": {chain("inet", accept+"\t\tct state invalid drop\n"), false, false},
		// A map over several lines does not end the chain.
		"a vmap, then a drop": {chain("inet", accept+"\t\ttcp dport vmap {\n\t\t\t22 : accept,\n\t\t\t80 : accept\n\t\t}\n\t\tdrop\n"), true, true},
	} {
		if v4, v6 := nftFilters(c.ruleset); v4 != c.v4 || v6 != c.v6 {
			t.Errorf("%s: got %v, %v; want %v, %v", name, v4, v6, c.v4, c.v6)
		}
	}

	for rules, want := range map[string]bool{
		"-P INPUT DROP\n-A INPUT -i lo -j ACCEPT\n":                                                           true,
		"-P INPUT ACCEPT\n-A INPUT -i lo -j ACCEPT\n-A INPUT -j REJECT --reject-with icmp-port-unreachable\n": true,
		"-P INPUT ACCEPT\n-A INPUT -p tcp --dport 25 -j DROP\n":                                               false,
		"-P INPUT ACCEPT\n": false,
	} {
		if got := legacyFilters(rules); got != want {
			t.Errorf("legacy %q: got %v, want %v", rules, got, want)
		}
	}
	if !ufwDrops("ENABLED=yes\n", `DEFAULT_INPUT_POLICY="DROP"`) || ufwDrops("ENABLED=yes\n", `DEFAULT_INPUT_POLICY="ACCEPT"`) || ufwDrops("ENABLED=no\n", `DEFAULT_INPUT_POLICY="DROP"`) {
		t.Error("ufw misread")
	}
}

func TestLinuxFirewallReadsWhatItMay(t *testing.T) {
	// ufw is said without sudo.
	f := &fake{files: map[string]string{"/etc/ufw/ufw.conf": "ENABLED=yes\n", "/etc/default/ufw": `DEFAULT_INPUT_POLICY="DROP"`}}
	if got := f.system(true).linuxFirewall(); len(got) != 1 || !got[0].OK || f.sudid() {
		t.Errorf("ufw: got %+v, ran %q", got, f.ran)
	}
	// Nobody who may not use sudo is made to try.
	f = &fake{}
	if got := f.system(false).linuxFirewall(); len(got) != 0 || f.sudid() {
		t.Errorf("no sudo: got %+v, ran %q", got, f.ran)
	}
	// sudo that wants a password: nothing said.
	if got := (&fake{}).system(true).linuxFirewall(); len(got) != 0 {
		t.Errorf("sudo refused: got %+v", got)
	}
	// fail2ban alone is no firewall.
	f = &fake{said: map[string]string{"sudo -n nft -t list ruleset": "table inet f2b-table {\n\tchain f2b-chain {\n\t\ttype filter hook input priority filter - 1; policy accept;\n\t\ttcp dport 22 ip saddr @addr-set-sshd reject\n\t}\n}\n"}}
	if got := f.system(true).linuxFirewall(); len(got) != 1 || got[0].OK || !got[0].Note {
		t.Errorf("fail2ban: got %+v", got)
	}
	// A legacy IPv4 policy that drops, loaded, and nothing for IPv6.
	f = &fake{
		said:  map[string]string{"sudo -n nft -t list ruleset": "", "sudo -n iptables-legacy -S INPUT": "-P INPUT DROP\n"},
		files: map[string]string{"/proc/modules": "iptable_filter 12288 1 - Live 0x0\nip_tables 32768 1 iptable_filter, Live 0x0\n"},
	}
	got := f.system(true).linuxFirewall()
	if len(got) != 1 || got[0].OK || got[0].Found != "IPv4 is filtered, and IPv6 is not" {
		t.Errorf("legacy IPv4: got %+v", got)
	}
	for _, line := range f.ran {
		if strings.Contains(line, "ip6tables-legacy") {
			t.Errorf("listed a legacy table that was not loaded: %q", line)
		}
	}
}

func TestSSHIsFoundWhereverItListens(t *testing.T) {
	// On 2222, said by sshd -G with no root, and taking passwords.
	f := &fake{
		said:  map[string]string{sshd + " -G": "port 2222\npasswordauthentication yes\n"},
		files: map[string]string{"/proc/net/tcp": listen("08AE")},
	}
	if ssh := only(t, f.system(false).linux(), "ssh"); ssh.OK || !ssh.Note || ssh.Found != "sshd is on and takes passwords" {
		t.Errorf("port 2222: got %+v", ssh)
	}
	// Nothing on its port.
	f.files["/proc/net/tcp"] = listen("0016")
	if ssh := only(t, f.system(false).linux(), "ssh"); !ssh.OK || ssh.Found != "sshd is not listening" {
		t.Errorf("not listening: got %+v", ssh)
	}
	// Its settings unread, all that can be said is of port 22.
	if ssh := only(t, (&fake{}).system(false).linux(), "ssh"); !ssh.OK || ssh.Found != "nothing listens on port 22" {
		t.Errorf("unread: got %+v", ssh)
	}

	// A Mac's Remote Login is on launchd's port, and with neither sshd -G
	// nor sudo it is still said.
	f = &fake{said: map[string]string{
		"/usr/sbin/netstat -an -p tcp":                 "tcp4  0  0  *.2222  *.*  LISTEN\n",
		"/bin/launchctl print system/com.openssh.sshd": "\t\t\tservice name = 2222\n",
	}}
	if ssh := only(t, f.system(true).mac(), "ssh"); ssh.OK || !ssh.Note || !strings.Contains(ssh.Found, "could not read") || !strings.Contains(ssh.Fix, "Remote Login off") {
		t.Errorf("unread: got %+v", ssh)
	}
	f.said["/usr/sbin/netstat -an -p tcp"] = "tcp4  0  0  *.22  *.*  LISTEN\n"
	if ssh := only(t, f.system(true).mac(), "ssh"); !ssh.OK || ssh.Found != "Remote Login is off" {
		t.Errorf("off: got %+v", ssh)
	}
	// sudo, where -G is not there.
	f.said["/usr/sbin/netstat -an -p tcp"] = "tcp4  0  0  *.2222  *.*  LISTEN\n"
	f.said["sudo -n "+sshd+" -T"] = "passwordauthentication no\nkbdinteractiveauthentication no\n"
	if ssh := only(t, f.system(true).mac(), "ssh"); !ssh.OK || ssh.Found != "Remote Login takes keys only" {
		t.Errorf("keys only: got %+v", ssh)
	}
}

func TestAMatchBlockIsAskedAbout(t *testing.T) {
	keys := "port 22\npasswordauthentication no\nkbdinteractiveauthentication no\n"
	config := "PasswordAuthentication no\nMatch Address 10.0.0.0/8,192.168.0.0/16\n\tPasswordAuthentication yes\n"
	f := &fake{
		said: map[string]string{
			"sudo -n " + sshd + " -T": keys,
			"sudo -n " + sshd + " -T -C user=ada,host=probe,addr=192.168.1.10": "port 22\npasswordauthentication yes\n",
		},
		files: map[string]string{"/proc/net/tcp": listen("0016"), "/etc/ssh/sshd_config": config},
	}
	if ssh := only(t, f.system(true).linux(), "ssh"); ssh.OK || !strings.Contains(ssh.Found, "from 192.168.1.10") {
		t.Errorf("LAN passwords: got %+v", ssh)
	}
	// Without root the block cannot be asked about, and the OK says so.
	f.said[sshd+" -G"] = keys
	if ssh := only(t, f.system(false).linux(), "ssh"); !ssh.OK || ssh.Found != "sshd takes keys only, outside its Match blocks" {
		t.Errorf("unasked: got %+v", ssh)
	}
	// No Match block, nothing to ask.
	f.files["/etc/ssh/sshd_config"] = "PasswordAuthentication no\n"
	if ssh := only(t, f.system(false).linux(), "ssh"); ssh.Found != "sshd takes keys only" {
		t.Errorf("plain: got %+v", ssh)
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
	// A Mac's Remote Management, Remote Apple Events and Printer Sharing.
	f := &fake{said: map[string]string{"/usr/sbin/netstat -an -p tcp": "tcp4  0  0  *.3283  *.*  LISTEN\ntcp4  0  0  *.3031  *.*  LISTEN\ntcp6  0  0  *.631  *.*  LISTEN\n"}}
	if shared := only(t, f.system(false).mac(), "sharing"); shared.Found != "Remote Management, Printer Sharing, Remote Apple Events listening" {
		t.Errorf("Mac sharing: got %+v", shared)
	}
}

func TestANetworkWithOtherMachinesOnIsSaid(t *testing.T) {
	at := func(iface, ip string) address { return address{iface, net.ParseIP(ip)} }

	got := network([]address{at("lo0", "127.0.0.1"), at("utun4", "100.104.79.38"), at("utun4", "fd7a:115c:a1e0::1"), at("en0", "192.168.1.20"), at("en0", "fe80::1")})
	if len(got) != 1 || got[0].OK || !got[0].Note || !strings.Contains(got[0].Found, "a CGNAT or tailnet address (100.104.79.38 on utun4, fd7a:115c:a1e0::1 on utun4) and a private network (192.168.1.20 on en0)") ||
		!strings.Contains(got[0].Fix, "tailnet's policy") || !strings.Contains(got[0].Fix, "network of its own") {
		t.Errorf("tailnet and LAN: got %+v", got)
	}
	// A server with a public address on its way out and a private one on
	// the side.
	if got := network([]address{at("eth0", "203.0.113.7"), at("eth1", "10.0.0.2")}); len(got) != 1 || got[0].OK || !strings.Contains(got[0].Found, "10.0.0.2 on eth1") {
		t.Errorf("VPC: got %+v", got)
	}
	// An IPv6 LAN of unique local addresses.
	if got := network([]address{at("eth0", "fd12:3456::7")}); len(got) != 1 || got[0].OK {
		t.Errorf("ULA: got %+v", got)
	}
	if got := network([]address{at("eth0", "203.0.113.7")}); len(got) != 1 || !got[0].OK {
		t.Errorf("public address: got %+v", got)
	}
	if got := network([]address{at("lo", "127.0.0.1")}); len(got) != 0 {
		t.Errorf("no network at all: got %+v", got)
	}
	// A Mac's own VMs are behind a bridge, which is not a LAN.
	if network := only(t, (&fake{}).system(false, at("bridge100", "192.168.64.1"), at("en0", "203.0.113.7")).mac(), "network"); !network.OK {
		t.Errorf("VM bridge: got %+v", network)
	}
}
