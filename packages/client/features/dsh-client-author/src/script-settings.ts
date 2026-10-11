import { AuthorApiError } from '@eleckoi/author-sdk'
import type { AuthorVariableBinding } from '@eleckoi/author-sdk/browser'
import type { Context } from '@deepseek-ai/cordis'
import type { NativeAuthorScriptIdentity } from '@eleckoi/dsh-product-api/types'
import type {} from '@eleckoi/dsh-product-api/remote'

export function createNativeScriptSettingsBindings(remote: Context['remote']['eleckoiAuthorScripts'],
  conversationId: string, version: string, identity: NativeAuthorScriptIdentity,
  saved: () => Promise<void>): Record<string, AuthorVariableBinding> {
  const methods: Record<string, AuthorVariableBinding> = {}
  for (const target of ['script', 'library'] as const) {
    const suffix = target === 'script' ? 'Settings' : 'LibrarySettings'
    methods[`script.get${suffix}`] = async (_params, { signal }) => {
      const result = await remote.getSettings(conversationId, version, identity, target, signal)
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      return result.value
    }
    methods[`script.set${suffix}`] = async (params, { signal }) => {
      if (!Number.isSafeInteger(params.expectedRevision) || Number(params.expectedRevision) < 0 || typeof params.settingsJson !== 'string') {
        throw new AuthorApiError('INVALID_PARAMS', '保存设置需要 JSON 对象及最近读取的修改版本')
      }
      const result = await remote.setSettings(conversationId, version, identity, target,
        params.settingsJson, Number(params.expectedRevision), signal)
      if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
      await saved()
      return result.value
    }
  }
  return methods
}
