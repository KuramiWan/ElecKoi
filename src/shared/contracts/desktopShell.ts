import type { UpdateInstallResult, UpdateStatus } from './updates/schemas'

/** Private IPC channels owned by the Electron desktop shell. */
export const DESKTOP_SHELL_IPC = {
  updatesStatus: 'dsh-desktop:updates-status',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesDownload: 'dsh-desktop:updates-download',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesChanged: 'dsh-desktop:updates-changed',
  hostFailure: 'dsh-desktop:host-failure',
  windowControl: 'dsh-desktop:window-control'
} as const

/** Narrow desktop-only capabilities exposed by the preload script. */
export interface DshDesktopProductApi {
  readonly protocolVersion: 1
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
    subscribeFailure(listener: (message: string) => void): () => void
  }
}
