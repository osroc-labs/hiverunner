package host

import (
	"context"
	"encoding/hex"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// What follows reads how exposed a machine is to the jobs it runs and to its
// network. That is the owner's call as much as FileVault is, so every check
// is a Note. sudo is only ever run with -n, which never asks for a password,
// and what it would take a password to read is said to be unread, or not
// said. Everything is read through a system, so that tests can stand in for
// the machine, and the readers are tested on any system.

// system is how the checks reach a machine: the commands they run, the
// files they read and what they know of it.
type system struct {
	run func(name string, args ...string) (string, error)
	// read is every file a pattern matches, one after another, or "".
	read      func(pattern string) string
	addresses []address
	user      string
	// sudoer is whether the user may use sudo at all. sudo -n is not tried
	// otherwise, so as not to fill the auth log with refusals.
	sudoer bool
}

// address is one of the machine's addresses, and the interface it is on.
type address struct {
	iface string
	ip    net.IP
}

// local is this machine.
func local() system {
	s := system{run: command, read: readAll, user: os.Getenv("USER")}
	groups, _ := command("id", "-Gn")
	for _, group := range strings.Fields(groups) {
		switch group {
		case "admin", "sudo", "wheel", "root":
			s.sudoer = true
		}
	}
	interfaces, _ := net.Interfaces()
	for _, iface := range interfaces {
		addresses, _ := iface.Addrs()
		for _, a := range addresses {
			if ip, ok := a.(*net.IPNet); ok {
				s.addresses = append(s.addresses, address{iface.Name, ip.IP})
			}
		}
	}
	return s
}

// command runs a program and gives what it printed. None of these should
// take long, so one that does is given up on.
func command(name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	return string(out), err
}

func readAll(pattern string) string {
	paths, _ := filepath.Glob(pattern)
	var all strings.Builder
	for _, path := range paths {
		raw, _ := os.ReadFile(path)
		all.Write(raw)
		all.WriteString("\n")
	}
	return all.String()
}

// mac is what a Mac leaves open.
func (s system) mac() []Check {
	var checks []Check
	said, _ := s.run("/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate")
	switch on, known := firewallState(said); {
	case on:
		checks = append(checks, Check{Name: "firewall", Found: "on", OK: true})
	case known:
		checks = append(checks, Check{Name: "firewall", Found: "off: whatever listens on this Mac answers its network", Note: true, Fix: "turn it on in System Settings > Network > Firewall"})
	}

	if table, err := s.run("/usr/sbin/netstat", "-an", "-p", "tcp"); err == nil {
		listening := netstatListening(table)
		// launchd listens for sshd, on the port its job names, whatever
		// sshd_config says.
		job, _ := s.run("/bin/launchctl", "print", "system/com.openssh.sshd")
		checks = append(checks, s.ssh("Remote Login", "Remote Login is off", launchdPorts(job), listening, ", or turn Remote Login off")...)
		checks = append(checks, sharing(listening, []service{
			{"Screen Sharing", 5900},
			{"Remote Management", 3283},
			{"File Sharing", 445},
			{"Printer Sharing", 631},
			{"Remote Apple Events", 3031},
			{"AirPlay Receiver", 7000},
		}, "turn off what you do not use in System Settings > General > Sharing; AirPlay Receiver is in General > AirDrop & Handoff")...)
	}
	// A VM's network, hived's own among them, is a bridge to this Mac's
	// NAT, not a LAN.
	var addresses []address
	for _, a := range s.addresses {
		if !strings.HasPrefix(a.iface, "bridge") {
			addresses = append(addresses, a)
		}
	}
	return append(checks, network(addresses)...)
}

// linux is what a Linux machine leaves open.
func (s system) linux() []Check {
	checks := s.linuxFirewall()
	listening := procListening(s.read("/proc/net/tcp") + s.read("/proc/net/tcp6"))
	checks = append(checks, s.ssh("sshd", "sshd is not listening", nil, listening, ", then reload sshd")...)
	checks = append(checks, sharing(listening, []service{
		{"Samba", 445},
		{"VNC", 5900},
		{"RDP", 3389},
	}, "stop the ones you do not use")...)
	return append(checks, network(s.addresses)...)
}

// linuxFirewall is the firewall check on Linux. ufw says to anyone whether
// it is on and what it drops, and firewalld whether it runs; the rules
// themselves are root's to read.
func (s system) linuxFirewall() []Check {
	on := []Check{{Name: "firewall", Found: "on", OK: true}}
	if ufwDrops(s.read("/etc/ufw/ufw.conf"), s.read("/etc/default/ufw")) {
		return on
	}
	if _, err := s.run("systemctl", "is-active", "--quiet", "firewalld"); err == nil {
		return on
	}
	if !s.sudoer {
		return nil
	}
	// -t leaves out the members of sets, which in a blocklist can be
	// millions.
	ruleset, err := s.run("sudo", "-n", "nft", "-t", "list", "ruleset")
	read := err == nil
	v4, v6 := nftFilters(ruleset)
	// nft does not see legacy tables. Listing one loads its module, so only
	// a table already loaded is listed.
	modules := s.read("/proc/modules")
	for _, legacy := range []struct {
		module, command string
		filters         *bool
	}{{"iptable_filter ", "iptables-legacy", &v4}, {"ip6table_filter ", "ip6tables-legacy", &v6}} {
		if !strings.Contains(modules, legacy.module) {
			continue
		}
		if rules, err := s.run("sudo", "-n", legacy.command, "-S", "INPUT"); err == nil {
			read = true
			*legacy.filters = *legacy.filters || legacyFilters(rules)
		}
	}
	const fix = "turn one on, such as with sudo ufw allow ssh && sudo ufw enable"
	switch {
	case !read:
		return nil
	case v4 && v6:
		return on
	case v4:
		return []Check{{Name: "firewall", Found: "IPv4 is filtered, and IPv6 is not", Note: true, Fix: "drop what IPv6 does not accept too"}}
	case v6:
		return []Check{{Name: "firewall", Found: "IPv6 is filtered, and IPv4 is not", Note: true, Fix: fix}}
	}
	return []Check{{Name: "firewall", Found: "no rules drop what reaches this machine", Note: true, Fix: fix}}
}

// sshd is where macOS and Linux both keep it.
const sshd = "/usr/sbin/sshd"

// sshProbes are where a Match block might let passwords in from: the
// private ranges, a tailnet's, and the internet.
var sshProbes = []string{"192.168.1.10", "10.0.0.10", "172.16.0.10", "100.64.0.10", "203.0.113.10"}

// ssh is the ssh check. ports are the ones sshd is reached on, if something
// other than its settings says; off is what to say when nothing listens on
// them; fix finishes sshKeysOnly.
func (s system) ssh(name, off string, ports []int, listening map[int]bool, fix string) []Check {
	// -G needs no root where sshd has it; -T needs the host keys.
	settings, err := s.run(sshd, "-G")
	if err != nil && s.sudoer {
		settings, err = s.run("sudo", "-n", sshd, "-T")
	}
	if err != nil {
		settings = ""
	}
	if len(ports) == 0 {
		ports = sshPorts(settings)
	}
	if len(ports) == 0 {
		ports, off = []int{22}, "nothing listens on port 22"
	}
	on := false
	for _, port := range ports {
		on = on || listening[port]
	}
	if !on {
		return []Check{{Name: "ssh", Found: off, OK: true}}
	}
	if settings == "" {
		return []Check{{Name: "ssh", Found: name + " is on, and hived could not read whether it takes passwords", Note: true, Fix: sshKeysOnly + fix}}
	}
	passwords, from, outside := sshPasswords(settings), "", false
	// What sshd prints is for no connection in particular, so a Match block
	// has to be asked about by connection, which only root can do.
	if !passwords && sshMatches(s.read("/etc/ssh/sshd_config")+s.read("/etc/ssh/sshd_config.d/*.conf")) {
		outside = true
		for _, probe := range sshProbes {
			if !s.sudoer {
				break
			}
			matched, err := s.run("sudo", "-n", sshd, "-T", "-C", "user="+s.user+",host=probe,addr="+probe)
			if err != nil {
				break
			}
			outside = false
			if sshPasswords(matched) {
				passwords, from = true, " from "+probe+", by a Match block"
				break
			}
		}
	}
	switch {
	case passwords:
		return []Check{{Name: "ssh", Found: name + " is on and takes passwords" + from, Note: true, Fix: sshKeysOnly + fix}}
	case outside:
		return []Check{{Name: "ssh", Found: name + " takes keys only, outside its Match blocks", OK: true}}
	}
	return []Check{{Name: "ssh", Found: name + " takes keys only", OK: true}}
}

// tailnet is the range Tailscale gives its machines. It is CGNAT's, and
// other VPNs use it too. tailnet6 is Tailscale's IPv6 range, which is
// otherwise taken for a private network's.
var (
	tailnet  = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}
	tailnet6 = &net.IPNet{IP: net.ParseIP("fd7a:115c:a1e0::"), Mask: net.CIDRMask(48, 128)}
)

// network is the network check: whether this machine has an address on a
// tailnet or a private network, whose other machines a job can reach as it
// can.
func network(addresses []address) []Check {
	var tailnets, private []string
	seen := false
	for _, a := range addresses {
		switch {
		case a.ip.IsLoopback() || a.ip.IsLinkLocalUnicast():
			continue
		case tailnet.Contains(a.ip) || tailnet6.Contains(a.ip):
			tailnets = append(tailnets, a.ip.String()+" on "+a.iface)
		case a.ip.IsPrivate():
			private = append(private, a.ip.String()+" on "+a.iface)
		}
		seen = true
	}
	var on, fixes []string
	if len(tailnets) > 0 {
		on = append(on, "a CGNAT or tailnet address ("+strings.Join(tailnets, ", ")+")")
		fixes = append(fixes, "on a tailnet, tag it in the tailnet's policy, and let the tag reach nothing")
	}
	if len(private) > 0 {
		on = append(on, "a private network ("+strings.Join(private, ", ")+")")
		fixes = append(fixes, "lend it from a network of its own, such as a guest Wi-Fi or VLAN")
	}
	switch {
	case len(on) > 0:
		return []Check{{Name: "network", Found: "on " + strings.Join(on, " and ") + ", and a job can reach whatever this machine can there",
			Note: true, Fix: strings.Join(fixes, "; ")}}
	case seen:
		return []Check{{Name: "network", Found: "on no tailnet or private network", OK: true}}
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
const sshKeysOnly = "check a key login works, then put PasswordAuthentication no and KbdInteractiveAuthentication no in /etc/ssh/sshd_config.d/00-keys-only.conf"

// sshPasswords reads what `sshd -T` or `-G` prints, sshd's settings as it
// would use them, one lowercase keyword and its value a line: whether it
// lets someone in with a password alone, by asking for one or through PAM.
func sshPasswords(settings string) bool {
	values := map[string]string{}
	for _, line := range strings.Split(settings, "\n") {
		key, value, _ := strings.Cut(strings.TrimSpace(line), " ")
		if _, seen := values[key]; !seen {
			values[key] = value
		}
	}
	password := values["passwordauthentication"] == "yes"
	keyboard := values["kbdinteractiveauthentication"] == "yes" || values["challengeresponseauthentication"] == "yes"
	methods := values["authenticationmethods"]
	if methods == "" || methods == "any" {
		return password || keyboard
	}
	// Each list is a way in that takes every method in it, so a password is
	// enough only through a list of nothing else.
	for _, list := range strings.Fields(methods) {
		alone := true
		for _, method := range strings.Split(list, ",") {
			method, _, _ = strings.Cut(method, ":")
			alone = alone && (method == "password" && password || method == "keyboard-interactive" && keyboard)
		}
		if alone {
			return true
		}
	}
	return false
}

// sshPorts reads the ports sshd listens on from what `sshd -T` or `-G`
// prints.
func sshPorts(settings string) []int {
	var ports []int
	for _, line := range strings.Split(settings, "\n") {
		key, value, _ := strings.Cut(strings.TrimSpace(line), " ")
		if key == "listenaddress" {
			value = value[strings.LastIndex(value, ":")+1:]
		} else if key != "port" {
			continue
		}
		if port, err := strconv.Atoi(value); err == nil {
			ports = append(ports, port)
		}
	}
	return ports
}

// sshMatches is whether sshd's configuration has a Match block.
func sshMatches(config string) bool {
	for _, line := range strings.Split(config, "\n") {
		if fields := strings.Fields(line); len(fields) > 0 && strings.EqualFold(fields[0], "match") {
			return true
		}
	}
	return false
}

// launchdPorts reads `launchctl print` of a job: the ports launchd listens
// on for it, which it names as services.
func launchdPorts(job string) []int {
	var ports []int
	for _, line := range strings.Split(job, "\n") {
		if name, ok := strings.CutPrefix(strings.TrimSpace(line), "service name = "); ok {
			if port, err := net.LookupPort("tcp", name); err == nil {
				ports = append(ports, port)
			}
		}
	}
	return ports
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

// ufwDrops reads ufw.conf and /etc/default/ufw: whether ufw is on and drops
// what it does not allow.
func ufwDrops(conf, defaults string) bool {
	return strings.Contains("\n"+conf, "\nENABLED=yes") &&
		(strings.Contains(defaults, `DEFAULT_INPUT_POLICY="DROP"`) || strings.Contains(defaults, `DEFAULT_INPUT_POLICY="REJECT"`))
}

// unconditional is a rule that drops or rejects everything that reaches it.
// A rule that matches first, as fail2ban's do, drops only what it matches.
var unconditional = regexp.MustCompile(`^(counter( packets \d+ bytes \d+)? )?(drop|reject( with .+)?)$`)

// nftFilters reads `nft list ruleset`: whether a chain on the input hook
// drops what it does not accept, by its policy or by an unconditional last
// rule, for IPv4 and for IPv6. Docker's and Tailscale's chains accept what
// they do not match, so they are no firewall.
func nftFilters(ruleset string) (v4, v6 bool) {
	family, depth := "", 0
	input, drops, last := false, false, ""
	for _, line := range strings.Split(ruleset, "\n") {
		line = strings.TrimSpace(line)
		switch fields := strings.Fields(line); {
		case depth == 0 && len(fields) > 1 && fields[0] == "table":
			family = fields[1]
		case depth == 2 && strings.HasPrefix(line, "type ") && strings.Contains(line, " hook input "):
			input, drops = true, strings.Contains(line, "policy drop")
		case depth == 2 && line != "" && line != "}":
			last = line
		}
		before := depth
		depth += strings.Count(line, "{") - strings.Count(line, "}")
		// A chain, or a set, ends.
		if before == 2 && depth == 1 {
			if input && (drops || unconditional.MatchString(last)) {
				v4 = v4 || family == "ip" || family == "inet"
				v6 = v6 || family == "ip6" || family == "inet"
			}
			input, drops, last = false, false, ""
		}
	}
	return v4, v6
}

// legacyFilters reads `iptables-legacy -S INPUT`: whether the chain drops
// what it does not accept, by its policy or by an unconditional last rule.
func legacyFilters(rules string) bool {
	last := ""
	for _, line := range strings.Split(rules, "\n") {
		line = strings.TrimSpace(line)
		if line == "-P INPUT DROP" {
			return true
		}
		if strings.HasPrefix(line, "-A INPUT ") {
			last = line
		}
	}
	return last == "-A INPUT -j DROP" || strings.HasPrefix(last, "-A INPUT -j REJECT")
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

// procListening reads Linux's /proc/net/tcp and tcp6: the ports something
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
