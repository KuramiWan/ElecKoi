import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { JSDOM } from 'jsdom'
import { buildAuthorDocsSite, prepareAuthorDocsHtml, siteFiles } from '../build-author-docs-site.mjs'

const temporaryRoots = []
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('Pages keeps navigation and example downloads local but links source documents to GitHub', () => {
  const html = prepareAuthorDocsHtml(`<a href="#reference">API</a>
    <a href="../../packages/examples/native-author/example.character.json" download>Example</a>
    <a href="../../packages/sdk/author/src/index.ts#L1">Source</a>
    <a href="../adr/0032-native-script-libraries.md">Architecture</a>
    <a href="https://example.org/docs">External</a>`)
  const links = [...new JSDOM(html).window.document.querySelectorAll('a')].map(link => link.getAttribute('href'))
  expect(links).toEqual([
    '#reference',
    '../../packages/examples/native-author/example.character.json',
    'https://github.com/eleckoi/ElecKoi/blob/main/packages/sdk/author/src/index.ts#L1',
    'https://github.com/eleckoi/ElecKoi/blob/main/docs/adr/0032-native-script-libraries.md',
    'https://example.org/docs',
  ])
})

test('Pages publishes only the documented static files and replaces stale output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eleckoi-docs-site-'))
  temporaryRoots.push(root)
  for (const file of siteFiles) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), file.endsWith('.html') ? '<h1>ElecKoi SDK</h1>' : 'synthetic-content')
  }
  await mkdir(join(root, 'build/author-docs'), { recursive: true })
  await writeFile(join(root, 'build/author-docs/stale.txt'), 'stale')
  await writeFile(join(root, 'local-data.txt'), 'not-published')
  const output = await buildAuthorDocsSite(root)
  const published = (await readdir(output, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name).slice(output.length + 1).replaceAll('\\', '/'))
  expect(published.sort()).toEqual([...siteFiles, 'index.html', '.nojekyll'].sort())
  expect(await readFile(join(output, 'index.html'), 'utf8')).toContain('url=docs/plugins/author-sdk.html')
  expect(await readFile(join(output, 'packages/examples/native-author/example.character.json'), 'utf8')).toBe('synthetic-content')
})
