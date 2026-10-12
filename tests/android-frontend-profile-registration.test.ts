import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { initProfile, readProfileManifest, writeProfileBundles, writeProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'
import { ELECKOI_ANDROID_BUNDLES, registerAndroidFrontendBundles } from '../apps/android-host/src/androidPluginBundles'

const frontend = ['@eleckoi/dsh-client-html-resources', '@eleckoi/dsh-client-author']
const directories: string[] = []
const marker = '.eleckoi-android-frontend-bundles-v3'
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'eleckoi-android-frontend-'))
  directories.push(path)
  return path
}
afterEach(() => {
  for (const path of directories.splice(0)) {
    expect(resolve(path).startsWith(resolve(tmpdir()) + sep)).toBe(true)
    rmSync(path, { recursive: true, force: true })
  }
})

describe('Android shared frontend profile upgrade', () => {
  it('adds the missing frontend and author bundles to an initialized profile while preserving user configuration', () => {
    const root = directory()
    const selected = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
      ...ELECKOI_ANDROID_BUNDLES.filter(name => !frontend.includes(name) && name !== '@eleckoi/dsh-web-search-tavily'), '@test/navigation']
    initProfile(root, selected)
    // Official initialization deliberately leaves an existing profile unchanged.
    initProfile(root, ELECKOI_ANDROID_BUNDLES)
    expect(readProfileManifest('dsh', root).dsh?.profile?.bundles).toEqual(selected)
    const manifest = readProfileManifest('dsh', root)
    manifest.dependencies = { '@test/navigation': '1.0.0' }
    writeProfileManifest(root, manifest)
    const patch = '- id: synthetic-navigation\n  disabled: true\n'
    writeFileSync(join(root, 'cordis.patch.yml'), patch)

    registerAndroidFrontendBundles(root)
    const updated = readProfileManifest('dsh', root)
    expect(updated.dsh?.profile?.bundles).toEqual([...selected, ...frontend])
    expect(updated.dependencies).toEqual(manifest.dependencies)
    expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    expect(existsSync(join(root, marker))).toBe(true)
    registerAndroidFrontendBundles(root)
    expect(readProfileManifest('dsh', root)).toEqual(updated)

    const laterSelection = updated.dsh!.profile!.bundles!.filter(name => !frontend.includes(name))
    writeProfileBundles(root, updated, laterSelection)
    registerAndroidFrontendBundles(root)
    expect(readProfileManifest('dsh', root).dsh?.profile?.bundles).toEqual(laterSelection)
  })

  it('registers the author runtime after the previous upgrade without re-enabling user-disabled bundles', () => {
    const root = directory()
    const selected = ['@deepseek-ai/dsh-base', '@eleckoi/dsh-client-html-resources', '@test/navigation']
    initProfile(root, selected)
    writeFileSync(join(root, '.eleckoi-android-frontend-bundles-v1'), 'initialized\n')
    registerAndroidFrontendBundles(root)
    const updated = readProfileManifest('dsh', root)
    expect(updated.dsh?.profile?.bundles).toEqual([...selected, '@eleckoi/dsh-client-author'])
    expect(existsSync(join(root, marker))).toBe(true)
    writeProfileBundles(root, updated, selected)
    registerAndroidFrontendBundles(root)
    expect(readProfileManifest('dsh', root).dsh?.profile?.bundles).toEqual(selected)
  })

  it.each([true, false])('replaces retired resources once while respecting their enabled state: %s', enabled => {
    const root = directory()
    const retired = ['@eleckoi/dsh-client-tavern-shared', '@eleckoi/dsh-compatibility-host']
    const selected = ['@deepseek-ai/dsh-base', ...retired.slice(0, enabled ? 2 : 1), '@test/navigation']
    initProfile(root, selected)
    for (const version of [1, 2]) writeFileSync(join(root, `.eleckoi-android-frontend-bundles-v${version}`), 'initialized\n')
    const patch = '- id: synthetic-navigation\n  disabled: true\n'
    writeFileSync(join(root, 'cordis.patch.yml'), patch)
    registerAndroidFrontendBundles(root)
    const expected = ['@deepseek-ai/dsh-base', ...(enabled ? [frontend[0]!] : []), '@test/navigation']
    expect(readProfileManifest('dsh', root).dsh?.profile?.bundles).toEqual(expected)
    expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    const disabled = expected.filter(name => name !== frontend[0])
    writeProfileBundles(root, readProfileManifest('dsh', root), disabled)
    registerAndroidFrontendBundles(root)
    expect(readProfileManifest('dsh', root).dsh?.profile?.bundles).toEqual(disabled)
  })

  it.each([{ present: [] }, { present: [frontend[0]!] }, { present: frontend }])('registers a partially upgraded profile without duplicate bundles: %j', ({ present }) => {
    const root = directory()
    const selected = ['@deepseek-ai/dsh-base', ...present]
    initProfile(root, selected)
    registerAndroidFrontendBundles(root)
    const upgraded = readProfileManifest('dsh', root).dsh?.profile?.bundles
    expect(upgraded).toEqual([...selected, ...frontend.filter(name => !present.includes(name))])
    for (const name of frontend) expect(upgraded?.filter(value => value === name)).toHaveLength(1)
  })

  it('retains malformed profile data and does not mark a failed upgrade complete', () => {
    const root = directory()
    writeFileSync(join(root, 'package.json'), '{invalid')
    expect(() => registerAndroidFrontendBundles(root)).toThrow()
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe('{invalid')
    expect(existsSync(join(root, marker))).toBe(false)
  })
})
