import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import { retireDeepSeekExtensionSelection } from '../../src/profile.js'

const directories = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture(text) {
  const path = await mkdtemp(join(tmpdir(), 'eleckoi-web-profile-selection-'))
  directories.push(path)
  if (text !== undefined) await writeFile(join(path, 'cordis.patch.yml'), text)
  return { path, text: () => readFile(join(path, 'cordis.patch.yml'), 'utf8') }
}

it.each([
  ['eleckoi-deepseek-api', 'http', 'deepseek-search-api', 'http'],
  ['tavily', 'eleckoi-deepseek-api', 'tavily', 'deepseek-fetch-api']
])('retires only the exact legacy selection: %s / %s', async (search, fetch, nextSearch, nextFetch) => {
  const f = await fixture(`# retained comment
- id: web
  config:
    searchProvider: ${search}
    fetchProvider: ${fetch}
- id: web-deepseek-api
  config: { count: 37, apiKeyEnv: EXISTING_OFFICIAL_REF }
- id: eleckoi-web-deepseek
  config: { count: 49, apiKeyEnv: EXISTING_EXTENSION_REF }
- id: another-plugin
  config: { value: !!js ctx.example.value }
`)
  await retireDeepSeekExtensionSelection(f.path)
  const text = await f.text()
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
  expect(document.toJS()).toEqual([
    { id: 'web', config: { searchProvider: nextSearch, fetchProvider: nextFetch } },
    { id: 'web-deepseek-api', config: { count: 37, apiKeyEnv: 'EXISTING_OFFICIAL_REF' } },
    { id: 'eleckoi-web-deepseek', config: { count: 49, apiKeyEnv: 'EXISTING_EXTENSION_REF' } },
    { id: 'another-plugin', config: { value: 'ctx.example.value' } }
  ])
  expect(text).toContain('# retained comment')
  expect(text).toContain('!!js')
  await retireDeepSeekExtensionSelection(f.path)
  expect(await f.text()).toBe(text)
  expect(await readdir(f.path)).toEqual(['cordis.patch.yml'])
})

it('leaves current providers, unrelated ids and credential data unchanged', async () => {
  const text = '- id: web\n  config: { searchProvider: tavily, fetchProvider: http }\n- id: other-web\n  config: { searchProvider: eleckoi-deepseek-api }\n'
  const f = await fixture(text)
  await writeFile(join(f.path, 'credentials.json'), '{"synthetic":"retained"}')
  await retireDeepSeekExtensionSelection(f.path)
  expect(await f.text()).toBe(text)
  expect(await readFile(join(f.path, 'credentials.json'), 'utf8')).toBe('{"synthetic":"retained"}')
})

it('leaves a new profile without overrides alone', async () => {
  const f = await fixture()
  await retireDeepSeekExtensionSelection(f.path)
  expect(await readdir(f.path)).toEqual([])
})

it('reports an invalid patch without writing over it', async () => {
  const f = await fixture('not: [valid')
  await expect(retireDeepSeekExtensionSelection(f.path)).rejects.toThrow()
  expect(await f.text()).toBe('not: [valid')
})
