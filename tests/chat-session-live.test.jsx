// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useChatSessions } from '../src/renderer/src/modules/chat/hooks/useChatSessions.js'
import { useConversationMessages } from '../src/renderer/src/modules/chat/hooks/useConversationMessages.js'
import { MessageBubble } from './helpers/officialMarkdown.jsx'

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
      ...(role === 'user' ? { dshTurn: null } : {}),
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
    let nativeInputHandler
    const model = {
      getSnapshot: () => catalog, subscribe: subscribe(catalogListeners),
      getDetailsSnapshot: () => details, subscribeDetails: subscribe(detailsListeners),
      getStreamSnapshot: () => stream, subscribeStream: subscribe(streamListeners),
      readModelSelection: async () => ({ provider: 'test-provider', model: 'test-model' }),
      refresh: async () => catalog.items,
      send: vi.fn(() => new Promise(resolve => { finishSend = resolve })),
      regenerate: vi.fn(() => new Promise(resolve => { finishRegenerate = resolve })),
      registerNativeInputHandler: vi.fn((handler) => {
        nativeInputHandler = handler
        return () => { if (nativeInputHandler === handler) nativeInputHandler = null }
      }),
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
      let sending
      await act(async () => {
        sending = nativeInputHandler({
          sessionId: 'session-1', text: '读取文件', attachments: [], mode: 'queue', signal: new AbortController().signal,
        })
      })
      expect(model.send).toHaveBeenCalledOnce()
      expect(chat.isSending).toBe(true)
      expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['读取文件'])
      const reasoning = { id: 'reasoning-1', kind: 'reasoning', status: 'running', detail: '检查资料' }
      const search = { id: 'search-1', kind: 'tool', status: 'running', toolName: 'web_search', arguments: '{}' }
      await act(async () => {
        emitDetails([makeMessage('user-1', 'user', '读取文件', 1)])
        emitStream('', 'running', [reasoning])
      })
      expect(container.querySelectorAll('[data-role="assistant"]')).toHaveLength(1)
      expect(chat.messages.find(message => message.pending)).toMatchObject({ runtimeSessionId: 'session-1' })
      expect(container.querySelector('.agent-process-inline-label').textContent).toBe('正在思考')
      expect(container.querySelector('[data-role="assistant"] .bubble')).toBeNull()
      const liveArticle = container.querySelector('[data-role="assistant"] article')
      const settledUserDuringStream = chat.messages[0]
      await act(async () => emitStream('', 'running', [{ ...reasoning, status: 'complete' }, search]))
      expect(chat.messages[0]).toBe(settledUserDuringStream)
      expect(container.querySelector('.agent-process-inline-label').textContent).toBe('正在运行 web_search')
      expect(container.querySelector('[data-role="assistant"] article')).toBe(liveArticle)
      await act(async () => container.querySelector('.agent-process-inline').click())
      expect(openProcess).toHaveBeenCalledWith(expect.objectContaining({ pending: true, process: [
        expect.objectContaining({ id: 'reasoning-1' }), expect.objectContaining({ id: 'search-1' })
      ] }))
      await act(async () => {
        emitStream('正在读取', 'running', [{ ...reasoning, status: 'complete' }, { ...search, status: 'complete' }])
      })
      expect(chat.messages[0]).toBe(settledUserDuringStream)
      expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['读取文件', '正在读取'])
      expect(container.querySelector('.agent-process-inline')).toBeNull()
      expect(container.querySelector('[data-role="assistant"] article')).toBe(liveArticle)
      await act(async () => {
        emitDetails([makeMessage('user-1', 'user', '读取文件', 1), makeMessage('assistant-1', 'assistant', '读取完成', 4)])
      })
      // The official transcript may settle before the request promise returns.
      // Keep the old stable live row in charge until the completed handoff so
      // its body cannot collapse and remount between those two publications.
      expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['读取文件', '正在读取'])
      expect(container.querySelector('[data-role="assistant"] article')).toBe(liveArticle)
      await act(async () => {
        finishSend({ details: details.details, cancelled: false })
        await sending
      })
      // The send promise may settle before the official DSH stream publishes
      // its terminal state. A stale details refresh during that window must
      // not erase the completed optimistic transcript.
      await act(async () => emitDetails([]))
      expect([...container.querySelectorAll('p')].map(node => node.textContent)).toEqual(['读取文件', '正在读取'])
      await act(async () => emitDetails([
        makeMessage('user-1', 'user', '读取文件', 1), makeMessage('assistant-1', 'assistant', '读取完成', 4),
      ]))
      await act(async () => emitStream('', 'idle'))
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

  it('keeps a second optimistic user message visible while a stopped request is still settling', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const id = 'chat-stop-send'
    const conversation = { id, title: '测试角色', metadata: { characterId: 'character-1' } }
    const makeMessage = (messageId, role, content, seq) => ({ id: messageId, role, content,
      conversationId: id, sessionEventSeq: seq, sequence: seq, status: 'complete', createdAt: '' })
    const makeDetails = messages => ({ conversation, metadata: conversation.metadata,
      runtimeSessionId: 'session-stop-send', messages, hasMore: false, beforeSequence: null })
    let details = { id, status: 'ready', details: makeDetails([]), error: '' }
    let stream = { id, status: 'idle', content: '', process: [] }
    const detailsListeners = new Set()
    const streamListeners = new Set()
    const subscribe = listeners => listener => { listeners.add(listener); return () => listeners.delete(listener) }
    const requests = []
    const catalog = { status: 'ready', items: [conversation], error: '' }
    const model = {
      getSnapshot: () => catalog,
      subscribe: () => () => {},
      getDetailsSnapshot: () => details,
      subscribeDetails: subscribe(detailsListeners),
      getStreamSnapshot: () => stream,
      subscribeStream: subscribe(streamListeners),
      readModelSelection: async () => ({ provider: 'test-provider', model: 'test-model' }),
      refresh: async () => [conversation],
      send: vi.fn(input => new Promise(resolve => requests.push({ input, resolve }))),
      cancelRequest: vi.fn(async () => true),
      open: async () => details.details,
    }
    const props = { conversations: model, characters: [], modelConfigs: [{ id: 'test-provider', model: 'test-model' }],
      setStatus: vi.fn(), setActiveSectionState: vi.fn(), notify: vi.fn() }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    let chat
    function Probe() {
      chat = useChatSessions(props)
      return React.createElement('div', null, chat.messages.map(message =>
        React.createElement('p', { key: message.renderKey || message.id, 'data-role': message.role }, message.content)))
    }
    try {
      await act(async () => root.render(React.createElement(Probe)))
      await act(async () => chat.setInput('第一条'))
      let firstRun
      await act(async () => { firstRun = chat.sendMessage({ preventDefault() {} }); await Promise.resolve() })
      expect(model.send).toHaveBeenCalledOnce()
      await act(async () => {
        details = { ...details, details: makeDetails([makeMessage('user-1', 'user', '第一条', 1)]) }
        for (const listener of detailsListeners) listener()
      })

      await act(async () => chat.stopSend())
      await act(async () => chat.setInput('第二条'))
      let secondRun
      await act(async () => { secondRun = chat.sendMessage({ preventDefault() {} }); await Promise.resolve() })
      expect(model.send).toHaveBeenCalledTimes(2)
      expect([...container.querySelectorAll('[data-role="user"]')].map(node => node.textContent))
        .toEqual(['第一条', '第二条'])

      await act(async () => {
        requests[0].resolve({ details: makeDetails([makeMessage('user-1', 'user', '第一条', 1)]), cancelled: true })
        await firstRun
      })
      expect([...container.querySelectorAll('[data-role="user"]')].map(node => node.textContent))
        .toEqual(['第一条', '第二条'])

      await act(async () => {
        details = { ...details, details: makeDetails([
          makeMessage('user-1', 'user', '第一条', 1),
          makeMessage('user-2', 'user', '第二条', 5),
        ]) }
        for (const listener of detailsListeners) listener()
        stream = { id, status: 'running', runId: 'session-stop-send', requestId: 'request-2',
          messageId: 'live-2', renderKey: 'dsh-reply-session-stop-send-2', dshTurn: 2,
          content: '', process: [], sequence: 1, error: '' }
        for (const listener of streamListeners) listener()
      })
      expect([...container.querySelectorAll('[data-role="user"]')].map(node => node.textContent))
        .toEqual(['第一条', '第二条'])

      await act(async () => {
        const finalDetails = makeDetails([
          makeMessage('user-1', 'user', '第一条', 1),
          makeMessage('user-2', 'user', '第二条', 5),
          makeMessage('assistant-2', 'assistant', '第二条回复', 8),
        ])
        details = { ...details, details: finalDetails }
        stream = { ...stream, status: 'idle', messageId: '', content: '', process: [] }
        for (const listener of streamListeners) listener()
        requests[1].resolve({ details: finalDetails, cancelled: false })
        await secondRun
      })
      expect([...container.querySelectorAll('p')].map(node => node.textContent))
        .toEqual(['第一条', '第二条', '第二条回复'])
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
