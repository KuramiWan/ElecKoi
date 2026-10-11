import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const json = path => JSON.parse(readFileSync(resolve(repo, path), 'utf8'))
const lock = json('native/android-runtime/native-build-lock.json')
assert.equal(lock.schemaVersion, 1)
assert.deepEqual(readFileSync(resolve(repo, 'apps/android/app/src/main/res/drawable-nodpi/eleckoi_app_icon.png')),
  readFileSync(resolve(repo, 'apps/desktop/resources/icons/eleckoi-app-icon.png')), 'Android launcher must use the current desktop icon')
function verifyNativeElf(elf, path) {
  assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46', path)
  assert.equal(elf[4], 2, 'Native Host requires ELF64')
  assert.equal(elf[5], 1, 'Native Host requires little-endian ELF')
  assert.equal(elf.readUInt16LE(18), 183, 'Native Host requires AArch64')
  const offset = Number(elf.readBigUInt64LE(32)), size = elf.readUInt16LE(54), count = elf.readUInt16LE(56)
  assert(size >= 56 && offset + size * count <= elf.length, 'Invalid program headers')
  let loads = 0
  for (let index = 0; index < count; index++) {
    const position = offset + index * size
    if (elf.readUInt32LE(position) !== 1) continue
    loads++
    assert(elf.readBigUInt64LE(position + 48) >= 16384n, `Native Host LOAD alignment below 16 KiB: ${path}`)
  }
  assert(loads > 0, 'Native Host has no LOAD segment')
}
const assets = resolve(repo, process.argv[2] ?? 'build/android-runtime/assets')
const glibcLock = json('native/android-runtime/glibc-lock.json')
assert.deepEqual(json('apps/android/app/src/main/assets/licenses/glibc/provenance.json'), glibcLock)
const execution = json('apps/android/app/src/main/assets/licenses/glibc/execution-provenance.json')
assert.equal(execution.schemaVersion, 1)
assert.equal(execution.androidNdkVersion, lock.androidNdkVersion)
assert.equal(execution.androidApi, lock.androidApi)
const nativeDirectory = 'apps/android/app/src/main/jniLibs/arm64-v8a'
const nativeFiles = execution.outputs.filter(record => record.path.startsWith(`${nativeDirectory}/`))
  .map(record => basename(record.path)).sort()
assert.deepEqual(nativeFiles, ['libeleckoi_glibc_portable.so', 'libeleckoi_node.so'], 'Declare the current Node runtime helpers')
assert.deepEqual(readdirSync(resolve(repo, nativeDirectory)).sort(), nativeFiles, 'Remove undeclared native files before packaging')
for (const record of [...execution.sources, ...execution.outputs]) {
  const bytes = readFileSync(resolve(repo, record.path))
  assert.equal(bytes.length, record.size, record.path)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256, record.path)
}
for (const record of execution.outputs) verifyNativeElf(readFileSync(resolve(repo, record.path)), record.path)
for (const spec of glibcLock.elfFiles) {
  const name = spec.file === 'ld-linux-aarch64.so.1' ? 'apps/android/app/src/main/jniLibs/arm64-v8a/libeleckoi_glibc_portable.so'
    : `build/android-runtime/glibc-probe/portable/usr/glibc/lib/${spec.file}`
  assert.equal(createHash('sha256').update(readFileSync(resolve(repo, name))).digest('hex'), spec.sha256, name)
}
const manifestPath = resolve(assets, 'runtime/manifest.json')
assert(existsSync(manifestPath), 'Prepare verified Android runtime assets before checking the distribution')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.architecture, 'arm64-v8a')
assert.equal(manifest.protocolVersion, 1)
assert.equal(manifest.nodeExecutable, '/usr/bin/node')
assert.equal(manifest.hostEntrypoint, '/eleckoi/app/bin/eleckoi-host.mjs')
const expected = [['runtime/rootfs.archive', 'rootfs'], ['runtime/node.archive', 'rootfs'],
  ['runtime/git.archive', 'rootfs'], ['runtime/app.archive', 'app']]
assert.equal(manifest.archives.length, expected.length)
for (const [index, archive] of manifest.archives.entries()) {
  assert.deepEqual([archive.asset, archive.target], expected[index])
  assert.match(archive.sha256, /^[a-f0-9]{64}$/)
  assert(Number.isSafeInteger(archive.unpackedBytes) && archive.unpackedBytes > 0, archive.asset)
  const file = resolve(assets, archive.asset)
  assert.equal(statSync(file).size, archive.bytes, archive.asset)
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), archive.sha256, archive.asset)
}
process.stdout.write('Android runtime archive hashes, ARM64 native Host identity and 16 KiB alignment passed.\n')
