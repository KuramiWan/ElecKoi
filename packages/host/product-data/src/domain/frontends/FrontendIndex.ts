import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FrontendValue } from './types'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'

export type FrontendSection = 'projects' | 'character-settings' | 'application-settings'
type Entries = Record<string, FrontendValue>
interface Index { version: 1; projects: Entries; 'character-settings': Entries; 'application-settings': Entries }

/** The Host-owned catalog for file projects; never stores asset bodies. */
export class FrontendIndex {
  private draft: Index | undefined
  readonly path: string
  constructor(readonly root: string) { this.path = join(root, 'projects.json') }

  private read(): Index {
    if (this.draft) return this.draft
    if (!existsSync(this.path)) return { version: 1, projects: {}, 'character-settings': {}, 'application-settings': {} }
    const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
    if (!isObject(value) || value.version !== 1) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, 'Unsupported or invalid frontend project index', { what: '前端项目索引', path: this.path })
    for (const section of ['projects', 'character-settings', 'application-settings']) {
      if (!isObject(value[section])) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, `Invalid frontend index section: ${section}`, { what: '前端项目索引的分区', path: section })
    }
    return value as unknown as Index
  }

  get(section: FrontendSection, key: string): FrontendValue {
    const entries = this.read()[section]
    return Object.hasOwn(entries, key) ? structuredClone(entries[key]!) : null
  }
  list(section: FrontendSection): Entries { return structuredClone(this.read()[section]) }
  put(section: FrontendSection, key: string, value: FrontendValue): void {
    if (!this.draft) { this.atomic(() => this.put(section, key, value)); return }
    Object.defineProperty(this.draft[section], key, { value: structuredClone(value), enumerable: true, writable: true, configurable: true })
  }
  delete(section: FrontendSection, key: string): void {
    if (!this.draft) { this.atomic(() => this.delete(section, key)); return }
    delete this.draft[section][key]
  }
  atomic<T>(operation: () => T): T {
    if (this.draft) {
      const before = structuredClone(this.draft)
      try { return operation() } catch (error) { this.draft = before; throw error }
    }
    this.draft = structuredClone(this.read())
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      const result = operation()
      mkdirSync(this.root, { recursive: true })
      writeFileSync(temporary, JSON.stringify(this.draft), 'utf8')
      renameSync(temporary, this.path)
      return result
    } finally {
      this.draft = undefined
      if (existsSync(temporary)) rmSync(temporary)
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
