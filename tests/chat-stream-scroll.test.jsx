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
      // Frequent stream notifications must never take back the reader's position.
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

// Geometry is explicit because jsdom does not lay out or scroll elements.
async function mountReader() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const callbacks = new Set()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback }
    observe() { callbacks.add(this.callback) }
    disconnect() { callbacks.delete(this.callback) }
  })
  const scroller = document.createElement('div')
  scroller.tabIndex = 0
  document.body.append(scroller)
  let height = 1000
  let viewport = 200
  Object.defineProperties(scroller, {
    clientHeight: { get: () => viewport },
    scrollHeight: { get: () => height },
    scrollTop: { writable: true, value: 0 },
  })
  const following = vi.fn()
  let jump
  function Probe() {
    jump = useChatTailReading({ scrollElement: scroller, onFollowingTailChange: following })
    useLayoutEffect(() => jump(), [])
    return <div className="message-flow"><p>Transcript</p><textarea /><div contentEditable suppressContentEditableWarning>Editable</div></div>
  }
  const root = createRoot(scroller)
  await act(async () => root.render(<Probe />))
  return {
    scroller, following,
    event: async (event, target = scroller) => act(async () => target.dispatchEvent(event)),
    scroll: async top => act(async () => { scroller.scrollTop = top; scroller.dispatchEvent(new Event('scroll')) }),
    resize: async (nextHeight = height + 40, nextViewport = viewport) => act(async () => {
      height = nextHeight
      viewport = nextViewport
      for (const callback of callbacks) callback([])
    }),
    jump: async () => act(async () => jump()),
    remount: async () => act(async () => root.render(<Probe key="next-conversation" />)),
    close: async () => {
      await act(async () => root.unmount())
      expect(callbacks.size).toBe(0)
    },
  }
}

const wheel = deltaY => new WheelEvent('wheel', { deltaY, bubbles: true })
const key = (value, options = {}) => new KeyboardEvent('keydown', { key: value, bubbles: true, ...options })
const touch = (type, y) => {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'touches', { value: y === undefined ? [] : [{ clientY: y }] })
  return event
}

describe('immediate chat scroll ownership', () => {
  it('initially follows content and viewport changes without treating its own scroll as reader input', async () => {
    const reader = await mountReader()
    try {
      expect(reader.scroller.scrollTop).toBe(800)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(840)
      await reader.event(new Event('scroll'))
      await reader.resize(1080, 180)
      expect(reader.scroller.scrollTop).toBe(900)
      expect(reader.following).not.toHaveBeenCalledWith(false)
    } finally { await reader.close() }
  })

  it('keeps even a one-pixel upward trackpad move paused inside the bottom tolerance', async () => {
    const reader = await mountReader()
    try {
      await reader.event(wheel(-1))
      expect(reader.following).toHaveBeenLastCalledWith(false)
      await reader.scroll(799)
      await reader.event(new Event('scrollend'))
      await reader.resize()
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(799)
      expect(reader.following).toHaveBeenLastCalledWith(false)
    } finally { await reader.close() }
  })

  it('detects upward movement before a delayed scroll event when a stream resize arrives first', async () => {
    const reader = await mountReader()
    try {
      reader.scroller.scrollTop = 620
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(620)
      expect(reader.following).toHaveBeenLastCalledWith(false)
      await reader.event(new Event('scroll'))
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(620)
    } finally { await reader.close() }
  })

  it('allows free up/down reading and resumes only on an intentional downward return near the bottom', async () => {
    const reader = await mountReader()
    try {
      await reader.event(wheel(-180))
      await reader.scroll(620)
      await reader.event(wheel(60))
      await reader.scroll(680)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(680)
      await reader.event(new Event('scrollend'))
      // History-anchor restoration is programmatic and must not resume following.
      await reader.scroll(820)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(820)
      await reader.event(wheel(50))
      await reader.scroll(860)
      expect(reader.following).toHaveBeenLastCalledWith(true)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(920)
    } finally { await reader.close() }
  })

  it.each(['ArrowUp', 'PageUp', 'Home', ' ', 'Ctrl+Home'])('pauses on upward keyboard intent (%s) before native scrolling', async value => {
    const reader = await mountReader()
    try {
      await reader.event(key(value === 'Ctrl+Home' ? 'Home' : value, { shiftKey: value === ' ', ctrlKey: value === 'Ctrl+Home' }))
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(800)
      expect(reader.following).toHaveBeenLastCalledWith(false)
      await reader.event(key('End'))
      await reader.scroll(840)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(880)
    } finally { await reader.close() }
  })

  it('pauses a touch swipe before scroll and preserves reading after touch ends', async () => {
    const reader = await mountReader()
    try {
      await reader.event(touch('touchstart', 100))
      await reader.event(touch('touchmove', 120))
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(800)
      expect(reader.following).toHaveBeenLastCalledWith(false)
      await reader.scroll(780)
      await reader.event(touch('touchend'))
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(780)
    } finally { await reader.close() }
  })

  it('does not fight a scrollbar drag, and resumes when it is dragged back to the bottom', async () => {
    const reader = await mountReader()
    try {
      await reader.event(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(800)
      await reader.scroll(600)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(600)
      await reader.scroll(880)
      await reader.event(new Event('pointerup'), window)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(920)
    } finally { await reader.close() }
  })

  it('catches up after a stationary touch without mistaking it for upward reading', async () => {
    const reader = await mountReader()
    try {
      await reader.event(touch('touchstart', 100))
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(800)
      await reader.event(touch('touchend'))
      expect(reader.scroller.scrollTop).toBe(840)
      expect(reader.following).not.toHaveBeenCalledWith(false)
    } finally { await reader.close() }
  })

  it('ignores caret navigation and wheel events consumed by a nested scrollport', async () => {
    const reader = await mountReader()
    try {
      await reader.event(key('ArrowUp'), reader.scroller.querySelector('textarea'))
      reader.scroller.querySelector('[contenteditable]').setAttribute('contenteditable', '')
      await reader.event(key('Home'), reader.scroller.querySelector('[contenteditable]'))
      const nested = reader.scroller.querySelector('p')
      nested.style.overflowY = 'auto'
      Object.defineProperties(nested, { clientHeight: { value: 50 }, scrollHeight: { value: 300 }, scrollTop: { value: 100, writable: true } })
      await reader.event(wheel(-20), nested)
      nested.style.overscrollBehaviorY = 'contain'
      nested.scrollTop = 0
      await reader.event(wheel(-20), nested)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(840)
      expect(reader.following).not.toHaveBeenCalledWith(false)
    } finally { await reader.close() }
  })

  it('keeps following browser clamping on shrink, but does not resume paused reading on shrink', async () => {
    const reader = await mountReader()
    try {
      reader.scroller.scrollTop = 700
      await reader.resize(900)
      await reader.resize(1000)
      expect(reader.scroller.scrollTop).toBe(800)
      await reader.scroll(600)
      reader.scroller.scrollTop = 500
      await reader.resize(700)
      await reader.resize(1000)
      expect(reader.scroller.scrollTop).toBe(500)
    } finally { await reader.close() }
  })

  it('resets following on explicit jump and conversation remount and cleans up old listeners', async () => {
    const reader = await mountReader()
    try {
      await reader.scroll(500)
      await reader.jump()
      expect(reader.scroller.scrollTop).toBe(800)
      await reader.scroll(400)
      await reader.remount()
      expect(reader.scroller.scrollTop).toBe(800)
      await reader.resize()
      expect(reader.scroller.scrollTop).toBe(840)
    } finally { await reader.close() }
    const count = reader.following.mock.calls.length
    reader.scroller.dispatchEvent(wheel(-10))
    expect(reader.following).toHaveBeenCalledTimes(count)
  })
})
