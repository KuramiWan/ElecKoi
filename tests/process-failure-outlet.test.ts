import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'

const electronState = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData }
}))

import { createAppLog, type AppLogFilePolicy } from '@main/platform/logging/AppLog'
import {
  installProcessFailureOutlet,
  type ProcessFailureEvent,
  type ProcessFailureTarget
} from '@main/platform/logging/processFailureOutlet'

type Listener = (reason: unknown, detail: unknown) => void

/** 只做「注册 / 注销 / 触发」三件事的假 process：用例不碰真实进程事件。 */
function createFakeProcess(): {
  target: ProcessFailureTarget
  emit: (event: ProcessFailureEvent, reason: unknown, detail: unknown) => void
  listenerCount: (event: ProcessFailureEvent) => number
} {
  const listeners = new Map<ProcessFailureEvent, Set<Listener>>()
  return {
    target: {
      on(event: ProcessFailureEvent, listener: Listener): unknown {
        const set = listeners.get(event) ?? new Set<Listener>()
        set.add(listener)
        listeners.set(event, set)
        return undefined
      },
      off(event: ProcessFailureEvent, listener: Listener): unknown {
        listeners.get(event)?.delete(listener)
        return undefined
      }
    },
    emit(event, reason, detail) {
      for (const listener of [...listeners.get(event) ?? []]) listener(reason, detail)
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0
    }
  }
}

describe('主进程的进程级失败落点', () => {
  let root: string
  let logs: string
  const policy: AppLogFilePolicy = { maxBytes: 64 * 1024, maxFiles: 2 }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eleckoi-process-failure-'))
    electronState.userData = root
    logs = join(root, 'logs')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function readLog(): string {
    return readFileSync(join(logs, 'eleckoi-desktop.log'), 'utf8')
  }

  it('未处理的拒绝被记进日志出口，并保留契约码与详情', () => {
    const logger = createAppLog(logs, policy)
    const fake = createFakeProcess()
    installProcessFailureOutlet(logger, fake.target)

    fake.emit(
      'unhandledRejection',
      new DesktopError(ELECKOI_FAILURE_CODES.ioFailed, '写入失败', { operation: 'write', path: '/tmp/x' }),
      undefined
    )

    const content = readLog()
    expect(content).toContain(ELECKOI_FAILURE_CODES.ioFailed)
    expect(content).toContain('写入失败')
    expect(content).toContain('unhandledRejection')
  })

  it('未捕获异常被记进日志出口，并保留原始 message', () => {
    const logger = createAppLog(logs, policy)
    const fake = createFakeProcess()
    installProcessFailureOutlet(logger, fake.target)

    fake.emit('uncaughtExceptionMonitor', new Error('定时器里炸了'), 'uncaughtException')

    const content = readLog()
    expect(content).toContain('定时器里炸了')
    expect(content).toContain('uncaughtException')
    // 不属于任何已点名语义的裸失败折兜底码（契约的折叠出口）。
    expect(content).toContain(ELECKOI_FAILURE_CODES.internal)
  })

  it('卸载之后不再记录', () => {
    const logger = createAppLog(logs, policy)
    const fake = createFakeProcess()
    const uninstall = installProcessFailureOutlet(logger, fake.target)
    expect(fake.listenerCount('unhandledRejection')).toBe(1)
    expect(fake.listenerCount('uncaughtExceptionMonitor')).toBe(1)

    uninstall()

    expect(fake.listenerCount('unhandledRejection')).toBe(0)
    expect(fake.listenerCount('uncaughtExceptionMonitor')).toBe(0)
  })
})
