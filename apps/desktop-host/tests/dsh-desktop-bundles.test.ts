import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProfile, loadProfileDirectory, OPTIONAL_BUNDLES, PROFILE_TEMPLATES, readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'
import { ELECKOI_DESKTOP_BUNDLES, ELECKOI_INSTALL_ANCHOR, registerDesktopBundles } from '@eleckoi/desktop-host'

describe('desktop bundle registration', () => {
  it.each([true, false])('replaces the retired HTML resource pair without re-enabling disabled bundles: %s', enabled => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-html-upgrade-'))
    try {
      const old = ['@eleckoi/dsh-client-tavern-shared', '@eleckoi/dsh-compatibility-host']
      const selected = [...PROFILE_TEMPLATES.web!.bundles, ...old.slice(0, enabled ? 2 : 1), '@test/navigation']
      initProfile(root, selected)
      writeFileSync(join(root, '.eleckoi-desktop-bundles-v7'), 'initialized\n')
      const patch = '- id: synthetic-navigation\n  disabled: true\n'
      writeFileSync(join(root, 'cordis.patch.yml'), patch)
      registerDesktopBundles(root)
      const expected = [...PROFILE_TEMPLATES.web!.bundles,
        ...(enabled ? ['@eleckoi/dsh-client-html-resources'] : []), '@test/navigation']
      expect(readProfileManifest('dsh', root).dsh?.profile?.bundles).toEqual(expected)
      expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toBe(patch)
      const disabled = expected.filter(name => name !== '@eleckoi/dsh-client-html-resources')
      writeProfileBundles(root, readProfileManifest('dsh', root), disabled)
      registerDesktopBundles(root)
      expect(readProfileManifest('dsh', root).dsh?.profile?.bundles).toEqual(disabled)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('ships every official optional bundle with the locked version and leaves activation to the user', () => {
    const runtime = JSON.parse(readFileSync('packages/host/runtime/package.json', 'utf8'))
    const desktop = JSON.parse(readFileSync('package.json', 'utf8'))
    for (const name of OPTIONAL_BUNDLES) {
      expect(runtime.dependencies[name]).toBe('0.2.0-rc.2')
      expect(desktop.dependencies[name]).toBe(runtime.dependencies[name])
    }
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-optional-bundles-'))
    try {
      initProfile(root, PROFILE_TEMPLATES.web!.bundles)
      registerDesktopBundles(root)
      const manifest = readProfileManifest('dsh', root)
      const selected = manifest.dsh!.profile!.bundles!
      expect(selected.filter(name => OPTIONAL_BUNDLES.includes(name))).toEqual([])
      writeProfileBundles(root, manifest, [...selected, ...OPTIONAL_BUNDLES])
      const profile = loadProfileDirectory('dsh', root, ELECKOI_INSTALL_ANCHOR)
      expect(profile.skippedBundles).toEqual([])
      expect(profile.layers.map(layer => layer.packageName)).toEqual(expect.arrayContaining([...OPTIONAL_BUNDLES]))
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
  it('registers core bundles once and preserves existing selections and user patches', () => {
    const root = mkdtempSync(join(tmpdir(), 'eleckoi-bundle-test-'))
    try {
      initProfile(root, [...PROFILE_TEMPLATES.web!.bundles, '@eleckoi/dsh-client-roleplay', '@eleckoi/dsh-web-search-tavily'])
      const patch = '- id: web-search-tavily\n  disabled: true\n'
      writeFileSync(join(root, 'cordis.patch.yml'), patch)
      registerDesktopBundles(root)
      const manifest = readProfileManifest('dsh', root)
      const selected = manifest.dsh!.profile!.bundles!
      expect(new Set(selected).size).toBe(selected.length)
      expect(selected).toEqual(expect.arrayContaining([...ELECKOI_DESKTOP_BUNDLES]))
      expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toBe(patch)
      const profile = loadProfileDirectory('dsh', root, ELECKOI_INSTALL_ANCHOR)
      expect(profile.skippedBundles).toEqual([])
      expect(profile.layers.map(layer => layer.packageName)).toEqual(expect.arrayContaining([...ELECKOI_DESKTOP_BUNDLES]))
      writeProfileBundles(root, manifest, selected.filter(name => name !== '@eleckoi/dsh-web-search-tavily'))
      registerDesktopBundles(root)
      expect(readProfileManifest('dsh', root).dsh!.profile!.bundles).not.toContain('@eleckoi/dsh-web-search-tavily')
      expect(readFileSync(join(root, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
})
