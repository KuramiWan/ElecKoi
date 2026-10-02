import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot'

export const ELECKOI_INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

export const ELECKOI_DESKTOP_BUNDLES = [
  '@eleckoi/dsh-client-characters',
  '@eleckoi/dsh-client-character-configuration',
  '@eleckoi/dsh-client-conversations',
  '@eleckoi/dsh-client-creator-studio',
  '@eleckoi/dsh-client-display-preferences',
  '@eleckoi/dsh-client-models',
  '@eleckoi/dsh-client-persona',
  '@eleckoi/dsh-client-presets',
  '@eleckoi/dsh-client-web-search',
  '@eleckoi/dsh-client-shell',
  '@eleckoi/dsh-client-roleplay',
  '@eleckoi/dsh-product-api',
  '@eleckoi/dsh-runtime'
] as const

/** Register shipped bundles once while retaining the profile's existing selections. */
export function registerDesktopBundles(profile: string): void {
  const marker = join(profile, '.eleckoi-desktop-bundles-v5')
  if (existsSync(marker)) return
  const manifest = readProfileManifest('dsh', profile)
  const selected = manifest.dsh?.profile?.bundles ?? []
  const bundles = [...new Set([...selected, ...ELECKOI_DESKTOP_BUNDLES])]
  writeProfileBundles(profile, manifest, bundles)
  writeFileSync(marker, 'initialized\n', { flag: 'wx' })
}
