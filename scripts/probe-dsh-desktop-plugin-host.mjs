import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { initProfile, PROFILE_TEMPLATES, readProfileManifest, writeProfileBundles } from '@deepseek-ai/dsh-app-boot'
import { DshDesktopPluginHost, ELECKOI_DESKTOP_BUNDLES } from '@eleckoi/desktop-host'

const require = createRequire(import.meta.url)
const root = mkdtempSync(join(tmpdir(), 'eleckoi-dsh-desktop-'))
const profilePath = join(root, 'home', 'profiles', 'desktop')
mkdirSync(join(root, 'session-snapshots'))
writeFileSync(join(root, 'session-snapshots', 'orphan-session.json'),
  JSON.stringify({ mountedPresetId: 'deleted-preset' }))
writeFileSync(join(root, 'session-snapshots', 'unused-snapshot.json'), '{')
const tavilyBundle = '@eleckoi/dsh-web-search-tavily'
initProfile(profilePath, [...PROFILE_TEMPLATES.web.bundles, '@eleckoi/dsh-client-roleplay'])
const hostOptions = {
  runtimeDataRoot: root,
  workspaceRoot: join(root, 'workspace'),
  productDatabasePath: join(root, 'product.sqlite'),
  productMediaRoot: join(root, 'media'),
  presetTemplatePath: resolve('apps/desktop/resources/dsh/agent-preset-template/agent.cordis.yml'),
  agentPatchPath: join(process.cwd(), 'apps', 'desktop', 'resources', 'dsh', 'desktop-agent.patch.yml'),
  executablePath: process.execPath,
  packageManager: {
    entryPath: join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'),
    nodeBinPath: join(process.cwd(), 'apps', 'desktop', 'resources', 'dsh', 'node-bin')
  }
}
const host = new DshDesktopPluginHost(hostOptions)
let reopened

async function remoteCall(ready, cookie, method, args) {
  const response = await fetch(new URL(`/api/${method}`, ready.url), {
    method: 'POST', headers: { cookie, origin: new URL(ready.url).origin,
      'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'eleckoi-probe', method, payload: { args } }),
  })
  const result = (await response.json()).result
  if (!response.ok || result.ok === false) throw new Error(`${method}: ${JSON.stringify(result)}`)
  return result.value ?? result
}

try {
  const ready = await host.start()
  const profile = readProfileManifest('dsh', profilePath)
  for (const name of ELECKOI_DESKTOP_BUNDLES) {
    if (!profile.dsh?.profile?.bundles?.includes(name)) throw new Error(`Desktop profile is missing ${name}`)
  }
  if (new Set(profile.dsh.profile.bundles).size !== profile.dsh.profile.bundles.length) {
    throw new Error('Desktop profile contains duplicate bundles')
  }
  if (!profile.dsh?.profile?.bundles?.includes(tavilyBundle)) {
    throw new Error('ElecKoi Tavily bundle is missing from the desktop DSH profile')
  }
  const onboarding = ready.injections.find(row =>
    typeof row === 'object' && row !== null && row.kind === 'global' && row.name === '__DSH_MODELS_ONBOARDING__'
  )
  if (onboarding) {
    throw new Error('Embedded DSH model settings remain enabled beside ElecKoi model management')
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
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-creator-studio')) {
    throw new Error('ElecKoi creator studio model is missing from the DSH client module graph')
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-client-roleplay')) {
    throw new Error('ElecKoi roleplay view is missing from the DSH client module graph: '
      + boot.value.entries.filter(entry => entry.id?.includes('roleplay') || entry.id?.includes('eleckoi')).map(entry => entry.id).join(', '))
  }
  if (!boot.value.entries.some(entry => entry.id === '@eleckoi/dsh-product-api')) {
    throw new Error('ElecKoi DSH Remote Client assembly is missing from the module graph')
  }
  if (await host.updateTasks('inspect') !== false) {
    throw new Error('ElecKoi DSH Host reported unexpected active tasks')
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
  await remoteCall(ready, cookie, 'eleckoiConversations/list', {})
  await remoteCall(ready, cookie, 'eleckoiCharacters/list', {})
  const created = await remoteCall(ready, cookie, 'eleckoiConversations/create', { input: { title: 'Example chat' } })
  const conversationId = created.conversation.id
  const selected = await remoteCall(ready, cookie, 'eleckoiConversationModels/current', { conversationId })
  await host.close()
  writeProfileBundles(profilePath, profile, profile.dsh.profile.bundles.filter(name => name !== tavilyBundle))
  reopened = new DshDesktopPluginHost(hostOptions)
  const restored = await reopened.start()
  const restoredHandshake = await fetch(restored.url, { redirect: 'manual' })
  const restoredCookie = restoredHandshake.headers.get('set-cookie')?.split(';', 1)[0]
  await restoredHandshake.body?.cancel()
  if (!restoredCookie) throw new Error('Reopened Host authentication failed')
  const current = await remoteCall(restored, restoredCookie, 'eleckoiConversationModels/current', { conversationId })
  if (current.provider !== selected.provider || current.model !== selected.model) throw new Error('Cold Session model selection changed')
  await remoteCall(restored, restoredCookie, 'eleckoiConversationModels/select', { conversationId, selection: selected })
  if (readProfileManifest('dsh', profilePath).dsh?.profile?.bundles?.includes(tavilyBundle)) {
    throw new Error('ElecKoi re-enabled the Tavily bundle after the user disabled it')
  }
  process.stdout.write('DSH desktop plugin Host, client boot and cold Session model selection passed across Host restart.\n')
} finally {
  await reopened?.close()
  await host.close()
  const absolute = resolve(root)
  if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('eleckoi-dsh-desktop-')) {
    throw new Error('Refusing to remove an unexpected probe directory')
  }
  rmSync(absolute, { recursive: true, force: true })
}
