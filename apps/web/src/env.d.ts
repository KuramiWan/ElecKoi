/// <reference types="vite/client" />

import type { DshDesktopProductApi } from '../../../packages/shared/src/contracts/desktopShell'

declare global {
  interface Window {
    dshDesktop: DshDesktopProductApi
  }
}

export {}
