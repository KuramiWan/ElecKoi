import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, parse, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  creatorProjectCollectionSchema,
  creatorProjectSchema,
  type CreatorProject,
  type CreatorProjectCollection,
  type CreatorProjectMode
} from '@shared/contracts/creatorStudio/schemas'
import { contractFailure } from '@product-data/contractFailure'

const INDEX_VERSION = 1
const MANIFEST_FILE = 'project.eleckoi.json'
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * `eleckoi/safety/refused` 的 `details.guard`：**哪道护栏**拒绝了执行。
 * 三道守卫的恢复动作不同（补索引 / 别碰可疑目标），所以各有各的值；
 * 判据来源：ADR 0002 决定 14（`safety/refused` 的语义是"拒绝执行"而不是"失败"）
 * 与 `notes/eh-explore-sites.md` 表第 11、12、13(b) 行。
 */
const GUARD_ABSOLUTE_DIRECTORY = 'creator-project-absolute-directory'
const GUARD_NOT_FILESYSTEM_ROOT = 'creator-project-not-filesystem-root'
const GUARD_MANIFEST_MATCHES_INDEX = 'creator-project-manifest-matches-index'

/**
 * `eleckoi/storage/corrupt` 的 `details.what`：**哪份存储**坏了。
 * 索引（每次项目操作都读）与单项目清单（删除前才读）是两份不同的东西。
 */
const CORRUPT_PROJECT_INDEX = 'creator-project-index'
const CORRUPT_PROJECT_MANIFEST = 'creator-project-manifest'

interface CreatorProjectIndex {
  version: number
  items: CreatorProject[]
}

interface CreateCreatorProjectInput {
  name: string
  mode: CreatorProjectMode
  parentDirectory: string
  sourceCharacterId?: string
  coverImage?: string
}

export class CreatorProjectRepository {
  private readonly indexDirectory: string
  private readonly indexPath: string

  constructor(workspacePath: string) {
    this.indexDirectory = join(workspacePath, 'creator-studio')
    this.indexPath = join(this.indexDirectory, 'projects.json')
  }

  list(): CreatorProjectCollection {
    const index = this.readIndex()
    return creatorProjectCollectionSchema.parse({
      items: index.items
        .filter((project) => existsSync(join(project.rootPath, MANIFEST_FILE)))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    })
  }

  require(projectId: string): CreatorProject {
    const project = this.list().items.find((item) => item.id === projectId)
    if (project === undefined) {
      throw contractFailure(
        'eleckoi/creator-project/not-found',
        `读取创作项目失败：索引 ${this.indexPath} 里没有 id 为 ${projectId} 的条目，`
          + `或它的 ${MANIFEST_FILE} 已不存在（list() 会滤掉清单缺失的条目）。`,
        { what: projectId }
      )
    }
    return project
  }

  create(input: CreateCreatorProjectInput): CreatorProjectCollection {
    const name = input.name.trim()
    const parentDirectory = resolve(input.parentDirectory.trim())
    if (!name) {
      throw contractFailure(
        'eleckoi/input/invalid',
        '创建创作项目失败：name 去掉首尾空白后为空。',
        { field: 'name' }
      )
    }
    if (!isAbsolute(parentDirectory)) {
      throw contractFailure(
        'eleckoi/input/invalid',
        `创建创作项目失败：parentDirectory 解析后不是绝对路径（${parentDirectory}）。`,
        { field: 'parentDirectory' }
      )
    }
    if (input.mode === 'existing' && !input.sourceCharacterId?.trim()) {
      throw contractFailure(
        'eleckoi/input/invalid',
        '创建创作项目失败：mode 为 existing 时 sourceCharacterId 为空。',
        { field: 'sourceCharacterId' }
      )
    }

    const directoryName = safeDirectoryName(name)
    const rootPath = resolve(parentDirectory, directoryName)
    const relativeRoot = relative(parentDirectory, rootPath)
    if (!relativeRoot || relativeRoot.startsWith('..') || isAbsolute(relativeRoot)) {
      throw contractFailure(
        'eleckoi/input/invalid',
        `创建创作项目失败：name 归一化成的相对目录 ${relativeRoot} 会离开选定的保存位置 ${parentDirectory}。`,
        { field: 'name' }
      )
    }
    if (existsSync(rootPath)) {
      throw contractFailure(
        'eleckoi/creator-project/name-taken',
        `创建创作项目失败：目标目录已存在（${rootPath}）。`,
        { path: rootPath }
      )
    }

    const now = new Date().toISOString()
    const project = creatorProjectSchema.parse({
      id: randomUUID(),
      name,
      mode: input.mode,
      rootPath,
      sourceCharacterId: input.sourceCharacterId?.trim() ?? '',
      coverImage: input.coverImage?.trim() ?? '',
      createdAt: now,
      updatedAt: now
    })
    const manifest = {
      schemaVersion: 1,
      kind: 'eleckoi-character-project',
      ...project
    }

    mkdirSync(rootPath, { recursive: false })
    try {
      writeFileSync(join(rootPath, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      const current = this.readIndex()
      this.writeIndex({ version: INDEX_VERSION, items: [project, ...current.items] })
    } catch (error) {
      rmSync(rootPath, { recursive: true, force: true })
      throw error
    }
    return this.list()
  }

  delete(projectId: string): CreatorProjectCollection {
    const current = this.readIndex()
    const project = current.items.find((item) => item.id === projectId)
    if (project === undefined) {
      throw contractFailure(
        'eleckoi/creator-project/not-found',
        `删除创作项目失败：索引 ${this.indexPath} 里没有 id 为 ${projectId} 的条目。`,
        { what: projectId }
      )
    }

    const rootPath = this.requireOwnedProjectDirectory(project)
    try {
      rmSync(rootPath, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 })
    } catch (error) {
      throw contractFailure(
        'eleckoi/io/failed',
        `删除创作项目目录失败：rm ${rootPath} 抛出 ${describeError(error)}。`,
        { operation: 'delete', path: rootPath }
      )
    }

    const remaining = current.items.filter((project) => project.id !== projectId)
    this.writeIndex({ version: INDEX_VERSION, items: remaining })
    return this.list()
  }

  private requireOwnedProjectDirectory(project: CreatorProject): string {
    if (!isAbsolute(project.rootPath)) {
      throw contractFailure(
        'eleckoi/safety/refused',
        `删除创作项目失败：索引条目的 rootPath 不是绝对路径（${project.rootPath}），为避免误删未执行操作。`,
        { guard: GUARD_ABSOLUTE_DIRECTORY }
      )
    }
    const rootPath = resolve(project.rootPath)
    if (rootPath === parse(rootPath).root) {
      throw contractFailure(
        'eleckoi/safety/refused',
        `删除创作项目失败：索引条目的 rootPath 解析到文件系统根目录（${rootPath}），为避免误删未执行操作。`,
        { guard: GUARD_NOT_FILESYSTEM_ROOT }
      )
    }

    const manifest = this.readProjectManifest(rootPath)
    if (
      manifest.kind !== 'eleckoi-character-project'
      || manifest.id !== project.id
      || typeof manifest.rootPath !== 'string'
      || resolve(manifest.rootPath) !== rootPath
    ) {
      throw contractFailure(
        'eleckoi/safety/refused',
        `删除创作项目失败：${join(rootPath, MANIFEST_FILE)} 与索引条目不一致`
          + `（kind=${String(manifest.kind)}、id=${String(manifest.id)}），为避免误删未执行操作。`,
        { guard: GUARD_MANIFEST_MATCHES_INDEX }
      )
    }
    return rootPath
  }

  /**
   * 读 + 解析 `project.eleckoi.json`。**只负责存储这一层**：读不出来、不是 JSON、
   * 或不是 JSON 对象 ⇒ `eleckoi/storage/corrupt`（调用方的恢复动作是修/删这份清单）。
   * 「清单与索引打架」是另一回事，由 {@link requireOwnedProjectDirectory} 单独判成 `eleckoi/safety/refused`。
   * 拆开是票点名的判断：一个 catch 同时吞掉两种语义，一个码盖不住（`notes/eh-explore-sites.md` 表第 13 行）。
   */
  private readProjectManifest(rootPath: string): Record<string, unknown> {
    const manifestPath = join(rootPath, MANIFEST_FILE)
    let value: unknown
    try {
      value = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      throw contractFailure(
        'eleckoi/storage/corrupt',
        `读取创作项目清单失败：${manifestPath} 读不出来或不是 JSON（${describeError(error)}）。`,
        { what: CORRUPT_PROJECT_MANIFEST }
      )
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw contractFailure(
        'eleckoi/storage/corrupt',
        `读取创作项目清单失败：${manifestPath} 解析出来的不是 JSON 对象。`,
        { what: CORRUPT_PROJECT_MANIFEST }
      )
    }
    return value as Record<string, unknown>
  }

  private readIndex(): CreatorProjectIndex {
    if (!existsSync(this.indexPath)) return { version: INDEX_VERSION, items: [] }
    try {
      const value = JSON.parse(readFileSync(this.indexPath, 'utf8')) as unknown
      const parsed = creatorProjectCollectionSchema.parse(value)
      return { version: INDEX_VERSION, items: parsed.items }
    } catch (error) {
      throw contractFailure(
        'eleckoi/storage/corrupt',
        `读取创作项目索引失败：${this.indexPath} 不是合法 JSON 或不符合 creatorProjectCollectionSchema`
          + `（${describeError(error)}）。`,
        { what: CORRUPT_PROJECT_INDEX }
      )
    }
  }

  private writeIndex(index: CreatorProjectIndex): void {
    mkdirSync(this.indexDirectory, { recursive: true })
    const temporaryPath = `${this.indexPath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, this.indexPath)
  }
}

/** 把任意抛出折成一句可读的诊断尾巴（原样保留底层说法，不改写）。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeDirectoryName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!sanitized || WINDOWS_RESERVED_NAME.test(sanitized)) {
    throw contractFailure(
      'eleckoi/input/invalid',
      `创建创作项目失败：name 归一化后为空或是 Windows 保留设备名（原始值 ${JSON.stringify(name)}）。`,
      { field: 'name' }
    )
  }
  return sanitized.slice(0, 80)
}
