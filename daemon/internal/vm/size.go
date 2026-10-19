package vm

const gib = 1 << 30

// GuestMemoryBytes is the memory a job's VM is given: 2 GiB a core, at least
// 4, which is what a hosted runner of the same size has or a little less,
// and never more than half the host. A host of unknown size is not capped.
func GuestMemoryBytes(vcpus int, hostBytes uint64) uint64 {
	const gib = 1 << 30
	memory := uint64(max(vcpus*2, 4)) * gib
	if hostBytes > 0 && memory > hostBytes/2 {
		memory = hostBytes / 2 / gib * gib
	}
	return memory
}

// GuestZramBytes is compressed swap inside the guest: half of the guest's
// RAM, so memory pressure compresses before the OOM killer runs. The guest
// sizes this from MemTotal at boot; the formula lives here so a label's
// headroom is documented and tested.
func GuestZramBytes(memoryBytes uint64) uint64 {
	return memoryBytes / 2
}

// GuestSwapFileBytes is disk-backed swap on the job's overlay: half of RAM,
// at most 4 GiB. zram is used first; this is the slower overflow.
func GuestSwapFileBytes(memoryBytes uint64) uint64 {
	const capBytes = 4 << 30
	n := memoryBytes / 2
	if n > capBytes {
		return capBytes
	}
	return n
}
