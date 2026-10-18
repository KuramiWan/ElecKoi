import { existsSync } from 'node:fs'
import { shell } from 'electron'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'

export class ElectronFileOpener {
  reveal(path: string): void {
    if (!existsSync(path)) {
      throw new DesktopError(ELECKOI_FAILURE_CODES.lookupNotFound, '文件已不存在。', { what: '文件' })
    }
    shell.showItemInFolder(path)
  }
}
