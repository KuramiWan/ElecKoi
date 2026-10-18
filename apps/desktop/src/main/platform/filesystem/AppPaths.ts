import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'

export class AppPaths {
  readonly database: string
  readonly workspace: string
  readonly dshRuntime: string
  readonly media: string

  constructor(readonly userData: string = app.getPath('userData')) {
    this.database = join(userData, 'eleckoi-common.sqlite3')
    this.workspace = join(userData, 'workspace')
    this.dshRuntime = join(userData, 'dsh-runtime')
    this.media = join(userData, 'media')
    mkdirSync(this.workspace, { recursive: true })
    mkdirSync(this.dshRuntime, { recursive: true })
    mkdirSync(this.media, { recursive: true })
  }

  resolveResource(...segments: string[]): string {
    const candidates = [
      join(app.getAppPath(), 'resources', ...segments),
      join(process.resourcesPath, ...segments)
    ]
    const match = candidates.find(existsSync)
    if (match === undefined) {
      throw new DesktopError(ELECKOI_FAILURE_CODES.lookupNotFound,
        `缺少应用资源：apps/desktop/resources/${segments.join('/')}`, { what: '应用资源' })
    }
    return match
  }
}
