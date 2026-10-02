import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { historicalRuntimeState } from '../packages/dsh-client-roleplay/src/host/historical-runtime-state.mjs'
import { installRoleplaySessionRuntime } from '../packages/dsh-client-roleplay/src/host/session-runtime.mjs'
import { writeSessionSnapshot } from '../packages/dsh-client-roleplay/src/host/session-snapshot.mjs'

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
  const ctx = {
    eleckoiProductData: {
      readConversationDetails: () => ({ metadata: { characterId: 'synthetic-character' } }),
      exportConversationArchive: () => saved,
      restoreConversationRuntime: vi.fn(),
      validateConversationRuntimeSnapshot: vi.fn(),
      snapshotConversationRuntime: vi.fn(() => { throw new Error('must not read current state') })
    },
    sessionController: {}, sessionProjections: { register: () => () => {} }, agentDefaultModel: {}, llm: {},
    provide(name, service) { this[name] = service }, on() { return () => {} }
  }
  writeSessionSnapshot(root, 'session', { conversationId: 'chat' })
  installRoleplaySessionRuntime(ctx, {})
  return { root, saved, ctx, checkpoints: join(root, 'chat', 'eleckoi-runtime-checkpoints.json') }
}

describe('saved old runtime state', () => {
  it('recovers the exact old pre-input variables and settings into the existing checkpoint file', () => {
    const f = runtime()
    const restore = f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).not.toHaveBeenCalled()
    restore()
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).toHaveBeenCalledWith('chat', {
      variableStateJson: '{"score":2}', settingLibraryStateJson: '[]'
    })
    const stored = JSON.parse(readFileSync(f.checkpoints, 'utf8'))
    expect(stored).toEqual({ version: 1, checkpoints: [{ beforeTurn: 1, state: {
      variableStateJson: '{"score":2}', settingLibraryStateJson: '[]'
    } }] })
    // Once converted, normal rewind does not depend on the historical ledger.
    f.saved.tables.agent_responses = []
    expect(() => f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)).not.toThrow()
    expect(f.ctx.eleckoiProductData.snapshotConversationRuntime).not.toHaveBeenCalled()
  })

  it('uses the selected unanswered input state rather than the later native-turn checkpoint', () => {
    const f = runtime()
    f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)()
    f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1, 'unanswered')()
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
    f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1)()
    f.ctx.eleckoiProductData.readConversationDetails = () => ({ metadata: { characterId: '' } })
    f.ctx.eleckoiProductData.exportConversationArchive = () => { throw new Error('ordinary chat must not export a roleplay archive') }
    const restore = f.ctx.eleckoiRoleplaySessions.prepareRestoreBeforeTurn('chat', 'session', 1, 'native-input')
    restore()
    expect(f.ctx.eleckoiProductData.restoreConversationRuntime).toHaveBeenLastCalledWith('chat', {
      variableStateJson: '{"score":2}', settingLibraryStateJson: '[]'
    })
  })
})
