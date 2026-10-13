import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `AppLog` 的 bootstrap 那侧要在**写入时**读 `app.getPath('userData')`：启动阶段抢先构造的
// logger 拿不到最终路径（`main.ts` 的 `setPath` 在后面）。所以用例改的是这个返回值，不是 logger。
const electronState = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData }
}))

import { createAppLog, getBootstrapLogger } from '@main/platform/logging/AppLog'

describe('AppLog 的文件出口', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eleckoi-app-log-'))
    electronState.userData = root
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('记一行日志后，文件里能读到它', () => {
    const logs = join(root, 'logs')
    const logger = createAppLog(logs)

    logger.info({ marker: 'first-line' }, '第一条日志')

    const file = join(logs, 'eleckoi-desktop.log')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('第一条日志')
  })

  it('超过单文件上限后轮转，并且只保留策略允许的文件数', () => {
    const logs = join(root, 'logs')
    const policy = { maxBytes: 512, maxFiles: 3 }
    const logger = createAppLog(logs, policy)

    const messages = Array.from({ length: 40 }, (_, index) => `第${String(index)}条日志`)
    for (const message of messages) logger.info({ message }, message)

    const files = readdirSync(logs).sort()
    // 保留期就是文件数上限：最老的一份在轮转时被删掉，不是事后扫目录。
    expect(files.length).toBeLessThanOrEqual(policy.maxFiles)
    expect(files).toContain('eleckoi-desktop.log')
    expect(files).toContain('eleckoi-desktop.log.1')
    expect(readFileSync(join(logs, 'eleckoi-desktop.log'), 'utf8')).toContain('第39条日志')
    const retained = files.map((name) => readFileSync(join(logs, name), 'utf8')).join('')
    expect(retained).not.toContain('第0条日志')
  })

  it('bootstrap logger 的目录在写入时才解析，启动阶段的失败也落文件', () => {
    const logger = getBootstrapLogger()
    // 模拟 `main.ts`：logger 先构造，`configureRuntimeUserData()` / `configureElectron()` 之后
    // `userData` 才定下最终值（未打包时带 `-dev`）。
    electronState.userData = join(root, 'final-user-data')

    logger.error({ marker: 'bootstrap' }, '启动阶段失败')

    const logs = join(root, 'final-user-data', 'logs')
    expect(readFileSync(join(logs, 'eleckoi-desktop-bootstrap.log'), 'utf8')).toContain('启动阶段失败')
    // 构造时看到的那个目录一个文件都不该产生。
    expect(existsSync(join(root, 'logs'))).toBe(false)
  })

  it('文件写不进去时，日志调用不把调用方带走（降级到 stdout 并报到 stderr）', () => {
    // 父路径是个普通文件 ⇒ `mkdirSync` 必失败（ENOTDIR）。
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, '不是目录')
    const logger = createAppLog(join(blocked, 'logs'))
    const report = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      expect(() => logger.error({ marker: 'sink' }, '出口写不进去')).not.toThrow()
      expect(String(report.mock.calls[0]?.[0] ?? '')).toContain('日志文件写入失败')
    } finally {
      report.mockRestore()
    }
  })
})
