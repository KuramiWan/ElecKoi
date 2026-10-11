import { AuthorApiError, type AuthorMessage, type AuthorMessagePage, type AuthorMediaResource } from '@eleckoi/author-sdk'
import type { AuthorVariableBinding } from '@eleckoi/author-sdk/browser'
import type { ElecKoiConversations, ConversationClientDetails, ConversationClientMessage } from '@eleckoi/dsh-client-conversations/client'

function objectState(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthorApiError('INVALID_VARIABLE_HISTORY', '历史变量不是 JSON 对象。')
  return value as Record<string, unknown>
}

function historicalState(message: ConversationClientMessage): Record<string, unknown> | null {
  return message.nativeVariableStateJson === undefined ? null : objectState(message.nativeVariableStateJson)
}

function messageId(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new AuthorApiError('INVALID_PARAMS', '需要明确的消息编号。')
  return value
}

function findMessage(details: ConversationClientDetails, id: unknown): ConversationClientMessage {
  const key = messageId(id), matches = details.messages.filter(message => message.id === key)
  if (matches.length !== 1) throw new AuthorApiError('MESSAGE_NOT_AVAILABLE', '当前已加载历史中没有唯一的指定消息。')
  return matches[0]!
}

function eventSequence(message: ConversationClientMessage, details: ConversationClientDetails): number {
  if (!message.runtimeSessionId || message.runtimeSessionId !== details.runtimeSessionId
    || !Number.isSafeInteger(message.sessionEventSeq) || message.sessionEventSeq! < 0) {
    throw new AuthorApiError('MESSAGE_NOT_PERSISTED', '消息还没有可操作的正式 Session 身份。')
  }
  return message.sessionEventSeq!
}

async function attachments(conversations: ElecKoiConversations, chatId: string, message: ConversationClientMessage): Promise<AuthorMediaResource[]> {
  const items: AuthorMediaResource[] = []
  for (const image of message.inputImageAttachments || []) {
    if ('mediaType' in image) items.push({ id: image.attachmentId, type: 'image',
      url: await conversations.readImage(chatId, image), mimeType: image.mediaType, name: image.name ?? '',
      size: image.bytes, width: image.width, height: image.height, duration: null,
      metadata: image.originalDimensions ? { originalDimensions: { ...image.originalDimensions } } : {} })
    else items.push({ id: image.attachmentId, type: 'image', url: image.dataUrl, mimeType: null,
      name: image.name, size: null, width: image.width ?? null, height: image.height ?? null, duration: null, metadata: {} })
  }
  for (const file of message.inputFileAttachments || []) items.push({ id: file.attachmentId, type: 'file',
    url: null, mimeType: null, name: file.name, size: file.bytes, width: null, height: null, duration: null, metadata: {} })
  return items
}

export async function publicMessage(conversations: ElecKoiConversations, chatId: string, message: ConversationClientMessage): Promise<AuthorMessage> {
  if (typeof message.content !== 'string') throw new AuthorApiError('MESSAGE_NOT_READY', '消息正文尚未完成投影。')
  return { id: message.id, conversationId: chatId, role: message.role, content: message.content,
    displayContent: message.displayContent ?? message.content, variableState: historicalState(message),
    status: message.status, createdAt: message.createdAt, turnId: message.turnId ?? '', speakerId: message.speakerId ?? '',
    speakerName: message.speakerName ?? '', speakerAvatar: message.speakerAvatar ?? '', sequence: message.sequence ?? null,
    responseIndex: message.responseIndex ?? null, process: structuredClone(message.process || []),
    attachments: await attachments(conversations, chatId, message),
    openingOptions: (message.openingOptions || []).map(option => ({ id: option.id, title: option.title, content: option.content,
      ...(option.displayContent === undefined ? {} : { displayContent: option.displayContent }),
      initialVariableState: objectState(option.initialVariableStateJson) })), selectedOpeningId: message.selectedOpeningId ?? '' }
}

/** Fixed-chat commands consume the injected conversation owner, not a second transcript. */
export function createNativeMessageBindings(
  conversations: ElecKoiConversations,
  chatId: string,
  ownerMessageId: string,
  assertActive: () => void,
  createRequestId: () => string
): Record<string, AuthorVariableBinding> {
  const details = () => {
    assertActive()
    const value = conversations.getDetailsSnapshot().details
    if (!value || value.conversation.id !== chatId) throw new AuthorApiError('CHAT_NOT_READY', '聊天消息尚未就绪。')
    return value
  }
  const page = async (value: ConversationClientDetails): Promise<AuthorMessagePage> => ({
    items: await Promise.all(value.messages.map(message => publicMessage(conversations, chatId, message))),
    hasMore: value.hasMore, beforeSequence: value.beforeSequence,
  })
  const regenerate = async (params: Record<string, unknown>, { signal }: { signal: AbortSignal }, editing: boolean) => {
    const value = details(), target = findMessage(value, params.id)
    if (editing && (target.role !== 'user' || typeof params.text !== 'string' || !params.text.trim())) {
      throw new AuthorApiError('INVALID_PARAMS', '修改并重新生成需要非空用户消息。')
    }
    if (!editing && target.role !== 'assistant') throw new AuthorApiError('INVALID_PARAMS', '重新生成需要指定 AI 消息。')
    eventSequence(target, value)
    const candidates = editing ? [target] : value.messages.filter(input => input.role === 'user'
      && input.runtimeSessionId === target.runtimeSessionId && (target.inputEventSeq !== undefined
        ? input.sessionEventSeq === target.inputEventSeq
        : Number.isSafeInteger(target.dshTurn) && input.dshTurn === target.dshTurn))
    if (candidates.length !== 1) throw new AuthorApiError('INPUT_NOT_AVAILABLE', '当前历史没有该回复明确关联的唯一用户输入，请先加载对应历史。')
    const input = candidates[0]!, eventSeq = eventSequence(input, value), requestId = createRequestId()
    const result = await conversations.regenerate({ conversationId: chatId, eventSeq, requestId, signal,
      ...(editing ? { replacementMessage: params.text as string } : {}) })
    signal.throwIfAborted(); assertActive()
    if (result.cancelled) throw new AuthorApiError('GENERATION_CANCELLED', '重新生成已取消。')
    const replies = result.details?.messages.filter(message => message.role === 'assistant'
      && message.runtimeSessionId === value.runtimeSessionId && message.inputEventSeq === eventSeq) || []
    if (result.details?.conversation.id !== chatId || result.details.runtimeSessionId !== value.runtimeSessionId || replies.length !== 1) {
      throw new AuthorApiError('INVALID_RUN_RESULT', '重新生成结果没有唯一的正式回复身份。')
    }
    return { accepted: true, conversationId: chatId, runId: value.runtimeSessionId, messageId: replies[0]!.id }
  }
  const methods: Record<string, AuthorVariableBinding> = {
    'messages.list': async () => (await page(details())).items,
    'messages.getPage': async () => page(details()),
    'messages.pageOlder': async (params, { signal }) => {
      const value = details()
      if (!value.hasMore || !Number.isSafeInteger(params.beforeSequence) || params.beforeSequence !== value.beforeSequence) {
        throw new AuthorApiError('STALE_HISTORY_CURSOR', '历史游标已变化或没有更早的消息，请重新读取当前页。')
      }
      const result = await conversations.pageOlder(chatId, params.beforeSequence as number)
      signal.throwIfAborted(); assertActive()
      if (!result || result.conversation.id !== chatId) throw new AuthorApiError('STALE_HISTORY_CURSOR', '历史加载期间当前页已变化。')
      return page(result)
    },
    'messages.get': async params => publicMessage(conversations, chatId, findMessage(details(), params.id)),
    'messages.current': async () => {
      const value = details().messages.at(-1)
      if (!value) throw new AuthorApiError('MESSAGE_NOT_AVAILABLE', '当前聊天没有消息。')
      return publicMessage(conversations, chatId, value)
    },
    'messages.setContent': async (params, { signal }) => {
      if (typeof params.text !== 'string') throw new AuthorApiError('INVALID_PARAMS', '消息正文必须是文本。')
      const value = details(), target = findMessage(value, params.id)
      const result = target.id === 'opening' ? await conversations.updateOpening(chatId, params.text)
        : await conversations.editMessage(chatId, eventSequence(target, value), target.role, params.text)
      signal.throwIfAborted(); assertActive()
      if (!result || result.conversation.id !== chatId) throw new AuthorApiError('MESSAGE_NOT_AVAILABLE', '消息已保存，但当前聊天投影尚不可用。')
      return publicMessage(conversations, chatId, findMessage(result, target.id))
    },
    'messages.deleteFrom': async (params, { signal }) => {
      const value = details(), target = findMessage(value, params.id)
      const result = await conversations.deleteMessagesFrom(chatId, eventSequence(target, value), target.role)
      signal.throwIfAborted(); assertActive()
      return { ok: true, deletedMessageCount: result.deletedMessageCount, remainingMessageCount: result.remainingMessageCount }
    },
    'messages.regenerate': (params, options) => regenerate(params, options, false),
    'messages.editAndRegenerate': async (params, options) => {
      if (typeof params.text !== 'string') throw new AuthorApiError('INVALID_PARAMS', '修改并重新生成需要用户消息文本。')
      return regenerate(params, options, true)
    },
    'variables.getState': async params => {
      const state = historicalState(findMessage(details(), params.messageId))
      if (state === null) throw new AuthorApiError('VARIABLE_HISTORY_NOT_AVAILABLE', '指定消息没有准确的原生历史变量。')
      return state
    },
    'media.getMessageAttachments': async params => {
      const value = details(), id = params.messageId === undefined ? (ownerMessageId || undefined) : params.messageId
      const message = id === undefined ? value.messages.at(-1) : findMessage(value, id)
      if (!message) throw new AuthorApiError('MESSAGE_NOT_AVAILABLE', '当前聊天没有消息。')
      return { items: await attachments(conversations, chatId, message) }
    },
    'media.getMessageAttachment': async params => {
      const message = findMessage(details(), params.messageId), key = messageId(params.attachmentId)
      const images = (message.inputImageAttachments || []).filter(item => item.attachmentId === key)
      const files = (message.inputFileAttachments || []).filter(item => item.attachmentId === key)
      if (images.length + files.length !== 1) throw new AuthorApiError('MEDIA_NOT_AVAILABLE', '指定消息没有唯一的该附件。')
      return (await attachments(conversations, chatId, { ...message, inputImageAttachments: images, inputFileAttachments: files }))[0]!
    },
  }
  // Image reads are asynchronous; a retired page cannot receive a new chat's result.
  return Object.fromEntries(Object.entries(methods).map(([method, run]) => [method, async (params, options) => {
    options.signal.throwIfAborted(); assertActive()
    const result = await run(params, options)
    options.signal.throwIfAborted(); assertActive()
    return result
  }]))
}
