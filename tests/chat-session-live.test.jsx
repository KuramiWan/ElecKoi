// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useChatSessions } from '../src/renderer/src/modules/chat/hooks/useChatSessions.js'
import { useConversationMessages } from '../src/renderer/src/modules/chat/hooks/useConversationMessages.js'
import { MessageBubble } from '../src/renderer/src/ui/messages/MessageBubble.jsx'

describe('DSH chat live rendering', () => {
  it('replaces metadata rows and revoked replies with the complete DSH transcript, including older pages', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let chat
    const message = (id, role, content, sequence, messageIndex) => ({ id, role, content, sequence, messageIndex })
    function Probe() {
      chat = useConversationMessages()
      return React.createElement('div', null, chat.messages.map(item =>
        React.createElement('p', { key: item.id }, `${item.messageIndex}:${item.content || ''}`)))
    }
    try {
      await act(async () => root.render(React.createElement(Probe)))
      await act(async () => chat.setMessagesWithScroll([
        message('index-0', 'user', '', 0, 0), message('index-2', 'user', '', 2, 2),
        message('index-4', 'user', '', 4, 4),
      ]))
      const user = message('user', 'user', '测试输入', 8, 0)
      const reply = message('reply', 'assistant', '测试回复', 14, 1)
      await act(async () => chat.reconcileMessages([user, reply]))
      expect(container.textContent).toBe('0:测试输入1:测试回复')
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await act(async () => chat.reconcileMessages([user]))
        expect(chat.messages.map(item => item.id)).toEqual(['user'])
        await act(async () => chat.reconcileMessages([
          user, message(`reply-${attempt}`, 'assistant', '重新生成', 20 + attempt, 1),
        ]))
        expect(chat.messages).toHaveLength(2)
        expect(chat.messages.map(item => item.messageIndex)).toEqual([0, 1])
      }
      await act(async () => chat.reconcileMessages([
        message('earlier', 'user', '更早输入', 0, 0),
        { ...user, messageIndex: 1 }, { ...reply, messageIndex: 2 },
      ], { hasMore: false, beforeSequence: 0 }))
      expect(container.textContent).toBe('0:更早输入1:测试输入2:测试回复')
      expect(chat.historyPage).toEqual({ hasMore: false, beforeSequence: 0 })
      await act(async () => chat.reconcileMessages([]))
      expect(chat.messages).toEqual([])
      expect(container.textContent).toBe('')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })

  it('shows official user and partial assistant messages during send and regeneration without duplicate replies', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('React', React)
    const id = 'chat-1'
    const conversation = { id, title: '测试角色', metadata: { characterId: 'character-1' } }
    const makeDetails = (messages) => ({ conversation, metadata: conversation.metadata,
      runtimeSessionId: 'session-1', messages, hasMore: false, beforeSequence: null })
    const makeMessage = (messageId, role, content, seq) => ({ id: messageId, role, content,
      conversationId: id, sessionEventSeq: seq, sequence: seq, status: 'complete', createdAt: '',
      ...(role === 'assistant' ? { renderKey: 'dsh-reply-session-1-1' } : {}) })
    let catalog = { status: 'ready', items: [conversation], error: '' }
    let details = { id, status: 'ready', details: makeDetails([]), error: '' }
    let stream = { id, status: 'idle', content: '', process: [] }
    const catalogListeners = new Set()
    const detailsListeners = new Set()
    const streamListeners = new Set()
    const subscribe = (listeners) => (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
    const emitDetails = (messages) => {
      details = { ...details, details: makeDetails(messages) }
      for (const listener of detailsListeners) listener()
    }
    const emitStream = (content, status = 'running', process = []) => {
      stream = { id, status, content, process, runId: 'session-1', messageId: 'live-1',
        renderKey: 'dsh-reply-session-1-1' }
      for (const listener of streamListeners) listener()
    }
    let finishSend
    let finishRegenerate
    const model = {
      getSnapshot: () => catalog, subscribe: subscribe(catalogListeners),
      getDetailsSnapshot: () => details, subscribeDetails: subscribe(detailsListeners),
      getStreamSnapshot: () => stream, subscribeStream: subscribe(streamListeners),
      readModelSelection: async () => ({ provider: 'test-provider', model: 'test-model' }),
      refresh: async () => catalog.items,
      send: vi.fn(() => new Promise(resolve => { finishSend = resolve })),
      regenerate: vi.fn(() => new Promise(resolve => { finishRegenerate = resolve })),
      invalidateDetails: vi.fn(),
      open: async () => details.details,
    }
    const props = { conversations: model, characters: [], modelConfigs: [{ id: 'test-provider', model: 'test-model' }],
      setStatus: vi.fn(), setActiveSectionState: vi.fn(), notify: vi.fn() }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const openProcess = vi.fn()
    let chat
    function Probe() {
      chat = useChatSessions(props)
      return React.createElement('div', null, chat.messages.map(message =>
        React.createElement('div', { key: message.renderKey || message.id, 'data-role': message.role },
          React.createElement(MessageBubble, { message, onOpenProcess: openProcess }))))
    }
    try {
      await act(async () => root.render(React.createElement(Probe)))
      await act(async () => chat.setInput('读取文件'))
      let sending
      await act(async () => { sending = chat.sendMessage({ preventDefault() {} }) })
      expect(model.send).toHaveBeenCalledOnce()
      expect(chat.isSending).toBe(true)
      const reasoning = { id: 'reasoning-1', kind: 'reasoning', status: 'running', detail: '检查资料' }
      const search = { id: 'search-1', kind: 'tool', status: 'running', toolName: 'web_search', arguments: '{}' }
      await act(async () => {
        emitDetails([makeMessage('user-1', 'user', '读取文件', 1)])
        emitStream('', 'running', [reasoning])
      })
      expect(container.querySelectorAll('[data-role="assistant"]')).toHaveLength(1)
      expect(container.querySelector('.agent-process-inline-label').textContent).toBe('正在思考')
      expect(container.querySelector('[data-role="assistant"] .bubble')).toBeNull()
      const liveArticle = container.querySelector('[data-role="assistant"] article')
      await act(async () => emitStream('', 'running', [{ ...reasoning, status: 'complete' }, search]))
      expect(container.querySelector('.agent-process-inline-label').textContent).toBe('正在运行 web_search')
      expect(container.querySelector('[data-role="assistant"] article')).toBe(liveArticle)
      await act(async () => container.querySelector('.agent-process-inline').click())
      expect(openProcess).toHaveBeenCalledWith(expect.objectContaining({ pending: true, process: [
        expect.objectContaining({ id: 'reasoning-1' }), expect.objectContaining({ id: 'search-1' })
      ] }))
      await act(async () => {
        emitStream('正在读取', 'running', [{ ...reasoning, status: 'complete' }, { ...search, status: 'complete' }])
      })
      expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['读取文件', '正在读取'])
      expect(container.querySelector('.agent-process-inline')).toBeNull()
      expect(container.querySelector('[data-role="assistant"] article')).toBe(liveArticle)
      await act(async () => {
        emitDetails([makeMessage('user-1', 'user', '读取文件', 1), makeMessage('assistant-1', 'assistant', '读取完成', 4)])
        emitStream('', 'idle')
        finishSend({ details: details.details, cancelled: false })
        await sending
      })
      expect(container.querySelectorAll('[data-role="assistant"]')).toHaveLength(1)
      expect(container.querySelector('[data-role="assistant"] article')).toBe(liveArticle)
      expect(chat.isSending).toBe(false)

      let regenerating
      await act(async () => { regenerating = chat.regenerateReply({ targetMessageId: 'assistant-1' }) })
      expect(model.regenerate).toHaveBeenCalledWith(expect.objectContaining({ conversationId: id, eventSeq: 1 }))
      await act(async () => {
        emitDetails([makeMessage('user-2', 'user', '读取文件', 1)])
        emitStream('', 'running', [reasoning])
      })
      expect(container.querySelector('.agent-process-inline-label').textContent).toBe('正在思考')
      await act(async () => emitStream('重新读取中', 'running', [reasoning]))
      expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['读取文件', '重新读取中'])
      await act(async () => {
        emitDetails([makeMessage('user-2', 'user', '读取文件', 1), makeMessage('assistant-2', 'assistant', '重新读取完成', 4)])
        emitStream('', 'idle')
        finishRegenerate({ details: details.details, cancelled: false })
        await regenerating
      })
      expect(container.querySelectorAll('[data-role="assistant"]')).toHaveLength(1)
      expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['读取文件', '重新读取完成'])
      expect(chat.sessionId).toBe(id)
      expect(chat.runtimeSessionId).toBe('session-1')
      const failure = 'Synthetic API error (402): {"message":"request refused"}'
      for (const operation of ['send', 'regenerate']) {
        let finishRefresh
        model.open = vi.fn(() => new Promise(resolve => { finishRefresh = resolve }))
        model[operation].mockImplementationOnce(async () => {
          emitStream('', 'error')
          throw new Error(failure)
        })
        props.notify.mockClear()
        let failed
        await act(async () => {
          if (operation === 'send') {
            chat.setInput('再次请求')
          }
        })
        await act(async () => {
          failed = operation === 'send' ? chat.sendMessage({ preventDefault() {} })
            : chat.regenerateReply({ targetMessageId: 'assistant-2' })
        })
        // Error presentation must not depend on the refresh completing.
        expect(chat.isSending).toBe(false)
        expect(props.notify).toHaveBeenCalledExactlyOnceWith('error', failure)
        expect(model.open).toHaveBeenCalled()
        await act(async () => { finishRefresh(details.details); await failed })
        expect(chat.sessionId).toBe(id)
        expect(chat.runtimeSessionId).toBe('session-1')
      }
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
