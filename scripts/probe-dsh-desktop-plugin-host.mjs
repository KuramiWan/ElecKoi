import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { DshDesktopPluginHost } from '@eleckoi/dsh-runtime'

const require = createRequire(import.meta.url)
const root = mkdtempSync(join(tmpdir(), 'eleckoi-dsh-desktop-'))
const host = new DshDesktopPluginHost({
  runtimeDataRoot: root,
  workspaceRoot: join(root, 'workspace'),
  agentPatchPath: join(process.cwd(), 'resources', 'dsh', 'desktop-agent.patch.yml'),
  hostConfiguration: () => ({ credentials: {} }),
  executablePath: process.execPath,
  packageManager: {
    entryPath: join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'),
    nodeBinPath: join(process.cwd(), 'resources', 'dsh', 'node-bin')
  }
})

try {
  const ready = await host.start()
  const onboarding = ready.injections.find(row =>
    typeof row === 'object' && row !== null && row.kind === 'global' && row.name === '__DSH_MODELS_ONBOARDING__'
  )
  if (onboarding?.value?.credentialOnboarding !== false) {
    throw new Error('Embedded plugin center still enables automatic API-key onboarding')
  }
  const boot = ready.injections.find(row =>
    typeof row === 'object' && row !== null && row.kind === 'global' && row.name === '__DSH_BOOT__'
  )
  if (!boot?.value?.entries?.some(entry => entry.id === '@eleckoi/dsh-client-shell')) {
    throw new Error('ElecKoi client shell is missing from the DSH client module graph')
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-conversations')) {
    throw new Error('ElecKoi conversation model is missing from the DSH client module graph')
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-roleplay')) {
    throw new Error('ElecKoi roleplay view is missing from the DSH client module graph: '
      + boot.value.entries.filter(entry => entry.id?.includes('roleplay') || entry.id?.includes('eleckoi')).map(entry => entry.id).join(', '))
  }
  if (await host.dispose('probe-nonexistent-session') !== false) {
    throw new Error('ElecKoi roleplay Host session lifecycle returned an unexpected result')
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-characters')) {
    throw new Error('ElecKoi character model is missing from the DSH client module graph')
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-character-configuration')) {
    throw new Error('ElecKoi character configuration model is missing from the DSH client module graph')
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-models')) {
    throw new Error('ElecKoi model catalog is missing from the DSH client module graph')
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-persona')) {
    throw new Error('ElecKoi user profile model is missing from the DSH client module graph')
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-presets')) {
    throw new Error('ElecKoi preset model is missing from the DSH client module graph')
  }
  const handshake = await fetch(ready.url, { redirect: 'manual' })
  const cookie = handshake.headers.get('set-cookie')?.split(';', 1)[0]
  await handshake.body?.cancel()
  if (handshake.status !== 303 || !cookie) throw new Error('DSH plugin Host authentication failed')
  const response = await fetch(new URL('/', ready.url), { headers: { cookie } })
  if (!response.ok) throw new Error(`DSH plugin Host returned HTTP ${response.status}`)
  const document = await response.text()
  if (!document.includes('<html')) throw new Error('DSH client boot document was not served')
  process.stdout.write('DSH desktop plugin Host, client boot and onboarding configuration are available.\n')
} finally {
  await host.close()
  const absolute = resolve(root)
  if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('eleckoi-dsh-desktop-')) {
    throw new Error('Refusing to remove an unexpected probe directory')
  }
  rmSync(absolute, { recursive: true, force: true })
}
