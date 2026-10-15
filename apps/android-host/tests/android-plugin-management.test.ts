import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { initProfile, readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { PluginManager } from '@deepseek-ai/dsh-plugin-manager'
import { describe, expect, it } from 'vitest'

describe('Android required surface and optional bundle management', () => {
  it('protects the mobile surface while persisting an optional bundle off and on', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'eleckoi-plugin-management-'))
    const ctx = new Context()
    const mobile = '@eleckoi/dsh-client-mobile'
    const optional = '@eleckoi/dsh-web-search-tavily'
    try {
      initProfile(directory, [mobile, optional])
      ctx.reflect.provide('profileContext', { dir: directory, name: 'synthetic',
        installAnchor: resolve('apps/android-host/package.json'), startedBundles: [mobile, optional] })
      ctx.reflect.provide('loader', { entries: () => [] })
      await ctx.plugin(PluginManager)
      const packages = await ctx.pluginManager.listBundles()
      expect(packages.find(pkg => pkg.name === mobile)?.readOnlyReason).toBe('management-required')
      expect(packages.find(pkg => pkg.name === optional)?.readOnlyReason).toBeUndefined()
      const refused = await ctx.pluginManager.setBundleEnabled(mobile, false)
      expect(refused.changed).toBe(false)
      expect(refused.error?.code).toBe('management-required')
      expect(readProfileManifest('dsh', directory).dsh?.profile?.bundles).toContain(mobile)
      expect((await ctx.pluginManager.setBundleEnabled(optional, false)).changed).toBe(true)
      expect((await ctx.pluginManager.listBundles()).find(pkg => pkg.name === optional)?.enabled).toBe(false)
      expect(readProfileManifest('dsh', directory).dsh?.profile?.bundles).not.toContain(optional)
      expect((await ctx.pluginManager.setBundleEnabled(optional, true)).changed).toBe(true)
      expect(readProfileManifest('dsh', directory).dsh?.profile?.bundles).toEqual([mobile, optional])
    } finally {
      await ctx.fiber.dispose()
      expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
