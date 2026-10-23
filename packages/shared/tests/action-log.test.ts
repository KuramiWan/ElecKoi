/**
 * 动作语义键与动作日志行（WP14）。
 *
 * 设计判据：「抽一行日志能读出在做什么」「启动退出成对」。
 * 这里断言三件事：
 *
 * 1. **键表形态**：每个键是 `<域>.<动作>` 的语义名（不是函数名、不是随机 id）、彼此不重复；
 * 2. **一行自解释**：开始 / 成功 / 失败各一条文本，失败那一条同时含动作键与契约码；
 * 3. **跨进程往返**：渲染层拼出来的那一行能被主进程原样解回，且坏行一律拒收。
 */
import { describe, expect, it } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '../src/contracts/errors/codes'
import {
  LOG_ACTIONS,
  LOG_ACTION_KEY_PATTERN,
  LOG_ACTION_MESSAGE_MARKER,
  LOG_ACTION_PHASES,
  isLogAction,
  isLogActionPhase
} from '../src/contracts/logActions'
import { describeAction, formatActionLogMessage, parseActionLogMessage } from '../src/foundation/actionLog'
import { DesktopError } from '../src/foundation/DesktopError'

describe('动作语义键表', () => {
  it('每个键都是 <域>.<动作> 的语义名', () => {
    for (const [name, action] of Object.entries(LOG_ACTIONS)) {
      expect(action, name).toMatch(LOG_ACTION_KEY_PATTERN)
      expect(action, name).toContain('.')
    }
  })

  it('键不重复（两个动作共用一个键会让日志分不开）', () => {
    const actions = Object.values(LOG_ACTIONS)
    expect(new Set(actions).size).toBe(actions.length)
  })

  it('只认表里的键与阶段', () => {
    expect(isLogAction(LOG_ACTIONS.messageSend)).toBe(true)
    expect(isLogAction('message.send.typo')).toBe(false)
    expect(isLogAction('savePreset')).toBe(false)
    expect(isLogAction(undefined)).toBe(false)
    expect(isLogActionPhase('start')).toBe(true)
    expect(isLogActionPhase('failure')).toBe(true)
    expect(isLogActionPhase('done')).toBe(false)
    expect([...LOG_ACTION_PHASES]).toEqual(['start', 'success', 'failure'])
  })
})

describe('动作日志行', () => {
  it('开始与成功各一行，都带语义动作键', () => {
    const started = describeAction(LOG_ACTIONS.presetSave, 'start')
    const succeeded = describeAction(LOG_ACTIONS.presetSave, 'success')

    expect(started.text).toContain(LOG_ACTIONS.presetSave)
    expect(started.text).toContain('开始')
    expect(succeeded.text).toContain(LOG_ACTIONS.presetSave)
    expect(succeeded.text).toContain('成功')
    expect(started.code).toBeUndefined()
    expect(succeeded.code).toBeUndefined()
  })

  it('失败那一条同时含动作键、契约码、开发者文案与详情', () => {
    const failure = new DesktopError(
      ELECKOI_FAILURE_CODES.characterNotFound,
      '角色卡不存在：角色卡 abc.json',
      { what: '角色卡' }
    )
    const record = describeAction(LOG_ACTIONS.characterImport, 'failure', failure)

    expect(record.phase).toBe('failure')
    expect(record.code).toBe(ELECKOI_FAILURE_CODES.characterNotFound)
    expect(record.message).toBe('角色卡不存在：角色卡 abc.json')
    expect(record.details).toEqual({ what: '角色卡' })
    expect(record.text).toContain(LOG_ACTIONS.characterImport)
    expect(record.text).toContain(`[${ELECKOI_FAILURE_CODES.characterNotFound}]`)
    expect(record.text).toContain('角色卡不存在：角色卡 abc.json')
    expect(record.text).toContain('what: 角色卡')
  })

  it('裸 Error 也折成兜底码，失败行仍带码（诊断不丢）', () => {
    const record = describeAction(LOG_ACTIONS.messageSend, 'failure', new Error('网络断了'))

    expect(record.code).toBe(ELECKOI_FAILURE_CODES.internal)
    expect(record.message).toContain('网络断了')
    expect(record.text).toContain(`[${ELECKOI_FAILURE_CODES.internal}]`)
  })
})

describe('渲染层 → 主进程的动作行', () => {
  const failure = new DesktopError(
    ELECKOI_FAILURE_CODES.lookupNotFound,
    '找不到这个会话：会话 abc',
    { what: '会话' }
  )

  it('拼出来的一行带固定前缀，解回来与原记录一致', () => {
    const record = describeAction(LOG_ACTIONS.conversationDelete, 'failure', failure)
    const line = formatActionLogMessage(record)

    expect(line.startsWith(`${LOG_ACTION_MESSAGE_MARKER} `)).toBe(true)
    expect(parseActionLogMessage(line)).toEqual(record)
  })

  it('解析出来的失败行同时带动作键与码（验收判据）', () => {
    const parsed = parseActionLogMessage(
      formatActionLogMessage(describeAction(LOG_ACTIONS.updateCheck, 'failure', failure))
    )

    expect(parsed?.action).toBe(LOG_ACTIONS.updateCheck)
    expect(parsed?.code).toBe(ELECKOI_FAILURE_CODES.lookupNotFound)
    expect(parsed?.text).toContain(LOG_ACTIONS.updateCheck)
  })

  it('不认的行走不到主进程日志里', () => {
    expect(parseActionLogMessage('随便一句 console 输出')).toBeUndefined()
    expect(parseActionLogMessage(undefined)).toBeUndefined()
    expect(parseActionLogMessage(`${LOG_ACTION_MESSAGE_MARKER} 不是 JSON`)).toBeUndefined()
    expect(parseActionLogMessage(`${LOG_ACTION_MESSAGE_MARKER} {"action":"拼错的键","phase":"start","text":"x"}`))
      .toBeUndefined()
    expect(parseActionLogMessage(`${LOG_ACTION_MESSAGE_MARKER} {"action":"message.send","phase":"完成","text":"x"}`))
      .toBeUndefined()
    expect(parseActionLogMessage(`${LOG_ACTION_MESSAGE_MARKER} {"action":"message.send","phase":"start","text":""}`))
      .toBeUndefined()
  })

  it('失败行没带码就不收（读不出为什么的行没有诊断价值）', () => {
    expect(parseActionLogMessage(
      `${LOG_ACTION_MESSAGE_MARKER} {"action":"message.send","phase":"failure","text":"动作 message.send 失败"}`
    )).toBeUndefined()
  })

  it('详情必须是扁平对象，数组不收', () => {
    expect(parseActionLogMessage(
      `${LOG_ACTION_MESSAGE_MARKER} {"action":"message.send","phase":"failure","text":"x","code":"eleckoi/internal","details":[1]}`
    )).toBeUndefined()
    expect(parseActionLogMessage(
      `${LOG_ACTION_MESSAGE_MARKER} {"action":"message.send","phase":"failure","text":"x","code":"eleckoi/internal","details":{"what":"消息"}}`
    )?.details).toEqual({ what: '消息' })
  })
})
