import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import * as Cordis from '@deepseek-ai/cordis'
import * as React from 'react'
import { CordisInspectRegistryService } from '@deepseek-ai/dsh-cordis-host-runner'
import { afterEach, describe, expect, it } from 'vitest'
import { registerHostApiInspect } from '../packages/dsh-product-api/src/hostInspect'
import { registerClientApiInspect } from '../packages/dsh-product-api/src/client/inspect'
import { assertMembers } from '../scripts/generate-plugin-api-reference.mjs'

function clientRunnerModule() {
  let result: any
  runInNewContext(readFileSync(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-cordis-client-runner/client'), 'utf8'), {
    window: { __ModuleLoader__: { load: (entry: any) => {
      result = entry.factory((name: string) => {
        if (name === 'react') return React
        if (name === '@deepseek-ai/cordis') return Cordis
        throw new Error(`Unexpected Client dependency: ${name}`)
      })
    } } }, AbortController, AbortSignal, queueMicrotask, console
  })
  return result
}

const contexts: Cordis.Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const settle = () => new Promise<void>(resolve => setImmediate(resolve))

describe('公开插件接口的官方 Inspect 接入', () => {
  it('通过真实 Host 注册表查询完整设定字段，卸载后撤销目录', async () => {
    const ctx = new Cordis.Context()
    contexts.push(ctx)
    const registry = new CordisInspectRegistryService(ctx, 1000)
    const fiber = registerHostApiInspect(ctx)
    await fiber
    expect(registry.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: 'host', id: 'ElecKoi.Service' })
    ]))
    const result = await registry.query('host', 'ElecKoi.Service', 'api',
      { key: 'eleckoiCharacterConfigurationApi' }, {} as any, new AbortController().signal) as any
    expect(result.service.methods).toEqual(expect.arrayContaining([
      expect.objectContaining({ signature: expect.stringContaining('readSettingLibrary(characterId: string): SettingLibrary') })
    ]))
    const entry = result.referencedTypes.find((type: any) => type.name === 'SettingLibraryEntry')
    expect(entry.declaration).toContain('agentReadStrategy')
    expect(entry.declaration).toContain('triggerMode')
    expect(entry.declaration).toContain('position')
    await expect(registry.query('host', 'ElecKoi.Service', 'api', { key: 'eleckoiProductData' },
      {} as any, new AbortController().signal)).rejects.toThrow('no catalogued Service')
    await expect(registry.query('host', 'ElecKoi.Service', 'api', { key: 1 },
      {} as any, new AbortController().signal)).rejects.toThrow()
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(registry.query('host', 'ElecKoi.Service', 'api', {}, {} as any, cancelled.signal)).rejects.toThrow()
    await fiber.dispose()
    await fiber.dispose()
    expect(registry.list()).toEqual([])
  })

  it('通过真实 Client 注册表和 Host 路由查询 Remote 声明，停用后同步移除', async () => {
    const hostCtx = new Cordis.Context()
    const clientCtx = new Cordis.Context()
    contexts.push(clientCtx, hostCtx)
    const host = new CordisInspectRegistryService(hostCtx, 1000)
    const agent = { id: 'synthetic-session' } as any
    const { ClientCordisInspectRegistry } = clientRunnerModule()
    const client = new ClientCordisInspectRegistry({
      sync: async (manifest: any) => host.syncClientManifest(manifest),
      resolve: async (_sessionId: string, requestId: any, resolution: any) => {
        host.resolveClientQuery(agent, requestId, resolution)
      }
    })
    clientCtx.provide('cordisInspect', client)
    hostCtx.on('cordis/inspect-query', request => { void client.query(request) })
    hostCtx.on('cordis/inspect-query-resolved', request => client.close(request.requestId))
    const fiber = registerClientApiInspect(clientCtx)
    await fiber
    await settle()
    expect(host.list().filter(row => row.platform === 'client').map(row => row.id)).toEqual([
      'ElecKoi.Service', 'ElecKoi.Remote'
    ])
    const signal = new AbortController().signal
    const service = await host.query('client', 'ElecKoi.Service', 'api', { key: 'eleckoiConversations' }, agent, signal) as any
    expect(service.service.methods.some((method: any) => method.signature.includes('readAuthorState'))).toBe(true)
    const remote = await host.query('client', 'ElecKoi.Remote', 'api',
      { namespace: 'eleckoiCharacterConfiguration' }, agent, signal) as any
    expect(remote.access.expression).toBe('ctx.remote.eleckoiCharacterConfiguration')
    expect(remote.declaration).toContain('Promise<RemoteResult<SettingLibrary>>')
    expect(remote.declaration).toContain('RemoteStreamHandle<CharacterConfigurationChange, never>')
    expect(remote.referencedTypes.some((type: any) => type.name === 'SettingLibraryEntry')).toBe(true)
    await fiber.dispose()
    await settle()
    expect(host.list().filter(row => row.platform === 'client')).toEqual([])
  })

  it('查询注册表迟到时才注册；等待中停用不会留下目录', async () => {
    const ctx = new Cordis.Context()
    contexts.push(ctx)
    const waiting = registerHostApiInspect(ctx)
    await waiting.dispose()
    const registry = new CordisInspectRegistryService(ctx, 1000)
    await settle()
    expect(registry.list()).toEqual([])
    const late = registerHostApiInspect(ctx)
    await late
    expect(registry.list()).toHaveLength(1)
    await late.dispose()
    expect(registry.list()).toEqual([])
  })

  it('拒绝目录遗漏或声明不存在的成员', () => {
    expect(() => assertMembers('synthetic', ['read', 'save'], ['read'])).toThrow('未登记：save')
    expect(() => assertMembers('synthetic', ['read'], ['read', 'save'])).toThrow('缺少：save')
  })
})
