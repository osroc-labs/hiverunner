package host

import (
	"encoding/hex"
	"net"
	"strconv"
	"strings"
)

// What follows reads how exposed a machine is to the jobs it runs and to its
// network. That is the owner's call as much as FileVault is, so every check
// is a Note, and what could not be read without asking for a password is
// not said at all. The readers take what a command printed, so that they
// can be tested on any system.

// tailnet is the range Tailscale gives its machines (CGNAT's).
var tailnet = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

// network is the network check: whether this machine is on a tailnet or a
// private LAN, whose other machines a job can reach as it can. outbound is
// the address it reaches the internet from, nil if it has none.
func network(addresses []net.Addr, outbound net.IP) []Check {
	var on, fixes []string
	for _, address := range addresses {
		if ip, ok := address.(*net.IPNet); ok && tailnet.Contains(ip.IP) {
			on = append(on, "a tailnet ("+ip.IP.String()+")")
			fixes = append(fixes, "tag it in the tailnet's policy, and let the tag reach nothing")
			break
		}
	}
	// A tailnet's address is not a LAN's, even when the tailnet is the way out.
	if outbound != nil && outbound.IsPrivate() {
		on = append(on, "a private LAN ("+outbound.String()+")")
		fixes = append(fixes, "lend it from a network of its own, such as a guest Wi-Fi or VLAN")
	}
	switch {
	case len(on) > 0:
		return []Check{{Name: "network", Found: "on " + strings.Join(on, " and ") + ", and a job can reach whatever this machine can there",
			Note: true, Fix: strings.Join(fixes, "; ")}}
	case outbound != nil:
		return []Check{{Name: "network", Found: "on no tailnet or private LAN", OK: true}}
	}
	return nil
}

// sharing is the sharing check from the TCP ports something listens on for
// other machines, and the services that would be listening on them.
func sharing(listening map[int]bool, services []service, fix string) []Check {
	var on []string
	for _, service := range services {
		if listening[service.port] {
			on = append(on, service.name)
		}
	}
	if len(on) == 0 {
		return []Check{{Name: "sharing", Found: "nothing listening", OK: true}}
	}
	return []Check{{Name: "sharing", Found: strings.Join(on, ", ") + " listening", Note: true, Fix: fix}}
}

// service is something that shares this machine, and the port it listens on.
type service struct {
	name string
	port int
}

// sshKeysOnly is how the owner stops sshd taking passwords. sshd keeps the
// first value it reads, and its own files in sshd_config.d come after this
// one.
const sshKeysOnly = "put PasswordAuthentication no and KbdInteractiveAuthentication no in /etc/ssh/sshd_config.d/00-keys-only.conf"

// sshPasswords reads what `sshd -T` prints, sshd's settings as it would use
// them, one lowercase keyword and its value a line: whether it lets someone
// in with a password, either by asking for one or through PAM.
func sshPasswords(settings string) bool {
	for _, line := range strings.Split(settings, "\n") {
		switch strings.TrimSpace(line) {
		case "passwordauthentication yes", "kbdinteractiveauthentication yes", "challengeresponseauthentication yes":
			return true
		}
	}
	return false
}

// firewallState reads `socketfilterfw --getglobalstate`: on is the macOS
// application firewall on, in either of its modes. known is false when it
// does not say.
func firewallState(said string) (on, known bool) {
	_, state, found := strings.Cut(said, "(State = ")
	if !found || state == "" {
		return false, false
	}
	return state[0] != '0', true
}

// inputFiltered reads `nft list ruleset`: whether a chain on the input hook
// drops what it does not accept, by its policy or by its last rule. Docker's
// and Tailscale's chains accept what they do not match, so they are no
// firewall.
func inputFiltered(ruleset string) bool {
	input, last := false, ""
	for _, line := range strings.Split(ruleset, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "chain "):
			input, last = false, ""
		case strings.HasPrefix(line, "type ") && strings.Contains(line, " hook input "):
			input = true
			if strings.Contains(line, "policy drop") {
				return true
			}
		case line == "}":
			if input && (strings.HasSuffix(last, " drop") || last == "drop" || strings.Contains(last, "reject")) {
				return true
			}
			input = false
		case input && line != "":
			last = line
		}
	}
	return false
}

// netstatListening reads macOS's `netstat -an -p tcp`: the ports something
// listens on for other machines, not on loopback alone.
func netstatListening(table string) map[int]bool {
	ports := map[int]bool{}
	for _, line := range strings.Split(table, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 6 || fields[5] != "LISTEN" {
			continue
		}
		// An address and its port are joined by the last dot.
		dot := strings.LastIndex(fields[3], ".")
		if dot < 0 {
			continue
		}
		// fe80::1%lo0 is loopback's link-local address.
		host, zone, _ := strings.Cut(fields[3][:dot], "%")
		if ip := net.ParseIP(host); zone == "lo0" || ip != nil && ip.IsLoopback() {
			continue
		}
		if port, err := strconv.Atoi(fields[3][dot+1:]); err == nil {
			ports[port] = true
		}
	}
	return ports
}

// procListening reads Linux's /proc/net/tcp or tcp6: the ports something
// listens on for other machines, not on loopback alone.
func procListening(table string) map[int]bool {
	ports := map[int]bool{}
	for _, line := range strings.Split(table, "\n") {
		fields := strings.Fields(line)
		// 0A is LISTEN.
		if len(fields) < 4 || fields[3] != "0A" {
			continue
		}
		address, hexPort, ok := strings.Cut(fields[1], ":")
		raw, err := hex.DecodeString(address)
		if !ok || err != nil || len(raw)%4 != 0 {
			continue
		}
		// The kernel prints the address as 32-bit words in its own order,
		// which on every machine hived runs on is little-endian.
		for word := 0; word < len(raw); word += 4 {
			raw[word], raw[word+1], raw[word+2], raw[word+3] = raw[word+3], raw[word+2], raw[word+1], raw[word]
		}
		if net.IP(raw).IsLoopback() {
			continue
		}
		if port, err := strconv.ParseInt(hexPort, 16, 32); err == nil {
			ports[int(port)] = true
		}
	}
	return ports
}

// outbound is the address this machine reaches the internet from, or nil
// if it cannot. Nothing is sent: a UDP socket only picks its route.
func outbound() net.IP {
	conn, err := net.Dial("udp4", "1.1.1.1:53")
	if err != nil {
		return nil
	}
	defer conn.Close()
	if address, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return address.IP
	}
	return nil
}
