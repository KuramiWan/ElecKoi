import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { initProfile, readProfileManifest, writeProfileBundles, writeProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'
import { ELECKOI_ANDROID_BUNDLES, registerAndroidMobileBundle } from '../src/androidPluginBundles'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true)
    rmSync(directory, { recursive: true, force: true })
  }
})
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'eleckoi-mobile-profile-'))
  directories.push(path)
  return path
}

describe('Android mobile surface profile registration', () => {
  it('adds the mobile surface to an existing profile without changing plugin order, dependencies or user patches', () => {
    const root = directory()
    const selected = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
      ...ELECKOI_ANDROID_BUNDLES.filter(name => name !== '@eleckoi/dsh-client-mobile'), '@test/navigation']
    initProfile(root, selected)
    const manifest = readProfileManifest('dsh', root)
    manifest.dependencies = { '@test/navigation': '1.0.0' }
    writeProfileManifest(root, manifest)
    const patch = '- id: synthetic-navigation\n  disabled: true\n'
    writeFileSync(join(root, 'cordis.patch.yml'), patch)
    registerAndroidMobileBundle(root)
    const updated = readProfileManifest('dsh', root)
    expect(updated.dsh?.profile?.bundles).toEqual([...selected, '@eleckoi/dsh-client-mobile'])
    expect(updated.dependencies).toEqual(manifest.dependencies)
    expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    registerAndroidMobileBundle(root)
    expect(readProfileManifest('dsh', root)).toEqual(updated)
    const withoutOptional = selected.filter(name => name !== '@eleckoi/dsh-web-search-tavily')
    writeProfileBundles(root, updated, withoutOptional)
    registerAndroidMobileBundle(root)
    expect(readProfileManifest('dsh', root).dsh?.profile?.bundles).toEqual([...withoutOptional, '@eleckoi/dsh-client-mobile'])
  })

  it('leaves a new profile with one mobile bundle and refuses to overwrite unreadable profile data', () => {
    const root = directory()
    initProfile(root, ELECKOI_ANDROID_BUNDLES)
    registerAndroidMobileBundle(root)
    expect(readProfileManifest('dsh', root).dsh?.profile?.bundles?.filter(name => name === '@eleckoi/dsh-client-mobile')).toHaveLength(1)
    const invalid = directory()
    writeFileSync(join(invalid, 'package.json'), '{invalid')
    expect(() => registerAndroidMobileBundle(invalid)).toThrow()
    expect(readFileSync(join(invalid, 'package.json'), 'utf8')).toBe('{invalid')
    expect(existsSync(join(invalid, '.eleckoi-android-mobile-bundle-v1'))).toBe(false)
  })
})
