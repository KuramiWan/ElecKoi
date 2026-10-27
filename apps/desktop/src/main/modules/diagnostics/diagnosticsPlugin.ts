/**
 * Bug 报告的主进程侧：收集、导出、打开投递通道（[ADR 0041](../../../../../docs/adr/0041-bug-report-delivery.md)）。
 *
 * 判据：渲染层只做展示与选择，报告一律在主进程生成——日志在它手里，脱敏也在它手里。所以这里
 * 只有三件事：
 *
 * 1. **收集**：读最近日志 → 判断上次会话 → 拼报告 → 脱敏（`buildBugReport` 内部完成）。
 * 2. **导出**：用户按了「导出」就带日志尾，写成一个 JSON 文件。
 * 3. **打开通道**：只放行 `mailto:` 与 GitHub 的 https 地址，其余一律拒收。
 *
 * 两条约束：
 *
 * 1. **地址来自发布配置，不写死在代码里**（见 `reportDelivery.ts`）。
 * 2. **失败带码。** 载荷不合合同走 `contract/invalid-request`（带 `issues`），写文件失败走
 *    `io/failed`（带 `operation` / `path`）。三个动作各有开始 / 成功 / 失败日志行。
 */
import { writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { app, dialog, ipcMain, shell } from 'electron'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import { DESKTOP_SHELL_IPC } from '@shared/contracts/desktopShell'
import { LOG_ACTIONS } from '@shared/contracts/logActions'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import {
  isBugReportExternalTarget,
  type BugReportExportRequest,
  type BugReportExportResult,
  type BugReportPreview,
  type BugReportPreviewRequest
} from '@shared/contracts/bugReport/delivery'
import type { BugReport } from '@shared/contracts/bugReport/report'
import { assertTrustedDshClientFrame } from '@main/platform/electron/validateSender'
import { handleDesktopIpcCall } from '@main/platform/electron/desktopIpcHandler'
import { logAction } from '@main/platform/logging/logActions'
import { buildBugReport } from './bugReportCollection'
import { readPreviousSession, readRecentLogLines } from './previousSession'
import {
  BUG_REPORT_LOG_SCAN_LINES,
  desktopReportEnvironment,
  exportFileName,
  readBugReportDelivery
} from './reportDelivery'

export const diagnosticsPlugin = {
  name: 'eleckoi-bug-report',
  inject: ['appLog', 'appPaths', 'electronWindows'],
  apply(ctx: Context) {
    const appLog = ctx.appLog
    const userData = ctx.appPaths.userData
    const windows = ctx.electronWindows
    const delivery = readBugReportDelivery()

    const assertSender = (event: Electron.IpcMainInvokeEvent): void => assertTrustedDshClientFrame(
      event.sender,
      event.senderFrame?.url ?? '',
      event.senderFrame === event.sender.mainFrame,
      windows.all().map(window => window.webContents)
    )

    const collect = (request: { readonly includeLogTail: boolean; readonly notes?: string }): BugReport => {
      // 首次运行（没有上一份日志）按「无异常会话」处理：报告里不该凭空出现一次崩溃。
      const session = readPreviousSession(userData)
        ?? { startedAt: new Date().toISOString(), ended: true }
      return buildBugReport({
        lines: readRecentLogLines(userData, BUG_REPORT_LOG_SCAN_LINES),
        environment: desktopReportEnvironment({
          appVersion: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          osType: os.type(),
          osRelease: os.release(),
          ...(process.versions.electron === undefined ? {} : { electronVersion: process.versions.electron }),
          nodeVersion: process.versions.node
        }),
        session,
        includeLogTail: request.includeLogTail,
        ...(request.notes === undefined ? {} : { notes: request.notes }),
        redaction: { home: app.getPath('home'), userData }
      })
    }

    handleDesktopIpcCall(DESKTOP_SHELL_IPC.bugReportPreview, (event, request) => {
      assertSender(event)
      const parsed = previewRequestOf(request)
      logAction(appLog, LOG_ACTIONS.bugReportPreview, 'start')
      try {
        const preview: BugReportPreview = { report: collect(parsed), delivery }
        logAction(appLog, LOG_ACTIONS.bugReportPreview, 'success')
        return preview
      } catch (error) {
        logAction(appLog, LOG_ACTIONS.bugReportPreview, 'failure', error)
        throw error
      }
    })

    handleDesktopIpcCall(DESKTOP_SHELL_IPC.bugReportExport, async (event, request) => {
      assertSender(event)
      const parsed = exportRequestOf(request)
      logAction(appLog, LOG_ACTIONS.bugReportExport, 'start')
      try {
        const report = collect({
          includeLogTail: true,
          ...(parsed.notes === undefined ? {} : { notes: parsed.notes })
        })
        const target = await chooseExportPath(windows, exportFileName(new Date()))
        if (target === undefined) {
          logAction(appLog, LOG_ACTIONS.bugReportExport, 'success')
          return { saved: false } satisfies BugReportExportResult
        }
        try {
          writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
        } catch (error) {
          throw new DesktopError(ELECKOI_FAILURE_CODES.ioFailed,
            `写入报告文件失败：${errorTextOf(error)}`, { operation: '写入报告文件', path: target })
        }
        logAction(appLog, LOG_ACTIONS.bugReportExport, 'success')
        return { saved: true, path: target } satisfies BugReportExportResult
      } catch (error) {
        logAction(appLog, LOG_ACTIONS.bugReportExport, 'failure', error)
        throw error
      }
    })

    handleDesktopIpcCall(DESKTOP_SHELL_IPC.bugReportOpen, async (event, target) => {
      assertSender(event)
      if (!isBugReportExternalTarget(target)) {
        throw new DesktopError(ELECKOI_FAILURE_CODES.contractInvalidRequest,
          '报告投递地址不合合同：只接受 mailto: 与 GitHub issue 链接。', {
            issues: [{ path: 'target', message: '必须是 mailto: 或 https://github.com/ 开头的地址' }]
          })
      }
      logAction(appLog, LOG_ACTIONS.bugReportOpen, 'start')
      try {
        await shell.openExternal(target.url)
        logAction(appLog, LOG_ACTIONS.bugReportOpen, 'success')
      } catch (error) {
        logAction(appLog, LOG_ACTIONS.bugReportOpen, 'failure', error)
        throw error
      }
    })

    return () => {
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.bugReportPreview)
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.bugReportExport)
      ipcMain.removeHandler(DESKTOP_SHELL_IPC.bugReportOpen)
    }
  }
} satisfies Plugin.Object

async function chooseExportPath(
  windows: { all(): Electron.BrowserWindow[] },
  fileName: string
): Promise<string | undefined> {
  const window = windows.all().find(candidate => !candidate.isDestroyed())
  const options: Electron.SaveDialogOptions = {
    title: '导出诊断报告',
    defaultPath: fileName,
    filters: [{ name: '诊断报告', extensions: ['json'] }]
  }
  const result = window === undefined
    ? await dialog.showSaveDialog(options)
    : await dialog.showSaveDialog(window, options)
  if (result.canceled || result.filePath === undefined || result.filePath === '') return undefined
  return result.filePath
}

function previewRequestOf(value: unknown): BugReportPreviewRequest {
  const fields = requestFields(value)
  const includeLogTail = fields.includeLogTail
  if (typeof includeLogTail !== 'boolean') throw invalidRequest('includeLogTail', '必须是布尔值')
  const notes = optionalNotes(fields)
  return { includeLogTail, ...(notes === undefined ? {} : { notes }) }
}

function exportRequestOf(value: unknown): BugReportExportRequest {
  const notes = optionalNotes(requestFields(value))
  return notes === undefined ? {} : { notes }
}

function requestFields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest('request', '必须是对象')
  }
  return value as Record<string, unknown>
}

function optionalNotes(fields: Record<string, unknown>): string | undefined {
  const notes = fields.notes
  if (notes === undefined) return undefined
  if (typeof notes !== 'string') throw invalidRequest('notes', '必须是字符串')
  return notes
}

function invalidRequest(path: string, message: string): DesktopError {
  return new DesktopError(ELECKOI_FAILURE_CODES.contractInvalidRequest,
    `报告请求不合合同：${path} ${message}。`, { issues: [{ path, message }] })
}

function errorTextOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
