import { test, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDocs } from '../scripts/check-docs.mjs'

const temporaryRoots = []
afterEach(() => Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'eleckoi-docs-check-'))
  temporaryRoots.push(root)
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
  return root
}
const base = {
  'docs/README.md': '# Docs\n\n[Decisions](adr/README.md)\n',
  'docs/adr/README.md': '# ADR\n\n[Baseline](0012-baseline.md)\n',
  'docs/adr/0012-baseline.md': '# ADR 0012：Baseline\n'
}
test('valid links, Chinese headings, duplicate heading suffixes and fenced examples', async t => {
  const root = await fixture(t, { ...base,
    'docs/README.md': '# Docs\n\n[Heading](guide.md#中文标题)\n[Repeat](guide.md#中文标题-1)\n~~~md\n[example](missing.md)\n~~~\n',
    'docs/guide.md': '# 中文标题\n\n## 中文标题\n'
  })
  assert.deepEqual((await checkDocs(root)).errors, [])
})
test('missing targets and anchors are rejected', async t => {
  const root = await fixture(t, { ...base, 'docs/README.md': '# Docs\n[Missing](none.md)\n[Anchor](adr/README.md#none)\n' })
  const errors = (await checkDocs(root)).errors
  assert.ok(errors.some(error => error.includes('missing link target')))
  assert.ok(errors.some(error => error.includes('missing heading')))
})
test('duplicate numbers, title mismatch and missing index entry are rejected', async t => {
  const root = await fixture(t, { ...base, 'docs/adr/0012-other.md': '# ADR 0013：Other\n' })
  const errors = (await checkDocs(root)).errors
  assert.ok(errors.some(error => error.includes('duplicate ADR')))
  assert.ok(errors.some(error => error.includes('filename/title mismatch')))
  assert.ok(errors.some(error => error.includes('missing from index')))
})
test('shared ADR identities must match while subsets are allowed', async t => {
  const root = await fixture(t, base)
  const peer = await fixture(t, { ...base, 'docs/adr/0014-additional.md': '# ADR 0014：Additional\n' })
  assert.deepEqual((await checkDocs(root, peer)).errors, [])
  await writeFile(join(peer, 'docs/adr/0012-baseline.md'), '# ADR 0012：Different\n')
  assert.ok((await checkDocs(root, peer)).errors.some(error => error.includes('identity differs')))
})
test('local links cannot leave the repository', async t => {
  const root = await fixture(t, { ...base, 'docs/README.md': '# Docs\n[Private](../../outside.md)\n' })
  assert.ok((await checkDocs(root)).errors.some(error => error.includes('leaves repository')))
})
