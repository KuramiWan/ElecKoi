import { describe, expect, it, vi } from 'vitest'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'
import { configureGitHubApiUpdates, GitHubApiProvider } from '@main/modules/updates/GitHubApiProvider'

const API = 'https://api.github.com/repos/eleckoi/ElecKoi'
const REPOSITORY = 'https://github.com/eleckoi/ElecKoi'
const installer = (version: string) => `ElecKoi-${version}-x64-setup.exe`
function release(version: string, firstId: number) {
  const tag = `v${version}`
  return { tag_name: tag, html_url: `${REPOSITORY}/releases/tag/${tag}`, draft: false, prerelease: false,
    name: '合成发布', body: '合成更新说明', published_at: '2026-01-01T00:00:00Z',
    assets: ['latest.yml', installer(version), `${installer(version)}.blockmap`].map((name, index) => ({
      id: firstId + index, name, state: 'uploaded', url: `${API}/releases/assets/${firstId + index}`,
      browser_download_url: `${REPOSITORY}/releases/download/${tag}/${name}`
    })) }
}
const metadata = (version: string) => `version: ${version}\nfiles:\n  - url: ${installer(version)}\n    sha512: c3ludGhldGljLWhhc2g=\n    size: 1024\nreleaseDate: 2026-01-01T00:00:00Z\n`
function harness(current = release('1.2.3', 30), source = metadata('1.2.3')) {
  const request = vi.fn(async (options: { hostname: string; path: string; headers: Record<string, string> }) => {
    expect(options.hostname).toBe('api.github.com')
    if (options.path.endsWith('/releases/latest')) return JSON.stringify(current)
    if (options.path.endsWith('/releases/assets/30')) return source
    if (options.path.endsWith('/releases/tags/v1.2.2')) return JSON.stringify(release('1.2.2', 20))
    if (options.path.endsWith('/releases/assets/20')) return metadata('1.2.2')
    throw new Error(`Unexpected API request: ${options.path}`)
  })
  const provider = new GitHubApiProvider({}, {} as AppUpdater, { executor: { request }, platform: 'win32' } as unknown as ProviderRuntimeOptions)
  return { provider, request }
}
describe('public GitHub API updater provider', () => {
  it('uses the official custom-provider entry instead of a private token or provider mutation', () => {
    const updater = { setFeedURL: vi.fn() }
    configureGitHubApiUpdates(updater)
    expect(updater.setFeedURL).toHaveBeenCalledWith({ provider: 'custom', updateProvider: GitHubApiProvider })
  })
  it('reads the exact metadata asset and keeps installer checksums and release notes', async () => {
    const { provider, request } = harness()
    const info = await provider.getLatestVersion()
    expect(info).toMatchObject({ version: '1.2.3', releaseName: '合成发布', releaseNotes: '合成更新说明' })
    expect(request.mock.calls[0]![0].headers.Accept).toBe('application/vnd.github+json')
    expect(request.mock.calls[1]![0].headers.Accept).toBe('application/octet-stream')
    expect(provider.fileExtraDownloadHeaders.Accept).toBe('application/octet-stream')
    expect(provider.resolveFiles(info)).toEqual([{ url: new URL(`${API}/releases/assets/31`), info: info.files[0] }])
    expect(provider.resolveFiles(info)[0]!.info.sha512).toBe('c3ludGhldGljLWhhc2g=')
    expect(request.mock.calls.every(([options]) => !('authorization' in options.headers))).toBe(true)
  })
  it('resolves both differential blockmaps by exact API asset identities', async () => {
    const { provider } = harness()
    const info = await provider.getLatestVersion()
    const file = provider.resolveFiles(info)[0]!
    expect(await provider.getBlockMapFiles(file.url, '1.2.2', '1.2.3')).toEqual([
      new URL(`${API}/releases/assets/22`), new URL(`${API}/releases/assets/32`)
    ])
    await expect(provider.getBlockMapFiles(new URL(`${API}/releases/assets/999`), '1.2.2', '1.2.3')).rejects.toThrow('唯一确定')
  })
  it('rejects duplicate or cross-repository assets and mismatched metadata', async () => {
    const duplicate = release('1.2.3', 30)
    duplicate.assets.push({ ...duplicate.assets[0]!, id: 90, url: `${API}/releases/assets/90` })
    await expect(harness(duplicate).provider.getLatestVersion()).rejects.toThrow('唯一')
    const wrong = release('1.2.3', 30)
    wrong.assets[0]!.url = 'https://api.github.com/repos/example/other/releases/assets/30'
    await expect(harness(wrong).provider.getLatestVersion()).rejects.toThrow('地址无效')
    await expect(harness(undefined, metadata('1.2.4')).provider.getLatestVersion()).rejects.toThrow('发布标签')
    const { provider } = harness()
    await provider.getLatestVersion()
    expect(() => provider.resolveFiles({ version: '9.9.9' } as UpdateInfo)).toThrow('发布版本')
  })
  it('keeps unavailable metadata and transport failures as failures', async () => {
    const { provider, request } = harness()
    request.mockRejectedValueOnce(new Error('HTTP 403: API rate limit exceeded'))
    await expect(provider.getLatestVersion()).rejects.toThrow('API rate limit exceeded')
    await expect(harness(undefined, 'version: 1.2.3\nfiles: []\n').provider.getLatestVersion()).rejects.toThrow()
  })
})
