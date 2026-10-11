// Runs daemon/release/install.sh for real against a release served from this
// process, in a home of its own, with the service manager stood in for: a
// run of the installer that finds nothing new must leave a running daemon
// alone, because restarting it cancels the job it is in the middle of.
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import { arch, platform, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { once } from "node:events"
import { test } from "node:test"

const installer = resolve(import.meta.dirname, "../daemon/release/install.sh")
const mac = platform() === "darwin"
const linuxArch = arch() === "arm64" ? "arm64" : "amd64"

// The Linux half refuses a machine without KVM before it does anything
// else, and a job's own VM usually is one.
function unusable() {
  if (mac) return arch() === "arm64" ? "" : "the Mac half needs Apple Silicon"
  if (platform() !== "linux") return "the installer runs on macOS and Linux"
  try {
    accessSync("/dev/kvm", constants.R_OK | constants.W_OK)
    return ""
  } catch {
    return "this machine has no /dev/kvm its user can open"
  }
}

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex")

function script(file, body) {
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
}

/**
 * A release in a directory: one daemon and one image, each of which a test
 * can replace with a newer one. The daemon stands in for hived only as far
 * as the installer asks it anything.
 */
function release(root, origin) {
  const dir = join(root, "release")
  const making = join(root, "making")
  mkdirSync(dir, { recursive: true })
  const state = { version: "9.9.0", daemon: "", image: 1 }
  const publish = () => {
    rmSync(making, { recursive: true, force: true })
    mkdirSync(join(making, "daemon"), { recursive: true })
    mkdirSync(join(making, "image"), { recursive: true })
    const imageVersion = `${state.image}-2.0.0`
    writeFileSync(
      join(making, "image/manifest.json"),
      JSON.stringify({ imageVersion: state.image, runnerVersion: "2.0.0" })
    )
    script(join(making, "daemon/hived"), `# ${state.daemon}\nexit 0`)
    if (mac) {
      // The installer wants a signature macOS accepts. A script can carry
      // one made on the spot, and the archive keeps it.
      execFileSync("codesign", ["--sign", "-", join(making, "daemon/hived")])
      execFileSync("ditto", [
        "-c",
        "-k",
        join(making, "daemon"),
        join(dir, "hived.zip"),
      ])
      execFileSync("aa", [
        "archive",
        "-d",
        join(making, "image"),
        "-o",
        join(dir, `image-${state.image}.aar.aa`),
      ])
      writeFileSync(
        join(dir, "latest.json"),
        JSON.stringify({
          version: state.version,
          daemon: {
            url: `${origin}/hived.zip`,
            sha256: sha256(join(dir, "hived.zip")),
            teamId: "",
          },
          image: {
            version: imageVersion,
            url: `${origin}/image-${state.image}.aar`,
            parts: "aa",
            sha256: sha256(join(dir, `image-${state.image}.aar.aa`)),
            megabytes: 1,
          },
        })
      )
      return
    }
    execFileSync("tar", [
      "-czf",
      join(dir, "hived.tar.gz"),
      "-C",
      join(making, "daemon"),
      "hived",
    ])
    execFileSync("tar", [
      "-czf",
      join(dir, `image-${state.image}.tar.gz.aa`),
      "-C",
      join(making, "image"),
      "manifest.json",
    ])
    writeFileSync(
      join(dir, `linux-${linuxArch}.txt`),
      [
        `version=${state.version}`,
        `daemon_url=${origin}/hived.tar.gz`,
        `daemon_sha256=${sha256(join(dir, "hived.tar.gz"))}`,
        `image_version=${imageVersion}`,
        `image_url=${origin}/image-${state.image}.tar.gz`,
        "image_parts=aa",
        `image_sha256=${sha256(join(dir, `image-${state.image}.tar.gz.aa`))}`,
        "image_megabytes=1",
        "",
      ].join("\n")
    )
  }
  publish()
  return { dir, state, publish }
}

/**
 * The service manager and, on Linux, the programs a VM is made of: each
 * writes down what it was asked. `running` is the file whose presence means
 * the daemon's service is up.
 */
function standIns(root) {
  const bin = join(root, "stand-ins")
  const asked = join(root, "asked.log")
  const running = join(root, "running")
  mkdirSync(bin)
  writeFileSync(asked, "")
  if (mac) {
    script(
      join(bin, "launchctl"),
      `echo "launchctl $*" >> "${asked}"
case "$1" in
  print) [ -e "${running}" ] ;;
  bootout) rm -f "${running}" ;;
  bootstrap) : > "${running}" ;;
esac`
    )
  } else {
    script(
      join(bin, "systemctl"),
      `echo "systemctl $*" >> "${asked}"
case "$*" in
  *is-active*) [ -e "${running}" ] ;;
  *restart*) : > "${running}" ;;
esac`
    )
    for (const name of ["journalctl", "loginctl", "qemu-img", "passt"])
      script(join(bin, name), "exit 0")
    for (const name of ["qemu-system-aarch64", "qemu-system-x86_64"])
      script(join(bin, name), "exit 0")
    script(join(bin, "virtiofsd"), 'echo "virtiofsd 1.13.2"')
  }
  return {
    bin,
    running,
    // How many times a running daemon was stopped or a stopped one started.
    restarts: () =>
      readFileSync(asked, "utf8")
        .split("\n")
        .filter((line) =>
          mac ? line.startsWith("launchctl bootstrap") : / restart /.test(line)
        ).length,
  }
}

test(
  "the installer leaves a daemon running when it has nothing new for it",
  { skip: unusable() || false },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "hive-installer-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const home = join(root, "home")
    mkdirSync(home)

    let served
    const server = createServer((request, response) => {
      const file = join(served, new URL(request.url, "http://x").pathname)
      if (!existsSync(file)) return response.writeHead(404).end()
      response.end(readFileSync(file))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    t.after(() => server.close())
    const origin = `http://127.0.0.1:${server.address().port}`
    const published = release(root, origin)
    served = published.dir
    const service = standIns(root)

    const install = async () => {
      const child = spawn("sh", [installer], {
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: "",
          HIVE_RELEASES: origin,
          HIVE_DEV: "1",
          PATH: `${service.bin}:${process.env.PATH}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      let said = ""
      child.stdout.on("data", (chunk) => (said += chunk))
      child.stderr.on("data", (chunk) => (said += chunk))
      const [code] = await once(child, "exit")
      assert.equal(code, 0, said)
      return said
    }

    // A machine that has never had it: the daemon is started.
    await install()
    assert.equal(service.restarts(), 1, "a first install starts the daemon")
    assert.ok(existsSync(service.running))

    // Run again with the same release out: this is `hived update`, or
    // someone running the installer, on a machine that is in the middle
    // of a job. The daemon must not be touched.
    const again = await install()
    assert.equal(service.restarts(), 1, `nothing was new, yet:\n${again}`)
    assert.match(again, /already running, and was left as it is/)

    // The same release, but the daemon is not running: it is started.
    rmSync(service.running)
    await install()
    assert.equal(service.restarts(), 2, "a stopped daemon is started")

    // A new daemon is what a restart is for.
    published.state.version = "9.9.1"
    published.state.daemon = "newer"
    published.publish()
    await install()
    assert.equal(service.restarts(), 3, "a new daemon replaces the old one")

    // So is a new image: the running daemon has the old one open.
    published.state.image = 2
    published.publish()
    await install()
    assert.equal(service.restarts(), 4, "a new image is taken up")

    // And after either, the next run is quiet again.
    await install()
    assert.equal(service.restarts(), 4)
  }
)
