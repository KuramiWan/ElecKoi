import type { AuthorMessage } from '@eleckoi/author-sdk'
import { copy, fields, record, unsupported, FrontendCompatibilityError } from './common'

export type MessageId = number | string
export function messageIndex(value: MessageId, messages: readonly AuthorMessage[]): number {
  if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError('消息编号必须是整数或整数文本。')
  if (typeof value === 'string' && !/^-?\d+$/.test(value)) throw new TypeError('兼容消息编号必须是整数文本。')
  const number = Number(value), index = number < 0 ? messages.length + number : number
  if (!Number.isSafeInteger(number) || index < 0 || index >= messages.length) throw new RangeError(`消息编号不可用：${value}`)
  return index
}
export function messageRange(range: MessageId, messages: readonly AuthorMessage[]): number[] {
  const source = String(range).replaceAll('{{lastMessageId}}', String(messages.length - 1))
  const position = (value: string) => { const number = Number(value); if (!Number.isSafeInteger(number)) throw new TypeError('消息编号必须是安全整数。'); return number < 0 ? messages.length + number : number }
  if (/^-?\d+$/.test(source)) { const index = position(source); return index >= 0 && index < messages.length ? [index] : [] }
  const match = /^(-?\d+)-(-?\d+)$/.exec(source)
  if (!match) throw new TypeError('消息范围必须是单个编号或首尾均包含的范围，例如 0-5。')
  if (!messages.length) return []
  const begin = Math.max(0, position(match[1])), end = Math.min(messages.length - 1, position(match[2]))
  if (begin >= messages.length || end < 0) return []
  if (end < begin) throw new RangeError('消息范围的结束位置不能早于开始位置。')
  return Array.from({ length: end - begin + 1 }, (_, offset) => begin + offset)
}
export function publicMessage(message: AuthorMessage, index: number): Record<string, unknown> {
  return { message_id: index, role: message.role, name: message.speakerName, message: message.content,
    data: copy(message.variableState), native_id: message.id }
}
export function createMessageFunctions(runtime: {
  messages(): readonly AuthorMessage[]; currentMessageId(): string; available(): void
  write<T>(operation: () => Promise<T>): Promise<T>; setContent(id: string, text: string): Promise<unknown>
}) {
  return {
    getChatMessages(range: MessageId = '0-{{lastMessageId}}', options: Record<string, unknown> = {}) {
      runtime.available(); fields(record(options, '消息筛选'), ['role', 'include_swipes', 'hide_state'], '消息筛选')
      if (options.include_swipes !== undefined && options.include_swipes !== false) unsupported('候选回复读取')
      if (options.hide_state !== undefined && options.hide_state !== 'all') unsupported('消息隐藏状态筛选')
      const role = options.role ?? 'all'
      if (!['all', 'user', 'assistant', 'system'].includes(role as string)) unsupported(`消息角色 ${String(role)}`)
      const messages = runtime.messages()
      return messageRange(range, messages).filter(index => role === 'all' || messages[index].role === role)
        .map(index => publicMessage(messages[index], index))
    },
    setChatMessages(updates: unknown[], options: Record<string, unknown> = {}): Promise<void> {
      runtime.available(); fields(record(options, '消息修改选项'), [], '消息修改选项')
      if (!Array.isArray(updates)) throw new TypeError('消息修改必须是数组。')
      const messages = runtime.messages()
      // Validate the entire input before the first native mutation.
      const changes = updates.map(value => {
        const update = record(value, '消息修改'); fields(update, ['message_id', 'message'], '消息修改')
        const index = messageIndex(update.message_id as MessageId, messages)
        if (typeof update.message !== 'string') throw new TypeError('消息正文必须是文本。')
        return { id: messages[index].id, text: update.message }
      })
      return runtime.write(async () => { for (const change of changes) await runtime.setContent(change.id, change.text) })
    },
    getLastMessageId() { runtime.available(); return runtime.messages().length - 1 },
    getCurrentMessageId() {
      runtime.available()
      const index = runtime.messages().findIndex(message => message.id === runtime.currentMessageId())
      if (index < 0) throw new FrontendCompatibilityError('MESSAGE_NOT_AVAILABLE', '当前页面没有绑定可用的消息。')
      return index
    },
  }
}
