import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const slash = value => value.split(sep).join('/')
async function markdownFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
  }
  return files.sort()
}
function prose(source) {
  let fence = null
  return source.split(/\r?\n/).map(line => {
    const marker = line.match(/^ {0,3}(\x60{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      return ''
    }
    return fence ? '' : line
  }).join('\n')
}
function anchors(source) {
  const ids = new Set()
  const counts = new Map()
  for (const line of prose(source).split('\n')) {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
    if (!heading) continue
    const base = heading[1].toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[^\p{L}\p{N}_\- ]/gu, '')
      .replace(/ /g, '-')
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    ids.add(count ? base + '-' + count : base)
  }
  for (const match of source.matchAll(/<(?:a|[a-z][a-z0-9]*)\b[^>]*\bid=["']([^"']+)["']/gi)) ids.add(match[1])
  return ids
}
async function adrRecords(root) {
  const records = []
  for (const path of await markdownFiles(resolve(root, 'docs/adr'))) {
    const filename = slash(relative(resolve(root, 'docs/adr'), path))
    if (filename === 'README.md') continue
    const match = filename.match(/^(\d{4})-[a-z0-9-]+\.md$/)
    const source = await readFile(path, 'utf8')
    const heading = source.split(/\r?\n/).find(line => line.startsWith('# '))
    const title = heading?.match(/^# ADR[ -](\d+)\s*[:：]\s*(.+)$/)
    records.push({ filename, id: match?.[1], titleId: title?.[1]?.padStart(4, '0'), title: title?.[2], source })
  }
  return records
}
export async function checkDocs(root, peerRoot) {
  root = resolve(root)
  const errors = []
  const docs = resolve(root, 'docs')
  const files = await markdownFiles(docs)
  const cache = new Map()
  const sourceFor = async path => {
    if (!cache.has(path)) cache.set(path, await readFile(path, 'utf8'))
    return cache.get(path)
  }
  for (const path of files) {
    const source = await sourceFor(path)
    const clean = prose(source).replace(/(\x60+)([^\n]*?)\1/g, '')
    for (const match of clean.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)) {
      const link = match[1].replace(/^<|>$/g, '')
      if (/^[A-Za-z]:[\\/]/.test(link)) {
        errors.push(slash(relative(root, path)) + ': absolute filesystem link ' + link)
        continue
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) continue
      const hash = link.indexOf('#')
      const rawPath = (hash < 0 ? link : link.slice(0, hash)).split('?')[0]
      let target, fragment
      try {
        target = rawPath ? resolve(dirname(path), decodeURIComponent(rawPath)) : path
        fragment = hash < 0 ? '' : decodeURIComponent(link.slice(hash + 1))
      } catch {
        errors.push(slash(relative(root, path)) + ': invalid link ' + link)
        continue
      }
      const location = slash(relative(root, path))
      if (relative(root, target).startsWith('..') || /^[A-Za-z]:[\\/]/.test(rawPath)) {
        errors.push(location + ': link leaves repository ' + link)
        continue
      }
      let info
      try { info = await stat(target) } catch {
        errors.push(location + ': missing link target ' + link)
        continue
      }
      if (fragment && info.isFile() && target.endsWith('.md') && !anchors(await sourceFor(target)).has(fragment)) {
        errors.push(location + ': missing heading ' + link)
      }
    }
  }
  const records = await adrRecords(root)
  const ids = new Set()
  const index = await sourceFor(resolve(docs, 'adr/README.md'))
  for (const record of records) {
    if (!record.id || record.id !== record.titleId || !record.title) errors.push('docs/adr/' + record.filename + ': ADR filename/title mismatch')
    if (ids.has(record.id)) errors.push('duplicate ADR number ' + record.id)
    ids.add(record.id)
    if (!index.includes('](' + record.filename + ')')) errors.push('ADR missing from index: ' + record.filename)
  }
  if (peerRoot) {
    const peers = await adrRecords(resolve(peerRoot))
    const peerIds = new Set()
    for (const peer of peers) {
      if (!peer.id || peer.id !== peer.titleId || !peer.title) errors.push('peer ADR filename/title mismatch: ' + peer.filename)
      if (peerIds.has(peer.id)) errors.push('duplicate peer ADR number ' + peer.id)
      peerIds.add(peer.id)
      const own = records.find(record => record.id === peer.id)
      if (own && (own.filename !== peer.filename || own.title !== peer.title)) errors.push('ADR identity differs between worktrees: ' + peer.id)
    }
  }
  return { errors, files: files.length, adrs: records.length }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--compare')) throw new Error('Usage: node scripts/check-docs.mjs [--compare <worktree>]')
  const result = await checkDocs(root, args[1])
  if (result.errors.length) {
    console.error(result.errors.join('\n'))
    process.exitCode = 1
  } else console.log('Documentation check passed: ' + result.files + ' Markdown files, ' + result.adrs + ' unique ADRs' + (args[1] ? ', shared ADR identities agree.' : '.'))
}
