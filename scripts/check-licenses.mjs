import { spawnSync } from "node:child_process"
import { root } from "./project-lib.mjs"

// Licenses a public Hive Runner repository can depend on without obligations
// beyond attribution. See docs/licensing.md before adding to either list.
const allowed = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Python-2.0",
  "MIT OR Apache-2.0",
  // File-level copyleft: fine while we use these packages unmodified.
  "MPL-2.0",
  // Data, not code. Attribution only.
  "CC-BY-4.0",
  // Fonts, not code: the site's typefaces, served unmodified from
  // @fontsource packages. Attribution only while we do not modify the files.
  "OFL-1.1",
])
// Reviewed one by one. Prefix match, because native builds are per platform.
const exceptions = [
  // LGPL libvips, dynamically linked by sharp. Build and local-dev only; it is
  // not in the Worker bundle and we do not redistribute it.
  "@img/sharp-libvips-",
]

const result = spawnSync("pnpm", ["licenses", "list", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
if (result.status !== 0) {
  console.error(result.stderr)
  process.exit(1)
}
const failures = []
for (const [license, packages] of Object.entries(JSON.parse(result.stdout)))
  if (!allowed.has(license))
    for (const { name } of packages)
      if (!exceptions.some((prefix) => name.startsWith(prefix)))
        failures.push(`${name}: ${license}`)
if (failures.length) {
  console.error(
    `Dependencies with licenses that are not on the allowlist:\n${failures.join("\n")}`
  )
  process.exit(1)
}
console.log("OK dependency licenses")
