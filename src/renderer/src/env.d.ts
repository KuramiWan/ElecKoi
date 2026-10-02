/// <reference types="vite/client" />

import type { DshDesktopProductApi } from '../../shared/contracts/desktopShell'

declare global {
  interface Window {
    dshDesktop: DshDesktopProductApi
  }
}

export {}
