// @vitest-environment jsdom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { officialChatFixture } from './helpers/officialTrajectory.js'
import { ManualCompactionNodeView } from './helpers/officialChatView.jsx'

const event = (type, seq, data = {}) => ({ type, seq, time: seq * 10, data })
const run = (seq, commandId) => event('command/run', seq, { commandId, name: 'compact' })
const start = (seq, commandId) => event('compaction/start', seq, {
  compactionId: `compaction-${commandId}`, sourceCommandId: commandId, turn: 0,
})
const manual = (snapshot, commandId) => [...snapshot.nodes.values()]
  .find(node => node.kind === 'manual-compaction' && node.data.command.commandId === commandId)
const render = node => renderToStaticMarkup(<ManualCompactionNodeView node={node} t={key => key} />)

describe('manual compaction across Session restore boundaries', () => {
  it('settles the incomplete command when a resume boundary arrives and when history is reopened', () => {
    const events = [run(1, 'unfinished'), start(2, 'unfinished')]
    const fixture = officialChatFixture()
    expect(render(manual(fixture.replace(events), 'unfinished'))).toContain('message.compaction.running')
    const boundary = event('session/end-seed', 3)
    const interrupted = manual(fixture.append(boundary), 'unfinished')
    expect(render(interrupted)).toContain('message.compaction.interrupted')
    expect(render(interrupted)).not.toContain('message.compaction.running')
    expect(interrupted.data.command.outcome).toBeNull()
    const afterTitle = fixture.append(event('session/title', 4, { title: '合成会话' }))
    const hiddenBoundary = [...afterTitle.nodes.values()].find(node => node.kind === 'compaction-session-end')
    expect(hiddenBoundary.visibility).toBe('hidden')
    expect(afterTitle.order).not.toContain(hiddenBoundary.key)
    expect(render(manual(officialChatFixture().replace([...events, boundary]), 'unfinished')))
      .toContain('message.compaction.interrupted')
  })

  it('preserves completed commands and lets the next command run and finish normally', () => {
    const fixture = officialChatFixture()
    const snapshot = fixture.replace([
      run(1, 'completed'), start(2, 'completed'),
      event('command/done', 3, { commandId: 'completed', kind: 'success', text: '合成压缩结果' }),
      run(4, 'unfinished'), start(5, 'unfinished'), event('session/end-seed', 6),
      run(7, 'new-command'), start(8, 'new-command'),
    ])
    expect(render(manual(snapshot, 'completed'))).toContain('合成压缩结果')
    expect(render(manual(snapshot, 'unfinished'))).toContain('message.compaction.interrupted')
    expect(render(manual(snapshot, 'new-command'))).toContain('message.compaction.running')
    const next = fixture.append(event('command/done', 9, {
      commandId: 'new-command', kind: 'error', text: '合成摘要请求失败',
    }))
    expect(render(manual(next, 'new-command'))).toContain('合成摘要请求失败')
    expect(render(manual(next, 'new-command'))).not.toContain('message.compaction.running')
  })

  it('does not treat unrelated events as a completion signal', () => {
    const fixture = officialChatFixture()
    fixture.replace([run(1, 'active'), start(2, 'active')])
    const snapshot = fixture.append(event('session/title', 3, { title: '合成会话' }))
    expect(render(manual(snapshot, 'active'))).toContain('message.compaction.running')
    expect(manual(snapshot, 'active').data.interrupted).toBeUndefined()
  })

  it('recovers older commands loaded after the boundary without changing a live command', () => {
    const fixture = officialChatFixture()
    const snapshot = fixture.replace([event('session/end-seed', 6), run(7, 'active'), start(8, 'active')])
    const active = manual(snapshot, 'active')
    const loaded = fixture.prepend([run(1, 'older-one'), start(2, 'older-one'), run(3, 'older-two'), start(4, 'older-two')])
    expect(render(manual(loaded, 'older-one'))).toContain('message.compaction.interrupted')
    expect(render(manual(loaded, 'older-two'))).toContain('message.compaction.interrupted')
    expect(manual(loaded, 'active').data.command).toEqual(active.data.command)
    expect(render(manual(loaded, 'active'))).toContain('message.compaction.running')
    const restored = fixture.replace([run(1, 'older-one'), start(2, 'older-one')])
    expect(render(manual(restored, 'older-one'))).toContain('message.compaction.running')
  })
})
