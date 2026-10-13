import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteDatabase } from '../packages/dsh-product-data/src/storage/sqlite/SqliteDatabase'
import { ConversationRepository } from '../packages/dsh-product-data/src/domain/conversations/ConversationRepository'
import { CreatorProjectRepository } from '../packages/dsh-product-data/src/domain/creatorStudio/CreatorProjectRepository'
import { CharacterRepository } from '../packages/dsh-product-data/src/domain/personas/CharacterRepository'
import { requireCharacter } from '../packages/dsh-product-data/src/domain/personas'
import { LocalMediaStore } from '@eleckoi/dsh-product-data/media'
import { RegexRuleRepository } from '../packages/dsh-product-data/src/domain/regexRules/RegexRuleRepository'
import { AgentPresetRepository } from '../packages/dsh-product-data/src/domain/agentPresets'
import { ELECKOI_FAILURE_CODES } from '../packages/product-shared/src/contracts/errors/codes'
import { DesktopError } from '../packages/product-shared/src/foundation/DesktopError'
import type { RegexRule } from '../packages/product-shared/src/contracts/regex/schemas'
import type {
  CreatorProject,
  CreatorProjectCollection
} from '../packages/product-shared/src/contracts/creatorStudio/schemas'

// 判据来源：ADR 0002 决定 14（4 处乐观并发吸收进 `eleckoi/conflict/stale-revision`）
// 与 `notes/eh-explore-sites.md` 表第 16–19 行。这张表**故意逐字重抄**，不从实现推导：
// 否则测试会跟着实现一起漂，漂了也看不出来。
const STALE_REVISION = {
  /** #16 `RegexRuleRepository.saveInTransaction`：角色自己的正则集合（`regexState.revision`）。 */
  characterRegexRulesSave: { what: 'character-regex-rules', action: '保存' },
  /** #17 同函数：角色正则绑定到的那个 Agent 预设（`presetId` 或它的正则 revision 变了）。 */
  activeAgentPreset: { what: 'active-agent-preset', action: '保存' },
  /** #18 `RegexRuleRepository.import`：同一个 `regexState.revision`，但走导入这条路。 */
  characterRegexRulesImport: { what: 'character-regex-rules', action: '导入' },
  /** #19 `AgentPresetRepository.save`：预设**自己**的正则规则相对 `expectedRegexRules` 过期。 */
  agentPresetRegexRules: { what: 'agent-preset-regex-rules', action: '保存' }
} as const

const databases: SqliteDatabase[] = []
const directories: string[] = []

afterEach(() => {
  databases.splice(0).forEach((database) => database.close())
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

function rule(patch: Partial<RegexRule> = {}): RegexRule {
  return {
    id: 'rule-a',
    name: '规则',
    pattern: '/hello/g',
    replacement: 'world',
    targets: ['AiOutput'],
    enabled: true,
    displayOnly: false,
    promptOnly: false,
    runOnEdit: false,
    order: 0,
    ...patch
  }
}

function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-failure-codes-'))
  directories.push(directory)
  const database = new SqliteDatabase(join(directory, 'data.sqlite3'))
  database.open()
  databases.push(database)
  const conversations = new ConversationRepository(database)
  const characters = new CharacterRepository(database, conversations, new LocalMediaStore(join(directory, 'media')))
  characters.replaceAll({
    active_character_id: 'card-a',
    groups: [],
    items: [{
      id: 'card-a',
      name: 'A',
      persona: { assistant_name: 'A', assistant_avatar: '', assistant_cover: '', opening: '', show_opening: false }
    }]
  })
  const agentPresets = new AgentPresetRepository(database)
  agentPresets.ensureInitialized()
  const repository = new RegexRuleRepository(database, agentPresets)
  return { agentPresets, database, repository }
}

/** 跑一次必然失败的调用，返回抛出的失败本身（调用方从**外面**观察码与详情）。 */
function failureOf(operation: () => unknown): DesktopError {
  try {
    operation()
  } catch (error) {
    if (error instanceof DesktopError) return error
    throw error
  }
  throw new Error('这次调用本该失败，却没有抛出 DesktopError。')
}

describe('领域失败的契约码：conflict/stale-revision', () => {
  it('保存角色正则时报告角色自己的正则集合过期，并带上期望与实际 revision', () => {
    const { repository } = harness()
    const loaded = repository.get('card-a')
    repository.save('card-a', { ...loaded, characterRules: [rule()] }, loaded.revision)
    const current = repository.get('card-a')

    const failure = failureOf(() => repository.save('card-a', { ...current, characterRules: [] }, loaded.revision))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.conflictStaleRevision)
    expect(failure.details).toStrictEqual({ what: STALE_REVISION.characterRegexRulesSave.what })
    // 详情只带对象；期望与实际 revision 进开发者诊断文案（ADR 决定 4）。
    expect(failure.message).toContain(`期望 revision ${loaded.revision}`)
    expect(failure.message).toContain(`当前 ${current.revision}`)
  })

  it('保存角色正则时报告绑定的 Agent 预设过期，与角色正则本身可区分', () => {
    const { agentPresets, repository } = harness()
    const loaded = repository.get('card-a')
    const next = agentPresets.create('预设 B')
    agentPresets.setActive(next.id)

    const failure = failureOf(() => repository.save('card-a', loaded, loaded.revision))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.conflictStaleRevision)
    expect(failure.details).toStrictEqual({ what: STALE_REVISION.activeAgentPreset.what })
    // 这是**另一个对象**的失败：详情与角色正则那条不同。
    expect(failure.details).not.toStrictEqual({ what: STALE_REVISION.characterRegexRulesSave.what })
    expect(failure.message).toContain(loaded.agentPresetId)
    expect(failure.message).toContain(next.id)
  })

  it('导入角色正则时报告同一个对象，但与保存那条的文案可区分', () => {
    const { repository } = harness()
    const loaded = repository.get('card-a')
    repository.save('card-a', { ...loaded, characterRules: [rule()] }, loaded.revision)
    const current = repository.get('card-a')

    const failure = failureOf(() => repository.import('card-a', 'Global', [], loaded.revision))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.conflictStaleRevision)
    expect(failure.details).toStrictEqual({ what: STALE_REVISION.characterRegexRulesImport.what })
    const saveFailure = failureOf(() => repository.save('card-a', current, loaded.revision))
    expect(failure.message).not.toBe(saveFailure.message)
  })

  it('保存预设自身正则时报告预设正则过期，与角色正则可区分', () => {
    const { agentPresets } = harness()
    const stale = agentPresets.active()
    agentPresets.save({ ...stale, regexRules: [rule({ id: 'external' })] })

    const failure = failureOf(() => agentPresets.save({ ...stale, name: '旧页面修改' }, stale.regexRules))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.conflictStaleRevision)
    expect(failure.details).toStrictEqual({ what: STALE_REVISION.agentPresetRegexRules.what })
    expect(failure.message).toContain(stale.id)
  })

  it('四条过期的 what 只落在三种对象上，没有一条是 legacy 码', () => {
    const objects = Object.values(STALE_REVISION).map((entry) => entry.what)
    expect(new Set(objects).size).toBe(3)
    // 四条的恢复动作按对象区分（角色正则 / 绑定的预设 / 预设自身正则），所以三条码值互不相同。
    expect([...new Set(objects)].sort()).toStrictEqual(['active-agent-preset', 'agent-preset-regex-rules', 'character-regex-rules'])
  })
})

/**
 * 创作项目仓储只用文件系统，不需要数据库（也绕开基线里那两处 better-sqlite3 原生崩溃）。
 * 判据来源：`notes/eh-explore-sites.md` 表第 3、8、9、10 行。
 */
function creatorHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'eleckoi-failure-codes-creator-'))
  directories.push(directory)
  const appWorkspace = join(directory, 'app-workspace')
  const parentDirectory = join(directory, 'user-projects')
  mkdirSync(parentDirectory)
  return { appWorkspace, repository: new CreatorProjectRepository(appWorkspace), parentDirectory }
}

/** 直接改工作区的 `creator-studio/projects.json`，造出领域入口自己造不出来的索引状态。 */
function rewriteIndex(appWorkspace: string, patch: (item: Record<string, unknown>) => Record<string, unknown>): void {
  const indexPath = join(appWorkspace, 'creator-studio', 'projects.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { version: number; items: Array<Record<string, unknown>> }
  writeFileSync(indexPath, JSON.stringify({ ...index, items: index.items.map(patch) }), 'utf8')
}

/** 取集合里的第一个项目；`noUncheckedIndexedAccess` 下不许用 `!`，所以在测试里显式判空。 */
function firstProject(collection: CreatorProjectCollection): CreatorProject {
  const project = collection.items[0]
  if (project === undefined) throw new Error('创建创作项目之后集合为空。')
  return project
}

describe('领域失败的契约码：creator-project', () => {
  it('目标目录已存在同名目录时报告 creator-project/name-taken 并带上那个目录', () => {
    const { repository, parentDirectory } = creatorHarness()
    const first = firstProject(repository.create({ name: '星港角色', mode: 'blank', parentDirectory }))

    const failure = failureOf(() => repository.create({ name: '星港角色', mode: 'blank', parentDirectory }))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.creatorProjectNameTaken)
    expect(failure.details).toStrictEqual({ path: first.rootPath })
  })

  it('请求不存在的创作项目时报告 creator-project/not-found 并带上请求的 id', () => {
    const { repository } = creatorHarness()
    const missing = 'no-such-project'

    const read = failureOf(() => repository.require(missing))
    expect(read.code).toBe(ELECKOI_FAILURE_CODES.creatorProjectNotFound)
    expect(read.details).toStrictEqual({ what: missing })

    const removed = failureOf(() => repository.delete(missing))
    expect(removed.code).toBe(ELECKOI_FAILURE_CODES.creatorProjectNotFound)
    expect(removed.details).toStrictEqual({ what: missing })
  })

  // 只用权限让 rmSync 真失败：清单仍读得到（读要父目录的 x），但删不掉目录里的条目（要父目录的 w）。
  // Windows 的只读属性不拦目录删除，所以这条在非 win32 上跑；本机（Linux）就是判据跑的地方。
  it.skipIf(process.platform === 'win32')('删除项目目录真的失败时报告 io/failed 并带上操作与路径', () => {
    const { repository, parentDirectory } = creatorHarness()
    const project = firstProject(repository.create({ name: '占用中', mode: 'blank', parentDirectory }))
    chmodSync(project.rootPath, 0o500)
    try {
      const failure = failureOf(() => repository.delete(project.id))

      expect(failure.code).toBe(ELECKOI_FAILURE_CODES.ioFailed)
      expect(failure.details).toStrictEqual({ operation: 'delete', path: project.rootPath })
    } finally {
      chmodSync(project.rootPath, 0o700)
    }
  })
})

describe('领域失败的契约码：input/invalid', () => {
  // :78 与 :182 两处按票的结论都归 input/invalid（`field = 'name'`），理由写在 EH-3.status.md。
  it('名称为空或全是空白时报告 input/invalid，字段是 name', () => {
    const { repository, parentDirectory } = creatorHarness()

    const failure = failureOf(() => repository.create({ name: '   ', mode: 'blank', parentDirectory }))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.inputInvalid)
    expect(failure.details).toStrictEqual({ field: 'name' })
  })

  it('mode 为 existing 却没给角色时报告 input/invalid，字段是 sourceCharacterId', () => {
    const { repository, parentDirectory } = creatorHarness()

    const failure = failureOf(() => repository.create({ name: '改角色', mode: 'existing', parentDirectory }))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.inputInvalid)
    expect(failure.details).toStrictEqual({ field: 'sourceCharacterId' })
  })

  it('名称归一化后是 Windows 保留设备名时报告 input/invalid，字段是 name', () => {
    const { repository, parentDirectory } = creatorHarness()

    const failure = failureOf(() => repository.create({ name: 'con', mode: 'blank', parentDirectory }))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.inputInvalid)
    expect(failure.details).toStrictEqual({ field: 'name' })
  })

  it('名称会离开选定的保存位置时报告 input/invalid，字段是 name（不是 safety/refused）', () => {
    const { repository, parentDirectory } = creatorHarness()

    // '..foo' 过得了 safeDirectoryName（去尾点只吃结尾的点），但相对路径以 '..' 开头。
    const failure = failureOf(() => repository.create({ name: '..foo', mode: 'blank', parentDirectory }))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.inputInvalid)
    expect(failure.details).toStrictEqual({ field: 'name' })
  })
})

describe('领域失败的契约码：safety/refused 与 storage/corrupt', () => {
  it('清单与索引不一致时报告 safety/refused，并拒绝动那个目录', () => {
    const { repository, parentDirectory } = creatorHarness()
    const project = firstProject(repository.create({ name: '受保护项目', mode: 'blank', parentDirectory }))
    const manifestPath = join(project.rootPath, 'project.eleckoi.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, id: 'different-project' }), 'utf8')

    const failure = failureOf(() => repository.delete(project.id))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.safetyRefused)
    expect(failure.details).toStrictEqual({ guard: 'creator-project-manifest-matches-index' })
    expect(existsSync(project.rootPath)).toBe(true)
  })

  it('清单读不出来时报告 storage/corrupt，与"清单和索引不一致"分得开', () => {
    const { repository, parentDirectory } = creatorHarness()
    const project = firstProject(repository.create({ name: '清单缺失', mode: 'blank', parentDirectory }))
    rmSync(join(project.rootPath, 'project.eleckoi.json'))

    const failure = failureOf(() => repository.delete(project.id))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.storageCorrupt)
    expect(failure.details).toStrictEqual({ what: 'creator-project-manifest' })
    expect(existsSync(project.rootPath)).toBe(true)
  })

  it('清单是合法 JSON 但不是对象时也报告 storage/corrupt', () => {
    const { repository, parentDirectory } = creatorHarness()
    const project = firstProject(repository.create({ name: '清单不是对象', mode: 'blank', parentDirectory }))
    writeFileSync(join(project.rootPath, 'project.eleckoi.json'), '[]', 'utf8')

    const failure = failureOf(() => repository.delete(project.id))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.storageCorrupt)
    expect(failure.details).toStrictEqual({ what: 'creator-project-manifest' })
  })

  it('索引读不出来时报告 storage/corrupt，what 指向索引', () => {
    const { appWorkspace, repository, parentDirectory } = creatorHarness()
    firstProject(repository.create({ name: '索引坏掉', mode: 'blank', parentDirectory }))
    writeFileSync(join(appWorkspace, 'creator-studio', 'projects.json'), '{ 不是 JSON', 'utf8')

    const failure = failureOf(() => repository.list())

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.storageCorrupt)
    expect(failure.details).toStrictEqual({ what: 'creator-project-index' })
  })

  it('索引条目的 rootPath 不是绝对路径时报告 safety/refused，并说是哪道护栏', () => {
    const { appWorkspace, repository, parentDirectory } = creatorHarness()
    const project = firstProject(repository.create({ name: '相对路径', mode: 'blank', parentDirectory }))
    rewriteIndex(appWorkspace, (item) => ({ ...item, rootPath: 'relative/project' }))

    const failure = failureOf(() => repository.delete(project.id))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.safetyRefused)
    expect(failure.details).toStrictEqual({ guard: 'creator-project-absolute-directory' })
  })

  it('索引条目的 rootPath 指向文件系统根时报告 safety/refused，并说是哪道护栏', () => {
    const { appWorkspace, repository, parentDirectory } = creatorHarness()
    const project = firstProject(repository.create({ name: '根目录', mode: 'blank', parentDirectory }))
    rewriteIndex(appWorkspace, (item) => ({ ...item, rootPath: parse(project.rootPath).root }))

    const failure = failureOf(() => repository.delete(project.id))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.safetyRefused)
    expect(failure.details).toStrictEqual({ guard: 'creator-project-not-filesystem-root' })
  })
})

/**
 * 两条 not-found 码在勘查时**零生产者**（这两个域抛的是裸 `Error`）——
 * ADR 0002 的实现订正 b 把"补上真正的抛出点"记进了 EH-3。
 * 判据来源：`notes/eh-explore-sites.md` §1.4（三个抛出点）与 ADR 决定 13。
 */
describe('领域失败的契约码：两个没有生产者的 not-found', () => {
  it('请求不存在的角色卡时报告 character/not-found 并带上请求的 id', () => {
    const { database } = harness()
    const missing = 'no-such-card'

    const failure = failureOf(() => requireCharacter(database.db, missing))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.characterNotFound)
    expect(failure.details).toStrictEqual({ what: missing })
  })

  it('读取不存在的 Agent 预设时报告 agent-preset/not-found 并带上请求的 id', () => {
    const { agentPresets } = harness()
    const missing = 'no-such-preset'

    const failure = failureOf(() => agentPresets.get(missing))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.agentPresetNotFound)
    expect(failure.details).toStrictEqual({ what: missing })
  })

  it('保存不存在的 Agent 预设时报告 agent-preset/not-found，与"读"是同一条码', () => {
    const { agentPresets } = harness()
    const missing = 'no-such-preset'

    const failure = failureOf(() => agentPresets.save({ ...agentPresets.active(), id: missing }))

    expect(failure.code).toBe(ELECKOI_FAILURE_CODES.agentPresetNotFound)
    expect(failure.details).toStrictEqual({ what: missing })
  })
})
