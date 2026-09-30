import type { Context, Plugin } from '@deepseek-ai/cordis'
import { DESKTOP_ERROR_CODES, DesktopError } from '@shared/contracts/gateway/DesktopError'
import { CreatorProjectRepository } from './CreatorProjectRepository'

export const creatorStudioPlugin = {
  name: 'eleckoi-creator-studio',
  inject: ['appPaths', 'desktopGateway', 'characters'],
  provide: 'creatorProjects',
  apply(ctx: Context) {
    const projects = new CreatorProjectRepository(ctx.appPaths.workspace)
    ctx.provide('creatorProjects', projects)

    return [
      ctx.desktopGateway.register('query.creator_studio.projects.list', () => projects.list()),
      ctx.desktopGateway.register('command.creator_studio.projects.create', (input) => {
        const { sourceCharacterId, ...projectInput } = input
        const character = input.mode === 'existing'
          ? ctx.characters.get().items.find((item) => item.id === sourceCharacterId)
          : undefined
        if (input.mode === 'existing' && character === undefined) {
          throw new DesktopError(DESKTOP_ERROR_CODES.NOT_FOUND, '找不到要修改的角色。')
        }
        const saved = projects.create({
          ...projectInput,
          ...(sourceCharacterId === undefined ? {} : { sourceCharacterId }),
          coverImage: typeof character?.avatar === 'string' ? character.avatar : ''
        })
        ctx.desktopGateway.broadcast('records.changed', { module: 'creatorStudio' })
        return saved
      }),
      ctx.desktopGateway.register('command.creator_studio.projects.delete', ({ projectId }) => {
        const saved = projects.delete(projectId)
        ctx.desktopGateway.broadcast('records.changed', { module: 'creatorStudio' })
        return saved
      })
    ]
  }
} satisfies Plugin.Object
