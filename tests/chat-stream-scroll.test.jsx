// @vitest-environment jsdom
import React, { act, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthorFrontendActions } from '../src/renderer/src/modules/chat/hooks/useAuthorFrontendActions.js'
import { useConversationMessages } from '../src/renderer/src/modules/chat/hooks/useConversationMessages.js'
import { useChatTailReading } from '../src/renderer/src/modules/chat/hooks/useChatTailReading.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('stream updates and reader scroll ownership', () => {
  it('keeps upward reading through chunks, tool steps and settlement, and resumes only for explicit navigation or submission', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const resizeCallbacks = new Set()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback }
      observe() { resizeCallbacks.add(this.callback) }
      disconnect() { resizeCallbacks.delete(this.callback) }
    })
    const scroller = document.createElement('div')
    document.body.append(scroller)
    let height = 1_000
    Object.defineProperties(scroller, {
      clientHeight: { get: () => 200 },
      scrollHeight: { get: () => height },
      scrollTop: { writable: true, value: 800 },
    })
    let stream = { id: 'chat-scroll', status: 'idle' }
    const listeners = new Set()
    const model = {
      getStreamSnapshot: () => stream,
      subscribeStream(listener) { listeners.add(listener); return () => listeners.delete(listener) },
      open: vi.fn(async () => ({ conversation: { id: 'chat-scroll' }, metadata: {}, messages: [] })),
    }
    const actions = {
      sessionId: 'chat-scroll', conversations: model, setIsSending: vi.fn(), setStatus: vi.fn(),
      reconcileChatMessages: vi.fn(), replaceChatMessages: vi.fn(), setChatCharacter: vi.fn(),
      normalizeLatestChatCharacter: value => value, refreshSessionsOnly: vi.fn(async () => {}),
      loadChat: vi.fn(), input: '', inputImages: [], setInput: vi.fn(), sendMessage: vi.fn(),
      requestRef: { current: null },
    }
    const following = vi.fn()
    let chat
    let returnToBottom
    function Probe() {
      chat = useConversationMessages()
      returnToBottom = useChatTailReading({ scrollElement: scroller, onFollowingTailChange: following })
      useAuthorFrontendActions({ ...actions, requestScrollToEnd: chat.requestScrollToEnd })
      useLayoutEffect(() => { returnToBottom() }, [chat.scrollRequest.revision])
      return <div className="message-flow">Stream transcript</div>
    }
    const root = createRoot(scroller)
    const emit = async (next) => act(async () => {
      stream = { ...stream, ...next }
      for (const listener of listeners) listener()
    })
    const grow = async () => act(async () => {
      height += 40
      for (const callback of resizeCallbacks) callback([])
    })
    const moveUp = async () => act(async () => {
      scroller.scrollTop -= 180
      scroller.dispatchEvent(new Event('scroll'))
    })
    try {
      await act(async () => root.render(<Probe />))
      await emit({ status: 'running', runId: 'session-scroll', content: '' })
      await moveUp()
      const readerTop = scroller.scrollTop
      // Frequent stream notifications must not cancel the pending 500ms sample.
      for (let chunk = 1; chunk <= 8; chunk += 1) {
        await emit({ content: `Chunk ${chunk}`, process: [{ id: `tool-${chunk}`, status: 'running' }] })
        await grow()
        await act(async () => vi.advanceTimersByTime(100))
        expect(scroller.scrollTop).toBe(readerTop)
      }
      expect(following).toHaveBeenLastCalledWith(false)
      expect(chat.scrollRequest.revision).toBe(0)
      await emit({ status: 'idle' })
      expect(scroller.scrollTop).toBe(readerTop)
      expect(actions.setIsSending).toHaveBeenLastCalledWith(false)

      await act(async () => returnToBottom())
      expect(scroller.scrollTop).toBe(height - 200)
      await emit({ status: 'running', content: '' })
      await grow()
      expect(scroller.scrollTop).toBe(height - 200)
      await moveUp()
      await act(async () => vi.advanceTimersByTime(500))
      await act(async () => window.dispatchEvent(new CustomEvent('eleckoi:author-action', {
        detail: { conversationId: 'chat-scroll', method: 'chat.send', result: { runId: 'session-scroll' } },
      })))
      expect(chat.scrollRequest.revision).toBe(1)
      expect(scroller.scrollTop).toBe(height - 200)
      await moveUp()
      const nextReaderTop = scroller.scrollTop
      await emit({ content: 'Next submitted reply' })
      await grow()
      expect(scroller.scrollTop).toBe(nextReaderTop)
    } finally {
      await act(async () => root.unmount())
    }
    expect(listeners.size).toBe(0)
    expect(resizeCallbacks.size).toBe(0)
  })
})
