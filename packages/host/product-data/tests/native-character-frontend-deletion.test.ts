import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import Database from 'better-sqlite3'
import * as Cordis from '@deepseek-ai/cordis'
import productDataPlugin from '@eleckoi/dsh-product-data'
import { FrontendIndex, FrontendProjectRepository, type FrontendOwner } from '@eleckoi/dsh-product-data/frontends'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})
const role = { scope: 'character', characterId: 'synthetic-character' } satisfies FrontendOwner
const other = { scope: 'character', characterId: 'synthetic-other' } satisfies FrontendOwner
const application = { scope: 'application' } satisfies FrontendOwner
const script = { type: 'script' as const, id: 'synthetic-script', name: 'Synthetic script', enabled: true,
  content: 'export default () => {};', info: '', data: {}, button: { enabled: false, buttons: [] },
  export_with: { data: true, button: true }, runtime: { kind: 'eleckoi-module', apiVersion: 1 } }

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-role-frontend-delete-'))
  cleanups.push(() => {
    const child = relative(tmpdir(), directory)
    if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unexpected fixture cleanup path')
    rmSync(directory, { recursive: true, force: true })
  })
  vi.stubEnv('ELECKOI_DATABASE_PATH', join(directory, 'product.sqlite'))
  vi.stubEnv('ELECKOI_MEDIA_ROOT', join(directory, 'media'))
  vi.stubEnv('ELECKOI_WORKSPACE_ROOT', join(directory, 'workspace'))
  const connect = async () => {
    const ctx = new Cordis.Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(productDataPlugin)
    return ctx
  }
  const ctx = await connect(), data = ctx.eleckoiProductData
  for (const id of [role.characterId, other.characterId, 'synthetic-empty']) data.createCharacter({ id, name: 'Synthetic character' })
  const repository = data.frontendProjects()
  const create = (owner: FrontendOwner) => repository.importProject(owner, { name: 'Synthetic page',
    project: JSON.parse('{"__proto__":{"count":4},"constructor":2}'), files: [
    { path: 'index.html', content: '<!doctype html><body>Synthetic page</body>' },
    { path: 'assets/data.bin', content: Buffer.from([0, 128, 255]).toString('base64'), encoding: 'base64' },
  ] }).selectedProjectId!
  const first = create(role), second = create(role), shared = create(application), separate = create(other)
  repository.setMessageRenderer({ scope: 'character', characterId: 'synthetic-empty' }, false)
  const projectDirectory = join(repository.root, first)
  mkdirSync(join(projectDirectory, 'drafts'))
  writeFileSync(join(projectDirectory, 'drafts', 'unregistered.js'), 'export const value = 4;')
  for (const [scope, ownerId] of [['global', ''], ['character', role.characterId]] as const) {
    data.saveScriptLibrary({ scope, ownerId, enabled: true, revision: 0, trees: [script], variables: {} })
  }
  const ownedScripts = data.readScriptWorkspace('character', role.characterId)
  const globalScripts = data.readScriptWorkspace('global', '')
  const journals = join(repository.index.root, '.character-deletions')
  const indexBefore = readFileSync(repository.index.path)
  const otherBefore = repository.workspace(other), applicationBefore = repository.workspace(application)
  const trigger = () => {
    const connection = new Database(join(directory, 'product.sqlite'))
    connection.exec(`CREATE TRIGGER synthetic_delete_failure BEFORE DELETE ON characters
      WHEN OLD.id='synthetic-character' BEGIN SELECT RAISE(ABORT,'Synthetic character deletion failure'); END;`)
    return () => { connection.exec('DROP TRIGGER synthetic_delete_failure'); connection.close() }
  }
  return { directory, ctx, connect, data, repository, first, second, shared, separate, ownedScripts, globalScripts,
    journals, indexBefore, otherBefore, applicationBefore, trigger }
}

describe('character deletion owns native frontend resources', () => {
  it('removes all role projects, unregistered project files and selection but keeps application and other role data', async () => {
    const f = await fixture()
    f.data.deleteCharacters([role.characterId, 'synthetic-empty', role.characterId])
    expect(f.data.readCharacters().items.map(item => item.id)).toEqual([other.characterId])
    for (const id of [f.first, f.second]) {
      expect(f.repository.index.get('projects', id)).toBeNull()
      expect(existsSync(join(f.repository.root, id))).toBe(false)
      expect(() => f.repository.readAsset(id, 'index.html')).toThrow('does not exist')
    }
    expect(f.repository.index.get('character-settings', role.characterId)).toBeNull()
    expect(f.repository.index.get('character-settings', 'synthetic-empty')).toBeNull()
    expect(() => f.repository.workspace(role)).toThrow('Character does not exist')
    expect(f.repository.workspace(other)).toEqual(f.otherBefore)
    expect(f.repository.workspace(application)).toEqual(f.applicationBefore)
    expect(f.repository.readAsset(f.shared, 'assets/data.bin').body).toEqual(Buffer.from([0, 128, 255]))
    expect(f.repository.readAsset(f.separate, 'assets/data.bin').body).toEqual(Buffer.from([0, 128, 255]))
    expect(existsSync(join(f.ownedScripts.path, f.ownedScripts.entries[0]!.file))).toBe(false)
    expect(readFileSync(join(f.globalScripts.path, f.globalScripts.entries[0]!.file), 'utf8')).toBe(script.content)
    expect(readdirSync(f.journals)).toEqual([])
    await f.ctx.fiber.dispose()
    const reopened = (await f.connect()).eleckoiProductData.frontendProjects()
    expect(reopened.workspace(other)).toEqual(f.otherBefore)
    expect(reopened.index.get('projects', f.first)).toBeNull()
    expect(existsSync(join(f.directory, 'author-plugins'))).toBe(false)
  }, 30_000)

  it('restores frontend files, selection, scripts and role data when the real SQLite deletion fails', async () => {
    const f = await fixture(), removeTrigger = f.trigger()
    cleanups.push(removeTrigger)
    const before = f.repository.workspace(role)
    expect(() => f.data.deleteCharacters([role.characterId])).toThrow('Synthetic character deletion failure')
    expect(f.data.readCharacters().items.some(item => item.id === role.characterId)).toBe(true)
    expect(f.repository.workspace(role)).toEqual(before)
    expect(readFileSync(f.repository.index.path)).toEqual(f.indexBefore)
    expect(f.repository.readAsset(f.first, 'assets/data.bin').body).toEqual(Buffer.from([0, 128, 255]))
    expect(readFileSync(join(f.repository.root, f.first, 'drafts', 'unregistered.js'), 'utf8')).toBe('export const value = 4;')
    expect(readFileSync(join(f.ownedScripts.path, f.ownedScripts.entries[0]!.file), 'utf8')).toBe(script.content)
    expect(readdirSync(f.journals)).toEqual([])
  }, 30_000)

  it('finishes interrupted index cleanup on reopen only after character deletion has committed', async () => {
    const f = await fixture()
    const failure = vi.spyOn(f.repository.index, 'atomic').mockImplementation(() => { throw new Error('Synthetic index failure') })
    expect(() => f.data.deleteCharacters([role.characterId])).toThrow('needs recovery')
    expect(f.data.readCharacters().items.some(item => item.id === role.characterId)).toBe(false)
    expect(readFileSync(f.repository.index.path)).toEqual(f.indexBefore)
    expect(readdirSync(f.journals)).toHaveLength(1)
    const pending = join(f.journals, readdirSync(f.journals)[0]!, 'projects', f.first, 'assets', 'data.bin')
    expect(readFileSync(pending)).toEqual(Buffer.from([0, 128, 255]))
    failure.mockRestore()
    await f.ctx.fiber.dispose()
    const reopened = (await f.connect()).eleckoiProductData.frontendProjects()
    expect(reopened.index.get('projects', f.first)).toBeNull()
    expect(reopened.index.get('projects', f.second)).toBeNull()
    expect(reopened.index.get('character-settings', role.characterId)).toBeNull()
    expect(reopened.workspace(other)).toEqual(f.otherBefore)
    expect(reopened.workspace(application)).toEqual(f.applicationBefore)
    expect(existsSync(pending)).toBe(false)
    expect(readdirSync(f.journals)).toEqual([])
  }, 30_000)

  it('restores an interrupted file rollback on reopen while the character still exists', async () => {
    const f = await fixture(), removeTrigger = f.trigger()
    cleanups.push(removeTrigger)
    const before = f.repository.workspace(role)
    const interruption = vi.spyOn((f.repository as any).characterDeletion, 'settle')
      .mockImplementationOnce(() => { throw new Error('Synthetic process interruption') })
    expect(() => f.data.deleteCharacters([role.characterId])).toThrow('needs recovery')
    expect(f.data.readCharacters().items.some(item => item.id === role.characterId)).toBe(true)
    expect(existsSync(join(f.repository.root, f.first))).toBe(false)
    expect(readdirSync(f.journals)).toHaveLength(1)
    interruption.mockRestore()
    await f.ctx.fiber.dispose()
    const reopened = (await f.connect()).eleckoiProductData.frontendProjects()
    expect(reopened.workspace(role)).toEqual(before)
    expect(reopened.readAsset(f.first, 'assets/data.bin').body).toEqual(Buffer.from([0, 128, 255]))
    expect(readFileSync(join(reopened.root, f.first, 'drafts', 'unregistered.js'), 'utf8')).toBe('export const value = 4;')
    expect(readFileSync(reopened.index.path)).toEqual(f.indexBefore)
    expect(readdirSync(f.journals)).toEqual([])
  }, 30_000)

  it('keeps pending resources and an externally changed index rather than guessing ownership during recovery', async () => {
    const f = await fixture()
    const failure = vi.spyOn(f.repository.index, 'atomic').mockImplementation(() => { throw new Error('Synthetic index failure') })
    expect(() => f.data.deleteCharacters([role.characterId])).toThrow('needs recovery')
    failure.mockRestore()
    const index = new FrontendIndex(f.repository.index.root)
    const original = index.get('projects', f.first) as Record<string, any>
    index.put('projects', f.first, { ...original, name: 'Synthetic external edit' })
    const changed = readFileSync(index.path), pending = readdirSync(f.journals)[0]!
    expect(() => new FrontendProjectRepository(index, () => false)).toThrow('changed during character deletion')
    expect(readFileSync(index.path)).toEqual(changed)
    expect(readFileSync(join(f.journals, pending, 'projects', f.first, 'assets', 'data.bin'))).toEqual(Buffer.from([0, 128, 255]))
  }, 30_000)
})
