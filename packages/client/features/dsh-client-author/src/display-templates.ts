import { AuthorApiError, type AuthorDisplayTemplateLibrary, type AuthorEditorLibraryVersions } from '@eleckoi/author-sdk'
import type { AuthorVariableBinding } from '@eleckoi/author-sdk/browser'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@eleckoi/dsh-product-api/remote'

export function createNativeDisplayTemplateBindings(
  remote: Context['remote']['eleckoiCharacterConfiguration'],
  presets: Context['remote']['eleckoiAgentPresets'],
  characterId: string,
  assertActive: () => void,
): Record<string, AuthorVariableBinding> {
  async function owner(scope: unknown, signal: AbortSignal) {
    signal.throwIfAborted(); assertActive()
    if (scope === 'global') return ''
    if (scope === 'character') {
      if (!characterId) throw new AuthorApiError('CHARACTER_REQUIRED', '页面尚未绑定角色')
      return characterId
    }
    if (scope !== 'preset') throw new AuthorApiError('INVALID_PARAMS', '显示模板 scope 必须是 global、character 或 preset')
    const result = await presets.catalog()
    signal.throwIfAborted(); assertActive()
    if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
    return result.value.activePresetIds.roleplay
  }
  return {
    'editorVersions.read': async (params, { signal }) => {
      const kind = params.kind as AuthorEditorLibraryVersions['kind']
      if (!['scripts', 'displayTemplates', 'regex'].includes(kind)) throw new AuthorApiError('INVALID_PARAMS', '配置版本类型无效')
      const ownerId = await owner(params.scope, signal)
      const result = await remote.readEditorLibraryVersions({ kind, scope: params.scope as AuthorEditorLibraryVersions['scope'], ownerId })
      signal.throwIfAborted(); assertActive()
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      return result.value
    },
    'editorVersions.save': async (params, { signal }) => {
      const kind = params.kind as AuthorEditorLibraryVersions['kind'], documents = params.documents as string[], versions = params.versions as AuthorEditorLibraryVersions[]
      if (!['scripts', 'displayTemplates', 'regex'].includes(kind) || !Array.isArray(documents) || !documents.length || !Array.isArray(versions)) {
        throw new AuthorApiError('INVALID_PARAMS', '配置版本保存格式无效')
      }
      const addresses = [...versions, ...documents.map(document => {
        const value = JSON.parse(document)
        return kind === 'regex' ? value.target : value
      })]
      for (const address of addresses) {
        if (!address || address.ownerId !== await owner(address.scope, signal)) throw new AuthorApiError('CONTEXT_MISMATCH', '配置版本必须属于本页角色、共享全局或当前扮演预设')
      }
      const result = await remote.saveEditorLibraries({ kind, documents, versions })
      signal.throwIfAborted(); assertActive()
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      return result.value
    },
    'displayTemplates.read': async (params, { signal }) => {
      const ownerId = await owner(params.scope, signal)
      const result = await remote.readDisplayTemplates(params.scope as 'global' | 'character' | 'preset', ownerId)
      signal.throwIfAborted(); assertActive()
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      return result.value
    },
    'displayTemplates.save': async (params, { signal }) => {
      const library = params.library as AuthorDisplayTemplateLibrary | undefined
      if (!library || !Array.isArray(library.templates)) throw new AuthorApiError('INVALID_PARAMS', '显示模板库格式不正确')
      const ownerId = await owner(library.scope, signal)
      if (library.ownerId !== ownerId) throw new AuthorApiError('CONTEXT_MISMATCH', '作者页面不能修改其他角色或未选中的预设显示模板')
      const result = await remote.saveDisplayTemplates(library)
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      signal.throwIfAborted(); assertActive()
      return result.value
    },
  }
}
