import { AuthorApiError, type AuthorChatSummary, type AuthorChatModelCatalog, type AuthorGenerationIdentity } from '@eleckoi/author-sdk'
import type { AuthorVariableBinding } from '@eleckoi/author-sdk/browser'
import type { Context } from '@deepseek-ai/cordis'
import type { ElecKoiConversations, ConversationClientDetails } from '@eleckoi/dsh-client-conversations/client'
import type { ElecKoiModels } from '@eleckoi/dsh-client-models/client'
import type { CharacterRecord, ConversationSummary, ConversationMetadata } from '@eleckoi/dsh-product-api/types'
import type {} from '@eleckoi/dsh-product-api/remote'
import { createNativeTrajectoryBinding } from './trajectory.js'
import { nativeGenerationStats } from './generation.js'

function summary(record: ConversationClientDetails['conversation'], metadata: ConversationMetadata): AuthorChatSummary {
  return { id: record.id, title: record.title, preview: record.preview, createdAt: record.createdAt, updatedAt: record.updatedAt,
    characterId: metadata.characterId, characterName: metadata.characterName, characterAvatar: metadata.characterAvatar }
}

/** Commands use the existing catalog, model selection and conversation owners. */
export function createNativeChatBindings(
  conversations: ElecKoiConversations,
  models: ElecKoiModels,
  remote: Pick<Context['remote'], 'eleckoiCharacters'>,
  chatId: string,
  assertActive: () => void,
  generationIdentity: () => (Pick<AuthorGenerationIdentity, 'generationId' | 'turn'> & { sequence: number }) | null,
): Record<string, AuthorVariableBinding> {
  const details = () => {
    assertActive()
    const current = conversations.getDetailsSnapshot().details
    if (!current || current.conversation.id !== chatId) throw new AuthorApiError('CHAT_NOT_READY', '聊天资料尚未就绪。')
    return current
  }
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); assertActive() }
  const target = async (params: Record<string, unknown>, signal: AbortSignal) => {
    if (typeof params.id !== 'string' || !params.id) throw new AuthorApiError('INVALID_PARAMS', '请提供明确的聊天编号。')
    const characterId = details().metadata.characterId
    const items = await conversations.refresh()
    check(signal)
    const matches = items.filter(item => item.id === params.id)
    if (!matches.length) throw new AuthorApiError('CHAT_NOT_FOUND', '指定聊天不在当前聊天库中。')
    if (matches.length !== 1) throw new AuthorApiError('AMBIGUOUS_CHAT', '指定聊天的编号不唯一。')
    if (matches[0]!.metadata.characterId !== characterId) throw new AuthorApiError('CHAT_SCOPE_MISMATCH', '作者页面只能操作同一角色的聊天。')
    return { id: params.id, characterId }
  }
  const character = async (): Promise<CharacterRecord | null> => {
    const characterId = details().metadata.characterId
    if (!characterId) return null
    const result = await remote.eleckoiCharacters.list()
    if (!result.ok) throw new AuthorApiError(result.error.code, result.error.message)
    const matches = result.value.items.filter(item => item.id === characterId)
    if (matches.length !== 1) throw new AuthorApiError('CHARACTER_NOT_AVAILABLE', '聊天绑定的角色不在当前角色库中，或编号不唯一。')
    return structuredClone(matches[0]!)
  }
  const methods: Record<string, AuthorVariableBinding> = {
    'chat.getAgentTrajectory': createNativeTrajectoryBinding(conversations, chatId, assertActive),
    'chat.current': async () => { const value = details(); return summary(value.conversation, value.metadata) },
    'chat.list': async (_params, { signal }) => {
      const characterId = details().metadata.characterId
      const items: ConversationSummary[] = await conversations.refresh()
      check(signal)
      return { items: items.filter(item => item.metadata.characterId === characterId).map(item => summary(item, item.metadata)) }
    },
    'chat.open': async (params, options) => {
      const destination = await target(params, options.signal)
      options.commitContextChange?.()
      const opened = await conversations.open(destination.id)
      options.signal.throwIfAborted()
      if (!opened || conversations.getDetailsSnapshot().id !== destination.id) {
        throw new AuthorApiError('NAVIGATION_SUPERSEDED', '聊天切换已被后续操作替代。')
      }
      if (opened.conversation.id !== destination.id || opened.metadata.characterId !== destination.characterId) {
        throw new AuthorApiError('INVALID_CHAT_RESULT', '打开的聊天与指定编号或角色不一致。')
      }
      return { chat: summary(opened.conversation, opened.metadata) }
    },
    'chat.delete': async (params, options) => {
      const destination = await target(params, options.signal)
      options.commitContextChange?.()
      await conversations.delete(destination.id)
      options.signal.throwIfAborted()
      const selected = conversations.getDetailsSnapshot(), current = selected.details
      return { deletedId: destination.id, chat: current && current.conversation.id === selected.id
        ? summary(current.conversation, current.metadata) : null }
    },
    'character.current': async () => character(),
    'chat.create': async (params, { signal }) => {
      if (params.title !== undefined && typeof params.title !== 'string') throw new AuthorApiError('INVALID_PARAMS', '聊天标题必须是文本。')
      const card = await character()
      check(signal)
      if (!card) throw new AuthorApiError('CHARACTER_REQUIRED', '创建角色聊天需要当前聊天绑定一个角色。')
      const created = await conversations.create({ ...(params.title === undefined ? {} : { title: params.title as string }),
        metadata: { characterId: card.id, characterName: card.name ?? '', characterAvatar: card.avatar ?? '',
          ...(card.persona === undefined ? {} : { characterPersona: card.persona }) } })
      check(signal)
      if (!created.conversation.id || created.metadata.characterId !== card.id) throw new AuthorApiError('INVALID_CHAT_RESULT', '新聊天没有明确的角色归属。')
      return { chat: summary(created.conversation, created.metadata) }
    },
    'chat.getModels': async (_params, { signal }): Promise<AuthorChatModelCatalog> => {
      const configs = await models.refresh()
      check(signal)
      const current = await conversations.readModelSelection(chatId)
      check(signal)
      // Only author-facing fields cross the page boundary, never credentials or headers.
      return { current: { configId: current.provider, model: current.model,
        ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }) }, items: configs.map(config => ({
        configId: config.id, name: config.name ?? '', provider: config.provider ?? '', defaultModel: config.model ?? '',
        ...(config.enabled === undefined ? {} : { enabled: config.enabled }),
        models: (config.model_options ?? []).map(model => ({ id: model.id, name: model.name,
          ...(model.contextWindowTokens === undefined ? {} : { contextWindowTokens: model.contextWindowTokens }),
          ...(model.autoCompactTokenLimit === undefined ? {} : { autoCompactTokenLimit: model.autoCompactTokenLimit }),
          ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
          ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
          ...(model.topP === undefined ? {} : { topP: model.topP }),
          ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
          ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: structuredClone(model.reasoningEfforts) }),
          ...(model.inputModalities === undefined ? {} : { inputModalities: [...model.inputModalities] }),
          ...(model.supportsImageInput === undefined ? {} : { supportsImageInput: model.supportsImageInput }),
        })),
      })) }
    },
    'chat.selectModel': async (params, { signal }) => {
      if (typeof params.configId !== 'string' || !params.configId || typeof params.model !== 'string' || !params.model
        || params.reasoningEffort !== undefined && typeof params.reasoningEffort !== 'string') {
        throw new AuthorApiError('INVALID_PARAMS', '请选择明确的模型配置编号和模型编号。')
      }
      const selected = await conversations.selectModel(chatId, { provider: params.configId, model: params.model,
        ...(params.reasoningEffort === undefined ? {} : { reasoningEffort: params.reasoningEffort as string }) })
      check(signal)
      return { configId: selected.provider, model: selected.model,
        ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }) }
    },
    'chat.getGenerationState': async () => {
      const stream = conversations.getStreamSnapshot(), statsSnapshot = conversations.getStatsSnapshot()
      const source = statsSnapshot.id === chatId ? statsSnapshot.stats : null
      const stats = nativeGenerationStats(source)
      const identity = generationIdentity()
      return stream.id === chatId && stream.status === 'running'
        ? { active: true, conversationId: chatId, runId: stream.runId, messageId: stream.messageId,
          generationId: identity?.generationId ?? null, turn: stream.dshTurn ?? null,
          accumulated: stream.content, sequence: identity?.sequence ?? stream.sequence, stats }
        : { active: false, conversationId: chatId, stats }
    },
  }
  return Object.fromEntries(Object.entries(methods).map(([method, run]) => [method, async (params, options) => {
    check(options.signal)
    const result = await run(params, options)
    if (method === 'chat.open' || method === 'chat.delete') options.signal.throwIfAborted()
    else check(options.signal)
    return result
  }]))
}
