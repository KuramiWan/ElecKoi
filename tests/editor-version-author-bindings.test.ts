import { describe, expect, it, vi } from 'vitest'
import { createNativeDisplayTemplateBindings } from '../packages/client/features/dsh-client-author/src/display-templates'

function fixture() {
  const remote = { readEditorLibraryVersions: vi.fn(async (address: any) => ({ ok: true, value: { ...address, revision: 0, resourceRevision: '',
    activeVersionId: 'default', versions: [{ id: 'default', name: '默认版本', content: '{"enabled":false,"templates":[]}' }] } })),
    saveEditorLibraries: vi.fn(async (request: any) => ({ ok: true, value: { documents: request.documents, versions: request.versions } })) }
  const presets = { catalog: vi.fn(async () => ({ ok: true, value: { activePresetIds: { roleplay: 'synthetic-preset' } } })) }
  const active = vi.fn(), bindings = createNativeDisplayTemplateBindings(remote as any, presets as any, 'synthetic-character', active)
  const invoke = (method: string, params: Record<string, unknown>, signal = new AbortController().signal) => bindings[method]!(params, { signal })
  return { remote, invoke, active }
}
describe('author complete configuration versions', () => {
  it('resolves global, bound character and current roleplay preset through explicit ownership', async () => {
    const f = fixture()
    for (const [scope, ownerId] of [['global', ''], ['character', 'synthetic-character'], ['preset', 'synthetic-preset']]) {
      await f.invoke('editorVersions.read', { kind: 'displayTemplates', scope })
      expect(f.remote.readEditorLibraryVersions).toHaveBeenLastCalledWith({ kind: 'displayTemplates', scope, ownerId })
    }
    await expect(f.invoke('editorVersions.read', { kind: 'unknown', scope: 'global' })).rejects.toThrow('类型无效')
  })
  it('refuses redirected documents and version catalogs before performing a Remote write', async () => {
    const f = fixture(), state = await f.invoke('editorVersions.read', { kind: 'displayTemplates', scope: 'character' }) as any
    const document = JSON.stringify({ scope: 'character', ownerId: 'synthetic-character', revision: 0, enabled: false, templates: [] })
    await f.invoke('editorVersions.save', { kind: 'displayTemplates', documents: [document], versions: [state] })
    expect(f.remote.saveEditorLibraries).toHaveBeenCalledTimes(1)
    for (const scope of ['character', 'preset']) await expect(f.invoke('editorVersions.save', {
      kind: 'displayTemplates', documents: [document], versions: [{ ...state, scope, ownerId: 'synthetic-other-owner' }],
    })).rejects.toThrow('本页角色')
    await expect(f.invoke('editorVersions.save', { kind: 'displayTemplates', documents: [JSON.stringify({ scope: 'character', ownerId: 'synthetic-other-owner' })], versions: [state] })).rejects.toThrow('本页角色')
    expect(f.remote.saveEditorLibraries).toHaveBeenCalledTimes(1)
  })
  it('rejects an already cancelled call without issuing a Remote request', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort(new Error('Synthetic cancelled'))
    await expect(f.invoke('editorVersions.read', { kind: 'displayTemplates', scope: 'character' }, controller.signal)).rejects.toThrow('Synthetic cancelled')
    expect(f.remote.readEditorLibraryVersions).not.toHaveBeenCalled()
  })
})
