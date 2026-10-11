import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { historicalRuntimeState } from '../packages/client/features/dsh-client-roleplay/src/host/historical-runtime-state.mjs'
import { installRoleplaySessionRuntime } from '../packages/client/features/dsh-client-roleplay/src/host/session-runtime.mjs'
import { writeSessionSnapshot } from '../packages/client/features/dsh-client-roleplay/src/host/session-snapshot.mjs'

const cleanups = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function archive() {
  return { tables: {
    agent_conversations: [{ id: 'chat', activeBranchId: 'branch', runtimeThreadId: 'session' }],
    agent_branch_turns: ['unanswered', 'current'].map((turnId, sequence) => ({ branchId: 'branch', turnId, sequence })),
    agent_turns: [
      { id: 'unanswered', kind: 'user', variableStateJson: '{"score":1}' },
      { id: 'current', kind: 'user', variableStateJson: '{"score":2}' }
    ],
    agent_responses: [{ id: 'reply', turnId: 'current', runtimeThreadId: 'session', dshTurn: 1 }],
    agent_setting_snapshots: [{ ownerType: 'turn', ownerId: 'current', stateJson: '[]' }]
  } }
}
function runtime() {
  const root = mkdtempSync(join(tmpdir(), 'eleckoi-saved-state-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  for (const key of ['ELECKOI_SESSION_SNAPSHOT_ROOT', 'ELECKOI_PRESET_ROOT', 'ELECKOI_PRESET_TEMPLATE_PATH',
    'ELECKOI_SESSION_BRIDGE_ROOT', 'ELECKOI_WORKSPACE_ROOT']) {
    const previous = process.env[key]
    process.env[key] = root
    cleanups.push(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const saved = archive()
  const listeners = new Map()
  const ctx = {
    eleckoiProductData: {
      readConversationDetails: () => ({ metadata: { characterId: 'synthetic-character' } }),
      exportConversationArchive: () => saved,
      restoreConversationRuntime: vi.fn(),
      validateConversationRuntimeSnapshot: vi.fn(),
      snapshotConversationRuntime: vi.fn(() => ({ variableStateJson: '{"score":99}', settingLibraryStateJson: '[]' }))
    },
    sessionController: {}, sessionProjections: { register: () => () => {} }, agentDefaultModel: {}, llm: {},
    sessions: { flush: async () => true }, logger: { error: vi.fn() },
    provide(name, service) { this[name] = service }, on(name, listener) { listeners.set(name, listener); return () => {} }
  }
  writeSessionSnapshot(root, 'session', { conversationId: 'chat' })
  installRoleplaySessionRuntime(ctx, {})
  return { root, saved, ctx, listeners, checkpoints: join(root, 'chat', 'eleckoi-runtime-checkpoints.json') }
}

describe('saved old runtime state', () => {
  it('does not create setting branches by committing the scratch library at turn completion', async () => {
    const f = runtime()
    mkdirSync(join(f.root, 'chat'))
    writeSessionSnapshot(f.root, 'session', { conversationId: 'chat', operationId: 'synthetic-operation',
      settingLibraryEnabled: true, settingStateFile: join(f.root, 'not-a-persisted-setting.json') })
    f.ctx.eleckoiProductData.commitConversationRuntime = vi.fn()
    let completion
    f.ctx.eleckoiConversationLifecycle = { matches: () => true, track: (_conversation, _id, operation) => { completion = operation() } }
    f.ctx.eleckoiProductData.snapshotConversationRuntime.mockReturnValue({
      variableStateJson: '{}', settingLibraryStateJson: '[]'
    })
    f.listeners.get('session/event')({ id: 'session' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await completion
    expect(f.ctx.eleckoiProductData.commitConversationRuntime).toHaveBeenCalledWith('chat', undefined, undefined, undefined, undefined)
    expect(JSON.parse(readFileSync(f.checkpoints, 'utf8')).checkpoints[0].state.settingLibraryStateJson).toBe('[]')
  })
  it('recovers the exact old pre-input variables and settings into the existing checkpoint file', () => {
    const f = runtime()
    const restore = f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).not.toHaveBeenCalled()
    restore.apply()
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).toHaveBeenCalledWith('chat', {
      variableStateJson: '{"score":2}', settingLibraryStateJson: '[]'
    })
    const stored = JSON.parse(readFileSync(f.checkpoints, 'utf8'))
    expect(stored).toEqual({ version: 2, checkpoints: [{ turn: 1, phase: 'before', state: {
      variableStateJson: '{"score":2}', settingLibraryStateJson: '[]'
    } }] })
    // Once converted, normal rewind does not depend on the historical ledger.
    f.saved.tables.agent_responses = []
    expect(() => f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)).not.toThrow()
    expect(f.ctx.eleckoiProductData.snapshotConversationRuntime).toHaveBeenCalled()
  })

  it('uses the selected unanswered input state rather than the later native-turn checkpoint', () => {
    const f = runtime()
    f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1).apply()
    f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1, 'unanswered').apply()
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).toHaveBeenLastCalledWith('chat', {
      variableStateJson: '{"score":1}', settingLibraryStateJson: '[]'
    })
  })

  it('does not bridge a missing setting snapshot across a completed response', () => {
    const saved = archive()
    saved.tables.agent_responses.push({ turnId: 'unanswered', runtimeThreadId: 'session', dshTurn: 99 })
    expect(historicalRuntimeState(saved, 'session', 1, 'unanswered')).toBeUndefined()
  })

  it('refuses a genuinely missing historical state without changing data or substituting current state', () => {
    const f = runtime()
    f.saved.tables.agent_setting_snapshots = []
    expect(() => f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)).toThrow('未修改聊天')
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).not.toHaveBeenCalled()
    expect(f.ctx.eleckoiProductData.snapshotConversationRuntime).not.toHaveBeenCalled()
  })

  it('keeps invalid stored state from reaching the destructive rewind', () => {
    const f = runtime()
    f.saved.tables.agent_turns[1].variableStateJson = '[]'
    expect(() => f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)).toThrow('格式不正确')
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).not.toHaveBeenCalled()
  })

  it('validates the full product state before returning a rewind action', () => {
    const f = runtime()
    f.ctx.eleckoiProductData.validateConversationRuntimeSnapshot.mockImplementation(() => { throw new Error('无效的设定快照') })
    expect(() => f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)).toThrow('无效的设定快照')
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).not.toHaveBeenCalled()
  })

  it('uses the normal checkpoint for a chat without a bound character or exportable archive', () => {
    const f = runtime()
    f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1).apply()
    f.ctx.eleckoiProductData.readConversationDetails = () => ({ metadata: { characterId: '' } })
    f.ctx.eleckoiProductData.exportConversationArchive = () => { throw new Error('ordinary chat must not export a roleplay archive') }
    const restore = f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1, 'native-input')
    restore.apply()
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).toHaveBeenLastCalledWith('chat', {
      variableStateJson: '{"score":2}', settingLibraryStateJson: '[]'
    })
  })

  it('exposes the exact committed variable snapshot for each DSH reply turn', () => {
    const f = runtime()
    f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1).apply()
    writeFileSync(f.checkpoints, JSON.stringify({ version: 2, checkpoints: [
      { turn: 1, phase: 'before', state: { variableStateJson: '{"score":0}', settingLibraryStateJson: '[]' } },
      { turn: 1, phase: 'after', state: { variableStateJson: '{"score":1}', settingLibraryStateJson: '[]' } },
      { turn: 2, phase: 'before', state: { variableStateJson: '{"score":9}', settingLibraryStateJson: '[]' } },
      { turn: 2, phase: 'after', state: { variableStateJson: '{"score":2}', settingLibraryStateJson: '[]' } }
    ] }))

    expect(f.ctx.eleckoiRoleplaySessions.variableStatesByTurn('chat')).toEqual({
      1: '{"score":1}',
      2: '{"score":2}'
    })
  })

  it('preserves old boundary records without reclassifying them as committed reply snapshots', () => {
    const f = runtime()
    mkdirSync(join(f.root, 'chat'))
    const states = [1, 2].map(beforeTurn => ({ beforeTurn, state: {
      variableStateJson: JSON.stringify({ score: beforeTurn }), settingLibraryStateJson: '[]'
    } }))
    writeFileSync(f.checkpoints, JSON.stringify({ version: 1, checkpoints: states }))
    expect(f.ctx.eleckoiRoleplaySessions.variableStatesByTurn('chat')).toEqual({})
    expect(JSON.parse(readFileSync(f.checkpoints, 'utf8'))).toEqual({ version: 2,
      checkpoints: states.map(({ beforeTurn, state }) => ({ turn: beforeTurn, phase: 'before', state })) })
    f.saved.tables.agent_responses = []
    const restore = f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 2)
    expect(restore.state.variableStateJson).toBe('{"score":2}')
  })

  it.each([1, 2])('refuses duplicate v%s boundaries without changing the saved file', version => {
    const f = runtime()
    mkdirSync(join(f.root, 'chat'))
    const state = { variableStateJson: '{"score":1}', settingLibraryStateJson: '[]' }
    const record = version === 1 ? { beforeTurn: 2, state } : { turn: 1, phase: 'after', state }
    const content = JSON.stringify({ version, checkpoints: [record, record] })
    writeFileSync(f.checkpoints, content)
    expect(() => f.ctx.eleckoiRoleplaySessions.variableStatesByTurn('chat')).toThrow('检查点重复')
    expect(readFileSync(f.checkpoints, 'utf8')).toBe(content)
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).not.toHaveBeenCalled()
  })

  it.each(['', 'null', '[]', 'invalid'])('preserves an invalid old variable record without defaulting it to an empty object: %s', variableStateJson => {
    const f = runtime()
    mkdirSync(join(f.root, 'chat'))
    const content = JSON.stringify({ version: 1, checkpoints: [{ beforeTurn: 2,
      state: { variableStateJson, settingLibraryStateJson: '[]' } }] })
    writeFileSync(f.checkpoints, content)
    expect(() => f.ctx.eleckoiRoleplaySessions.variableStatesByTurn('chat')).toThrow()
    expect(readFileSync(f.checkpoints, 'utf8')).toBe(content)
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).not.toHaveBeenCalled()
  })

  it('keeps earlier completed state when rewinding and restores every boundary on rollback', () => {
    const f = runtime()
    mkdirSync(join(f.root, 'chat'))
    const record = (turn, phase, score) => ({ turn, phase, state: {
      variableStateJson: JSON.stringify({ score }), settingLibraryStateJson: '[]'
    } })
    const content = JSON.stringify({ version: 2, checkpoints: [record(1, 'after', 10),
      record(2, 'before', 20), record(2, 'after', 30), record(3, 'before', 40)] })
    writeFileSync(f.checkpoints, content)
    const restore = f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 2)
    expect(restore.state.variableStateJson).toBe('{"score":20}')
    restore.apply()
    expect(f.ctx.eleckoiRoleplaySessions.variableStatesByTurn('chat')).toEqual({ 1: '{"score":10}' })
    expect(JSON.parse(readFileSync(f.checkpoints, 'utf8')).checkpoints).toEqual([
      record(1, 'after', 10), record(2, 'before', 20)
    ])
    restore.rollback()
    expect(readFileSync(f.checkpoints, 'utf8')).toBe(content)
    expect(f.ctx.eleckoiRoleplaySessions.variableStatesByTurn('chat')).toEqual({ 1: '{"score":10}', 2: '{"score":30}' })
  })

  it('uses only the immediately preceding completed state when a new turn has not been prepared', () => {
    const f = runtime()
    mkdirSync(join(f.root, 'chat'))
    writeFileSync(f.checkpoints, JSON.stringify({ version: 2, checkpoints: [{ turn: 1, phase: 'after',
      state: { variableStateJson: '{"score":10}', settingLibraryStateJson: '[]' } }] }))
    const restore = f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 2)
    expect(restore.state.variableStateJson).toBe('{"score":10}')
    expect(() => f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 3)).toThrow('缺少第 3 轮')
  })

  it('does not substitute an old pre-input boundary for a requested completed fork state', async () => {
    const f = runtime()
    mkdirSync(join(f.root, 'chat'))
    writeFileSync(f.checkpoints, JSON.stringify({ version: 1, checkpoints: [{ beforeTurn: 2,
      state: { variableStateJson: '{"score":20}', settingLibraryStateJson: '[]' } }] }))
    await expect(f.ctx.eleckoiRoleplaySessions.adoptFork('new-chat', 'chat', 1, true)).rejects.toThrow('完成后')
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).not.toHaveBeenCalled()
  })

  it.each(['aborted', 'error'])('does not publish pre-input or current variables as completed history after %s', async kind => {
    const f = runtime()
    mkdirSync(join(f.root, 'chat'))
    const content = JSON.stringify({ version: 2, checkpoints: [{ turn: 1, phase: 'before',
      state: { variableStateJson: '{"score":10}', settingLibraryStateJson: '[]' } }] })
    writeFileSync(f.checkpoints, content)
    writeSessionSnapshot(f.root, 'session', { conversationId: 'chat', operationId: 'synthetic-operation' })
    f.ctx.eleckoiProductData.commitConversationRuntime = vi.fn()
    let completion
    f.ctx.eleckoiConversationLifecycle = { matches: () => true, track: (_chat, _id, operation) => { completion = operation() } }
    const reason = kind === 'aborted' ? { kind, reason: { kind: 'user' } }
      : { kind, error: { message: 'Synthetic generation failure', code: 'UNKNOWN' } }
    f.listeners.get('session/event')({ id: 'session' }, { type: 'turn/end', data: { turn: 1, reason } })
    if (kind === 'error') await expect(completion).rejects.toThrow('Synthetic generation failure')
    else await completion
    expect(f.ctx.eleckoiProductData.commitConversationRuntime).not.toHaveBeenCalled()
    expect(f.ctx.eleckoiRoleplaySessions.variableStatesByTurn('chat')).toEqual({})
    expect(readFileSync(f.checkpoints, 'utf8')).toBe(content)
  })
})
