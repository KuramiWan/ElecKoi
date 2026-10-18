import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CreatorProjectRepository } from '../src/domain/creatorStudio/CreatorProjectRepository'
import { ELECKOI_FAILURE_CODES } from '../../../shared/src/contracts/errors/codes'

let testRoot = ''

afterEach(() => {
  if (testRoot) rmSync(testRoot, { recursive: true, force: true })
  testRoot = ''
})

describe('CreatorProjectRepository', () => {
  it('creates a local project manifest and persists only its index in app workspace', () => {
    testRoot = mkdtempSync(join(tmpdir(), 'eleckoi-creator-projects-'))
    const appWorkspace = join(testRoot, 'app-workspace')
    const userProjects = join(testRoot, 'user-projects')
    mkdirSync(userProjects)
    const repository = new CreatorProjectRepository(appWorkspace)

    const collection = repository.create({
      name: '星港角色',
      mode: 'blank',
      parentDirectory: userProjects
    })

    expect(collection.items).toHaveLength(1)
    const project = collection.items[0]!
    expect(project.rootPath).toBe(join(userProjects, '星港角色'))
    expect(existsSync(join(project.rootPath, 'project.eleckoi.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(project.rootPath, 'project.eleckoi.json'), 'utf8'))).toMatchObject({
      schemaVersion: 1,
      kind: 'eleckoi-character-project',
      name: '星港角色',
      mode: 'blank'
    })
    expect(new CreatorProjectRepository(appWorkspace).list().items[0]?.id).toBe(project.id)
  })

  it('permanently deletes the local project directory and removes its workspace index entry', () => {
    testRoot = mkdtempSync(join(tmpdir(), 'eleckoi-creator-projects-'))
    const appWorkspace = join(testRoot, 'app-workspace')
    const userProjects = join(testRoot, 'user-projects')
    mkdirSync(userProjects)
    const repository = new CreatorProjectRepository(appWorkspace)
    const project = repository.create({
      name: '完整删除',
      mode: 'blank',
      parentDirectory: userProjects
    }).items[0]!

    writeFileSync(join(project.rootPath, '角色素材.txt'), 'content', 'utf8')

    expect(repository.delete(project.id).items).toHaveLength(0)
    expect(existsSync(project.rootPath)).toBe(false)
    expect(new CreatorProjectRepository(appWorkspace).list().items).toHaveLength(0)
  })

  it('refuses to delete a directory when its project manifest no longer matches the index', () => {
    testRoot = mkdtempSync(join(tmpdir(), 'eleckoi-creator-projects-'))
    const appWorkspace = join(testRoot, 'app-workspace')
    const userProjects = join(testRoot, 'user-projects')
    mkdirSync(userProjects)
    const repository = new CreatorProjectRepository(appWorkspace)
    const project = repository.create({
      name: '受保护项目',
      mode: 'blank',
      parentDirectory: userProjects
    }).items[0]!
    const manifestPath = join(project.rootPath, 'project.eleckoi.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, id: 'different-project' }), 'utf8')

    let failure: unknown
    try { repository.delete(project.id) } catch (error) { failure = error }
    // 清单与索引不符是本层最具体的失败（state/mismatch），不能被外层 catch 重包成通用 internal。
    expect(failure).toMatchObject({
      code: ELECKOI_FAILURE_CODES.stateMismatch,
      details: { what: '创作项目清单与索引记录' }
    })
    expect(existsSync(project.rootPath)).toBe(true)
  })
})
