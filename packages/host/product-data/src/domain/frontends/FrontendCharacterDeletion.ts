import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { ELECKOI_FAILURE_CODES } from '@shared/contracts/errors/codes'
import { DesktopError } from '@shared/foundation/DesktopError'
import { errorMessage } from '@shared/foundation/errorMessage'
import { FrontendIndex } from './FrontendIndex'
import type { FrontendJson } from './types'

const idSchema = z.string().min(1).refine(id => id !== '.' && id !== '..' && !/[\\/:\0]/.test(id))
// Index and journal inputs are parsed JSON; literal metadata keys must survive unchanged.
const recordSchema = z.custom<FrontendJson>(value => value !== null && typeof value === 'object' && !Array.isArray(value),
  'Frontend metadata must be an object')
const journalSchema = z.strictObject({
  version: z.literal(1),
  characters: z.array(z.strictObject({ id: z.string().min(1), settings: recordSchema.nullable() })).min(1),
  projects: z.array(z.strictObject({ id: idSchema, value: recordSchema, directoryExisted: z.boolean() })),
})
type Journal = z.infer<typeof journalSchema>

/** File deletion settles from committed character ownership, not process-local flags. */
export class FrontendCharacterDeletion {
  private readonly root: string
  constructor(private readonly index: FrontendIndex, private readonly characterExists: (id: string) => boolean) {
    this.root = resolve(index.root, '.character-deletions')
    this.recover()
  }

  run<T>(characterIds: readonly string[], operation: () => T): T {
    this.recover()
    const ids = [...new Set(characterIds)]
    if (!ids.length) return operation()
    if (ids.some(id => !this.characterExists(id))) throw new DesktopError(ELECKOI_FAILURE_CODES.characterNotFound, 'Frontend deletion requires existing character owners', { what: '角色' })
    const owners = new Set(ids)
    const projects = Object.entries(this.index.list('projects')).flatMap(([id, value]) => {
      const project = recordSchema.parse(value)
      if ((project.scope ?? 'character') !== 'character' || typeof project.characterId !== 'string' || !owners.has(project.characterId)) return []
      idSchema.parse(id)
      if (project.id !== id) throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, `Frontend project identity does not match its index: ${id}`, { what: '前端项目与索引的身份' })
      const directory = this.projectPath(id)
      this.requireDirectory(directory)
      return [{ id, value: project, directoryExisted: existsSync(directory) }]
    })
    const journal = journalSchema.parse({ version: 1, projects, characters: ids.map(id => ({
      id, settings: this.index.get('character-settings', id),
    })) })
    if (!journal.projects.length && journal.characters.every(owner => owner.settings === null)) return operation()
    const directory = join(this.root, randomUUID())
    this.requireDirectory(join(this.index.root, 'projects'))
    mkdirSync(join(directory, 'projects'), { recursive: true })
    try {
      writeFileSync(join(directory, 'journal.json.tmp'), JSON.stringify(journal), 'utf8')
      renameSync(join(directory, 'journal.json.tmp'), join(directory, 'journal.json'))
    }
    catch (error) { this.cleanup(directory); throw error }
    try {
      for (const project of journal.projects) if (project.directoryExisted) {
        renameSync(this.projectPath(project.id), join(directory, 'projects', project.id))
      }
      const result = operation()
      if (ids.some(id => this.characterExists(id))) throw new DesktopError(ELECKOI_FAILURE_CODES.internal, 'Character deletion did not commit its owners', { what: '角色所有者的删除结果' })
      this.settle(directory, journal)
      return result
    } catch (error) {
      try { this.settle(directory, journal) }
      catch (recoveryError) {
        throw new AggregateError([error, recoveryError], 'Frontend character deletion needs recovery; its files have been retained')
      }
      throw error
    }
  }

  recover(): void {
    if (!existsSync(this.root)) return
    this.requireDirectory(this.root)
    for (const name of readdirSync(this.root)) {
      z.uuid().parse(name)
      const directory = join(this.root, name)
      this.requireDirectory(directory)
      const path = join(directory, 'journal.json')
      if (!existsSync(path)) { this.cleanup(directory); continue }
      const journal = this.readJournal(path)
      if (new Set(journal.characters.map(owner => owner.id)).size !== journal.characters.length
        || new Set(journal.projects.map(project => project.id)).size !== journal.projects.length) {
        throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, 'Frontend deletion record contains duplicate identities', { what: '前端删除记录的标识' })
      }
      for (const project of journal.projects) {
        if (project.value.id !== project.id || (project.value.scope ?? 'character') !== 'character'
          || !journal.characters.some(owner => owner.id === project.value.characterId)) {
          throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, 'Frontend deletion record has an unrelated project owner', { what: '前端删除记录的项目归属' })
        }
      }
      this.settle(directory, journal)
    }
  }

  private readJournal(path: string): Journal {
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) {
      throw new DesktopError(ELECKOI_FAILURE_CODES.storageCorrupt,
        `Frontend deletion recovery journal is corrupt: ${errorMessage(error)}`, { what: '恢复日志' })
    }
    return journalSchema.parse(parsed)
  }

  private settle(directory: string, journal: Journal): void {
    const states = journal.characters.map(owner => this.characterExists(owner.id))
    const committed = states.every(exists => !exists)
    if (!committed && !states.every(Boolean)) throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, 'Frontend deletion has mixed character ownership; retained files need inspection', { what: '角色所有权的删除状态' })
    this.requireDirectory(join(this.index.root, 'projects'))
    this.requireDirectory(join(directory, 'projects'))
    for (const project of journal.projects) {
      const current = this.index.get('projects', project.id)
      if (!isDeepStrictEqual(current, project.value) && !(committed && current === null)) {
        throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision, `Frontend project changed during character deletion: ${project.id}`, { what: '前端项目' })
      }
      const source = this.projectPath(project.id), saved = join(directory, 'projects', project.id)
      this.requireDirectory(source); this.requireDirectory(saved)
      if (!project.directoryExisted && existsSync(saved)) throw new DesktopError(ELECKOI_FAILURE_CODES.stateMismatch, `Frontend deletion has an unexpected saved directory: ${project.id}`, { what: '前端删除记录的项目目录' })
      if ((existsSync(saved) && existsSync(source)) || (committed && existsSync(source))) {
        throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision, `Frontend directory changed during character deletion: ${project.id}`, { what: '前端项目目录' })
      }
      if (!committed && project.directoryExisted && !existsSync(source) && !existsSync(saved)) {
        throw new DesktopError(ELECKOI_FAILURE_CODES.lookupNotFound, `Frontend directory is missing during rollback: ${project.id}`, { what: '前端项目目录' })
      }
    }
    for (const owner of journal.characters) {
      const current = this.index.get('character-settings', owner.id)
      if (!isDeepStrictEqual(current, owner.settings) && !(committed && current === null)) {
        throw new DesktopError(ELECKOI_FAILURE_CODES.conflictStaleRevision, `Frontend selection changed during character deletion: ${owner.id}`, { what: '前端选择记录' })
      }
    }
    if (committed) {
      this.index.atomic(() => {
        for (const project of journal.projects) this.index.delete('projects', project.id)
        for (const owner of journal.characters) this.index.delete('character-settings', owner.id)
      })
    } else {
      for (const project of [...journal.projects].reverse()) {
        const saved = join(directory, 'projects', project.id)
        if (existsSync(saved)) renameSync(saved, this.projectPath(project.id))
      }
    }
    this.cleanup(directory)
  }

  private projectPath(id: string): string {
    idSchema.parse(id)
    return resolve(this.index.root, 'projects', id)
  }
  private requireDirectory(path: string): void {
    if (!existsSync(path)) return
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DesktopError(ELECKOI_FAILURE_CODES.dataShapeInvalid, `Frontend deletion requires an ordinary directory: ${path}`, { what: '前端删除目录', path })
  }
  private cleanup(directory: string): void {
    if (!resolve(directory).startsWith(this.root + sep)) throw new DesktopError(ELECKOI_FAILURE_CODES.securityDenied, 'Invalid frontend deletion directory', { what: '前端删除目录之外的路径' })
    this.requireDirectory(directory)
    rmSync(directory, { recursive: true, force: true })
  }
}
