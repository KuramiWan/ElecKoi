import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'build/android-runtime/downloads')
const inventory = JSON.parse(readFileSync(resolve(root, 'build/android-runtime/closure/production-closure.json'), 'utf8'))
const bases = JSON.parse(readFileSync(resolve(import.meta.dirname, 'runtime-base-lock.json'), 'utf8'))
const gitTools = JSON.parse(readFileSync(resolve(import.meta.dirname, 'git-tools-lock.json'), 'utf8'))
const lock = parse(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'))
mkdirSync(output, { recursive: true })

async function digest(path, algorithm, encoding) {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest(encoding)
}
async function download(file, url, expected, algorithm = 'sha256', encoding = 'hex') {
  const target = resolve(output, file)
  if (existsSync(target)) {
    if (await digest(target, algorithm, encoding) !== expected) throw new Error(`Cached runtime checksum mismatch: ${file}`)
    return target
  }
  const response = await fetch(url)
  if (!response.ok || response.body === null) throw new Error(`Runtime download HTTP ${response.status}: ${url}`)
  const temporary = `${target}.part`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
  if (await digest(temporary, algorithm, encoding) !== expected) throw new Error(`Runtime download checksum mismatch: ${file}`)
  renameSync(temporary, target)
  return target
}

const selected = new Map()
for (const owner of inventory.packages) {
  const keys = Object.keys(lock.snapshots).filter(key => key === `${owner.name}@${owner.version}`
    || key.startsWith(`${owner.name}@${owner.version}(`))
  for (const key of keys) {
    for (const [name, resolvedVersion] of Object.entries(lock.snapshots[key].optionalDependencies ?? {})) {
      const version = resolvedVersion.split('(')[0]
      const metadata = lock.packages[`${name}@${version}`]
      if (!metadata) throw new Error(`Locked optional dependency metadata is missing: ${name}@${version}`)
      const arm64 = metadata.cpu?.includes('arm64') && (!metadata.os || metadata.os.includes('linux'))
        && !metadata.libc?.includes('musl')
      // LibreOfficeKit's published Linux resolver explicitly selects this engine.
      const linuxWasm = owner.name === '@deepseek-ai/libreoffice-kit' && name === '@deepseek-ai/libreoffice-kit-wasm'
      if (!arm64 && !linuxWasm) continue
      const identity = `${name}@${version}`
      const integrity = metadata.resolution?.integrity
      if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) throw new Error(`Native integrity missing: ${identity}`)
      const record = selected.get(identity) ?? { name, version, integrity, owners: [],
        file: `${name.replaceAll('/', '__').replaceAll('@', '')}-${version}.tgz` }
      if (!record.owners.some(item => item.directory === owner.directory)) {
        record.owners.push({ name: owner.name, version: owner.version, directory: owner.directory })
      }
      selected.set(identity, record)
    }
  }
}
const tasks = [...selected.values()].map(record => async () => {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(record.name)}/${record.version}`)
  if (!response.ok) throw new Error(`Native metadata HTTP ${response.status}: ${record.name}`)
  const metadata = await response.json()
  if (metadata.name !== record.name || metadata.version !== record.version || metadata.dist?.integrity !== record.integrity) {
    throw new Error(`Registry identity differs from lockfile: ${record.name}@${record.version}`)
  }
  record.url = metadata.dist.tarball
  await download(record.file, record.url, record.integrity.slice('sha512-'.length), 'sha512', 'base64')
  process.stdout.write(`Verified ${record.name}@${record.version}\n`)
})
tasks.push(...['rootfs', 'node', 'sqlite'].map(key => async () => {
  const record = bases[key]
  await download(record.file, record.url, record.sha256)
  process.stdout.write(`Verified ${key} ${record.version}\n`)
}))
tasks.push(...gitTools.packages.map(record => async () => {
  await download(record.file, record.url, record.sha256)
  process.stdout.write(`Verified Android Git dependency ${record.name}@${record.version}\n`)
}))
// Bound concurrent downloads without depending on a machine-specific proxy.
let next = 0
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < tasks.length) await tasks[next++]()
}))
writeFileSync(resolve(output, 'native-plan.json'), JSON.stringify([...selected.values()], null, 2) + '\n')
