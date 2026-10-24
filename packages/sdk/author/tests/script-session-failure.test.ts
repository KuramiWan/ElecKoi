// @ts-expect-error The unit test runtime does not publish jsdom declarations.
import { JSDOM } from 'jsdom'
import { afterEach, expect, it } from 'vitest'
import { AuthorScriptSession, type AuthorScriptDescriptor, type AuthorScriptStatus } from '@eleckoi/author-sdk'

const pages: any[] = []
afterEach(() => { for (const page of pages.splice(0)) page.window.close() })

const script: AuthorScriptDescriptor = {
  key: 'synthetic-script',
  id: 'synthetic-script',
  name: '合成脚本',
  scope: 'character',
  ownerId: 'synthetic-owner',
  source: '',
  settings: {},
  librarySettings: {}
}

it('reports the message of a coded plain-object startup failure instead of object-object', async () => {
  const failure = {
    isDSHRemoteError: true,
    code: 'eleckoi/data/shape-invalid',
    message: '脚本启动失败：找不到入口',
    details: { what: '脚本入口' }
  }
  const statuses: AuthorScriptStatus[] = []
  const page = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
  pages.push(page)
  const session = new AuthorScriptSession({
    conversationId: 'synthetic-chat',
    scripts: [script],
    createFrame: () => ({ window: page.window, load: async () => { throw failure }, dispose() {} }),
    adapter: () => ({ request: async () => ({}), on: () => () => {} }),
    status: value => statuses.push(value)
  })
  await expect(session.start()).rejects.toBe(failure)
  expect(statuses.at(-1)).toMatchObject({ status: 'error', error: '脚本启动失败：找不到入口' })
  await session.close()
})
