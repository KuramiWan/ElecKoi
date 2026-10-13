import type { DesktopHostFailureNotice } from './errors/ipc.js'
import type { UpdateInstallResult, UpdateStatus } from './updates/schemas.js'

/** 宿主失败通知的线上形状（形状定义在边界⑤ 的合同里，这里只为壳的 API 面转出）。 */
export type { DesktopHostFailureNotice }

/** Main-issued identity for one Electron browser guest reservation. */
export type DesktopBrowserLeaseId = string & { readonly __desktopBrowserLeaseId: unique symbol }

/** Main-approved storage partition for one browser guest. */
export interface DesktopBrowserReservation {
  readonly lease: DesktopBrowserLeaseId
  readonly partition: string
}

/** Main-approved request to open an HTTP(S) page from an existing guest. */
export interface DesktopBrowserOpenRequest {
  readonly lease: DesktopBrowserLeaseId
  readonly url: string
}

/** Narrow browser transport exposed by the Electron preload. */
export interface DesktopBrowserBridge {
  acquire(workspace: string): Promise<DesktopBrowserReservation>
  release(lease: DesktopBrowserLeaseId): Promise<void>
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
}

/** Private IPC channels owned by the Electron desktop shell. */
export const DESKTOP_SHELL_IPC = {
  updatesStatus: 'dsh-desktop:updates-status',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesDownload: 'dsh-desktop:updates-download',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesChanged: 'dsh-desktop:updates-changed',
  hostFailure: 'dsh-desktop:host-failure',
  windowControl: 'dsh-desktop:window-control',
  browserAcquire: 'dsh-desktop:browser-acquire',
  browserRelease: 'dsh-desktop:browser-release',
  browserOpenRequested: 'dsh-desktop:browser-open-requested'
} as const

/** Narrow desktop-only capabilities exposed by the preload script. */
export interface DshDesktopProductApi {
  readonly protocolVersion: 1
  readonly browser: DesktopBrowserBridge
  readonly updates?: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<UpdateStatus>
    install(): Promise<UpdateInstallResult>
    subscribe(listener: (status: UpdateStatus) => void): () => void
  }
  readonly windowControls?: {
    minimize(): Promise<void>
    maximizeToggle(): Promise<void>
    close(): Promise<void>
  }
  readonly host?: {
    /**
     * 插件宿主意外退出时的通知出口。听众收到的是**失败对象**（码 + 参数化详情 + 诊断指针），
     * 不是拼好的用户可见句子——用户可见文案只有一个解析点（渲染层，ADR 0002 决定 4/8）。
     */
    subscribeFailure(listener: (failure: DesktopHostFailureNotice) => void): () => void
  }
}
