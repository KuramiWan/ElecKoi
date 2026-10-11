import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { applyAuthorVariablePatch, mergeAuthorVariableState, type AuthorVariablePatch } from '@eleckoi/author-sdk'
import type { VariableConfig } from './types.js'
import type { ElecKoiVariableProcessing } from './variable-processing.js'

declare module '@deepseek-ai/cordis' {
  interface Context { eleckoiAuthorVariablesApi: ElecKoiAuthorVariablesApi }
}

function objectJson(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('变量状态必须是 JSON 对象。')
  return value as Record<string, unknown>
}

/** Native author variables share the Agent candidate processor and product repository. */
export class ElecKoiAuthorVariablesApi extends TypertRemoteService {
  static inject = ['typert', 'eleckoiProductData', 'eleckoiVariableProcessing', 'eleckoiConversationChanges']
  private readonly owner: Context

  constructor(ctx: Context) {
    super(ctx, 'eleckoiAuthorVariablesApi', { namespace: 'eleckoiAuthorVariables' })
    this.owner = ctx
  }

  /**
   * 读取原生聊天的当前变量，不返回历史消息或其他聊天的状态。
   * @param conversationId - ElecKoi 聊天编号。
   * @returns 当前变量对象的 JSON 文本。
   */
  @Remote
  getState(conversationId: string): string {
    const json = this.owner.eleckoiProductData.readAuthorConversationState(conversationId).currentVariableStateJson
    objectJson(json)
    return json
  }

  /**
   * 读取该聊天绑定的原生变量配置。
   * @param conversationId - ElecKoi 聊天编号。
   * @returns 变量配置；未绑定角色变量配置时返回 null。
   */
  @Remote
  getConfig(conversationId: string): VariableConfig | null {
    return structuredClone(this.owner.eleckoiProductData.readAuthorConversationState(conversationId).variableConfig)
  }

  /**
   * 替换当前变量，等待作者规则处理后才保存。
   * @param conversationId - ElecKoi 聊天编号。
   * @param stateJson - 完整变量对象的 JSON 文本。
   * @param signal - 取消处理；取消后不保存候选数据。
   * @returns 已接受并保存的变量对象 JSON 文本。
   */
  @Remote
  async setState(conversationId: string, stateJson: string, signal: AbortSignal): Promise<string> {
    const state = objectJson(stateJson)
    return this.mutate(conversationId, () => structuredClone(state), signal)
  }

  /**
   * 将对象递归合并到本次原生变量候选，数组与标量替换对应字段。
   * @param conversationId - ElecKoi 聊天编号。
   * @param stateJson - 合并对象的 JSON 文本。
   * @param signal - 取消处理；取消后不保存候选数据。
   * @returns 已接受并保存的变量对象 JSON 文本。
   */
  @Remote
  async merge(conversationId: string, stateJson: string, signal: AbortSignal): Promise<string> {
    const state = objectJson(stateJson)
    return this.mutate(conversationId, candidate => mergeAuthorVariableState(candidate, state), signal)
  }

  /**
   * 按原生 SDK 的 add、replace、remove 与 JSON Pointer 修改变量候选。
   * @param conversationId - ElecKoi 聊天编号。
   * @param patchJson - 原生变量补丁数组的 JSON 文本。
   * @param signal - 取消处理；取消后不保存候选数据。
   * @returns 已接受并保存的变量对象 JSON 文本。
   */
  @Remote
  async applyPatch(conversationId: string, patchJson: string, signal: AbortSignal): Promise<string> {
    const patch: unknown = JSON.parse(patchJson)
    if (!Array.isArray(patch)) throw new TypeError('变量补丁必须是数组。')
    return this.mutate(conversationId, candidate => applyAuthorVariablePatch(candidate, patch as AuthorVariablePatch[]), signal)
  }

  /**
   * 用聊天绑定的初始变量发起一次原生修改，仍等待作者规则完成。
   * @param conversationId - ElecKoi 聊天编号。
   * @param signal - 取消处理；取消后不保存候选数据。
   * @returns 已接受并保存的变量对象 JSON 文本。
   */
  @Remote
  async reset(conversationId: string, signal: AbortSignal): Promise<string> {
    const initial = objectJson(this.owner.eleckoiProductData.readAuthorConversationState(conversationId).initialVariableStateJson)
    return this.mutate(conversationId, () => structuredClone(initial), signal)
  }

  private async mutate(conversationId: string, apply: Parameters<ElecKoiVariableProcessing['mutate']>[1], signal: AbortSignal): Promise<string> {
    const json = await this.owner.eleckoiVariableProcessing.mutate(conversationId, apply, signal)
    this.owner.eleckoiConversationChanges.publish({ kind: 'messages', conversationId, reason: 'edited', messageIds: [] })
    return json
  }
}
