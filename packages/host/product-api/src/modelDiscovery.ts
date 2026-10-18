import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { CredentialProvider, credentialRef, type CredentialKey, type CredentialRecord, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai'
import * as deepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import type { ModelDiscoveryInput, ModelDiscoveryResult } from './types.js'
import { productFailure } from './productFailure.js'
import { ELECKOI_FAILURE_CODES } from './errorCodes.generated.js'

/**
 * 目录读取用的凭据提供器只能读：写入 / 删除一律拒绝（同一句诊断，不重复长表达式）。
 * @returns 带 `security/denied` 码的失败对象。
 */
function discoveryReadOnly() {
  return productFailure(ELECKOI_FAILURE_CODES.securityDenied, '目录读取凭据不能持久化。', { what: '目录读取凭据', guard: '只读凭据提供器' })
}

/** Credentials for one directory read lifetime. No mutation reaches the durable store. */
class DiscoveryCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly key: string, private readonly stored: CredentialProvider) { super(ctx) }
  async resolve(_ref: CredentialRef) { return this.key ? { value: this.key, source: 'discovery' } : undefined }
  async describe(_ref: CredentialRef) { return { configured: Boolean(this.key), writable: false, source: 'discovery' } }
  async set(_ref: CredentialRef, _value: string): Promise<void> { throw discoveryReadOnly() }
  async unset(_ref: CredentialRef): Promise<void> { throw discoveryReadOnly() }
  async readRecord(key: CredentialKey) { return this.stored.readRecord(key) }
  async describeRecord(key: CredentialKey) { return this.stored.describeRecord(key) }
  async listRecords() { return this.stored.listRecords() }
  async modifyRecord(_key: CredentialKey, _mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined> { throw discoveryReadOnly() }
  async deleteRecord(_key: CredentialKey): Promise<void> { throw discoveryReadOnly() }
}

/** Read the credential owned by one saved model configuration on user request. */
export async function readModelApiKey(owner: Context, configId: string): Promise<string> {
  const namespaces = owner.settings.describe()
  const entries = (namespaces.find(row => row.ns === 'eleckoi-client-models')?.value as {
    entries?: Record<string, { credentialRef?: string; hidden?: boolean }>
  } | undefined)?.entries
  const profile = (namespaces.find(row => row.ns === 'llm-pi-ai')?.value as {
    providers?: Record<string, { apiKeyEnv?: string }>
  } | undefined)?.providers?.[configId]
  const dedicated = configId === 'deepseek-official'
    ? namespaces.find(row => row.ns === 'llm-deepseek')?.value as { apiKeyEnv?: string } | undefined
    : undefined
  const entry = entries?.[configId]
  if (entry?.hidden || (!entry && !profile && !dedicated)) throw productFailure(ELECKOI_FAILURE_CODES.lookupNotFound, '模型配置不存在。', { what: '模型配置' })
  const ref = entry?.credentialRef || profile?.apiKeyEnv || dedicated?.apiKeyEnv
    || (dedicated ? 'DEEPSEEK_API_KEY' : `${configId.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`)
  const credential = await owner.credentials.resolve(credentialRef(ref))
  if (!credential) throw productFailure(ELECKOI_FAILURE_CODES.lookupNotFound, '此模型配置没有已保存的 API Key。', { what: '此模型配置已保存的 API Key' })
  return credential.value
}

/** Resolve only the credential reference belonging to the current draft. */
async function draftKey(owner: Context, input: ModelDiscoveryInput): Promise<string> {
  const namespaces = owner.settings.describe()
  const row = namespaces.find(row => row.ns === 'eleckoi-client-models')
  const entries = (row?.value as { entries?: Record<string, { credentialRef?: string }> } | undefined)?.entries
  const profiles = namespaces.find(row => row.ns === 'llm-pi-ai')?.value as { providers?: Record<string, { apiKeyEnv?: string }> } | undefined
  const dedicated = namespaces.find(row => row.ns === 'llm-deepseek')?.value as { apiKeyEnv?: string } | undefined
  const ref = entries?.[input.configId]?.credentialRef
    || (input.api === 'deepseek_messages' ? dedicated?.apiKeyEnv : profiles?.providers?.[input.configId]?.apiKeyEnv)
    || (input.api === 'deepseek_messages' ? 'DEEPSEEK_API_KEY' : `${input.configId.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`)
  return input.apiKey?.trim() || (await owner.credentials.resolve(credentialRef(ref)))?.value || ''
}

/** Read the dedicated directory or discover a draft without persisting it. */
export async function discoverDraftModels(owner: Context, input: ModelDiscoveryInput): Promise<ModelDiscoveryResult[]> {
  if (input.builtinProvider && input.builtinProvider !== input.configId) throw productFailure(ELECKOI_FAILURE_CODES.inputInvalid, '内置提供商必须使用目录中的 Provider ID。', { field: 'configId' })
  const key = input.builtinProvider ? '' : await draftKey(owner, input)
  const ctx = new Context()
  const provider = 'eleckoi-discovery-probe'
  try {
    new DiscoveryCredentials(ctx, key, owner.credentials)
    await ctx.plugin(LlmRuntime)
    if (input.builtinProvider && input.builtinProvider !== 'deepseek-official') {
      const routes = owner.llm.listConfigurableProviders()
      if (!routes.some(route => route.provider === input.builtinProvider && route.settingsNs === 'llm-pi-ai' && route.declared === false)) throw productFailure(ELECKOI_FAILURE_CODES.lookupNotFound, '内置提供商不在当前 DSH 目录中。', { what: '当前 DSH 目录里的内置提供商' })
      await ctx.plugin(piAi, { providers: { [input.builtinProvider]: {} } })
      const models = await ctx.llm.listModels(input.builtinProvider)
      return await Promise.all(models.map(async model => {
        const info = await ctx.llm.resolveModelInfo(input.builtinProvider!, model.id)
        return { id: model.id, name: model.name,
          ...(info.context ? { contextWindow: info.context.contextWindow } : {}),
          ...(info.defaultMaxTokens === undefined ? {} : { maxTokens: info.defaultMaxTokens }),
          ...(info.inputModalities ? { inputModalities: info.inputModalities } : {}),
          ...(info.reasoning ? { reasoningEfforts: Object.fromEntries(info.reasoning.efforts.map(effort => [effort.id, effort.id === 'off' ? null : effort.id])), reasoningEffort: info.reasoning.defaultEffort } : {}),
        }
      }))
    }
    if (input.api === 'deepseek_messages') {
      const settings = owner.settings.describe().find(row => row.ns === 'llm-deepseek')?.value as deepSeek.Options | undefined
      await ctx.plugin(deepSeek, { apiKeyEnv: 'PROBE_API_KEY', baseURL: input.baseURL,
        ...(settings?.thinking === undefined ? {} : { thinking: settings.thinking }),
        ...(settings?.reasoningEffort === undefined ? {} : { reasoningEffort: settings.reasoningEffort }),
      })
      const models = await ctx.llm.listModels('deepseek-official')
      return await Promise.all(models.map(async model => {
        const info = await ctx.llm.resolveModelInfo('deepseek-official', model.id)
        return { id: model.id, name: model.name,
          ...(info.context === undefined ? {} : { contextWindow: info.context.contextWindow }),
          ...(info.defaultMaxTokens === undefined ? {} : { maxTokens: info.defaultMaxTokens }),
          ...(info.inputModalities === undefined ? {} : { inputModalities: info.inputModalities }),
          ...(info.reasoning === undefined ? {} : {
            reasoningEfforts: Object.fromEntries(info.reasoning.efforts.map(effort => [effort.id, effort.id === 'off' ? null : effort.id])),
            ...(info.reasoning.defaultEffort === undefined ? {} : { reasoningEffort: info.reasoning.defaultEffort }),
          }),
        }
      }))
    }
    await ctx.plugin(piAi, { providers: { [provider]: {
      apiKeyEnv: 'PROBE_API_KEY', api: input.api, baseURL: input.baseURL,
      headers: input.headers || {}, models: [],
    } } })
    return await ctx.llm.discoverModels('llm-pi-ai', { provider, api: input.api,
      baseURL: input.baseURL, ...(key ? { apiKey: key } : {}) }, AbortSignal.timeout(30_000))
  } finally { await ctx.fiber.dispose() }
}
