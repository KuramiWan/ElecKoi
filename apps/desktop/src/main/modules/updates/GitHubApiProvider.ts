import { z } from 'zod'
import type { AppUpdater, ResolvedUpdateFileInfo, UpdateInfo } from 'electron-updater'
import {
  Provider, getFileList, parseUpdateInfo, type ProviderRuntimeOptions
} from 'electron-updater/out/providers/Provider'

const API = 'https://api.github.com/repos/eleckoi/ElecKoi'
const REPOSITORY = 'https://github.com/eleckoi/ElecKoi'
const API_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
const ASSET_HEADERS = { ...API_HEADERS, Accept: 'application/octet-stream' }
const releaseSchema = z.object({
  tag_name: z.string().min(1), html_url: z.string().url(),
  draft: z.literal(false), prerelease: z.literal(false),
  name: z.string().nullable(), body: z.string().nullable(), published_at: z.string(),
  assets: z.array(z.object({
    id: z.number().int().positive().safe(), name: z.string().min(1),
    state: z.string(), url: z.string().url(), browser_download_url: z.string().url()
  }))
})
type Release = z.infer<typeof releaseSchema>

/** Resolves public releases and their exact assets through GitHub's REST API. */
export class GitHubApiProvider extends Provider<UpdateInfo> {
  private release: Release | null = null

  constructor(_options: unknown, _updater: AppUpdater, runtime: ProviderRuntimeOptions) {
    super({ ...runtime, isUseMultipleRangeRequest: false })
  }

  get fileExtraDownloadHeaders(): typeof ASSET_HEADERS { return ASSET_HEADERS }

  async getLatestVersion(): Promise<UpdateInfo> {
    const release = await this.readRelease(`${API}/releases/latest`)
    const info = await this.readUpdateInfo(release)
    this.release = release
    return {
      ...info,
      releaseName: info.releaseName ?? release.name ?? release.tag_name,
      releaseNotes: info.releaseNotes ?? release.body,
      releaseDate: info.releaseDate ?? release.published_at
    }
  }

  resolveFiles(info: UpdateInfo): ResolvedUpdateFileInfo[] {
    const release = this.release
    if (!release || release.tag_name !== `v${info.version}`) throw new Error('更新信息与发布版本不一致。')
    const file = this.installer(info)
    return [{ url: this.assetUrl(release, file.url), info: file }]
  }

  async getBlockMapFiles(url: URL, oldVersion: string, newVersion: string): Promise<URL[]> {
    const release = this.release
    if (!release || release.tag_name !== `v${newVersion}`) throw new Error('增量更新与发布版本不一致。')
    const matching = release.assets.filter(asset => asset.url === url.href)
    const asset = matching[0]
    if (matching.length !== 1 || !asset) throw new Error('无法唯一确定增量更新的安装包。')
    const newMap = this.assetUrl(release, `${asset.name}.blockmap`)
    const oldRelease = await this.readRelease(`${API}/releases/tags/${encodeURIComponent(`v${oldVersion}`)}`)
    const oldInfo = await this.readUpdateInfo(oldRelease)
    if (oldInfo.version !== oldVersion) throw new Error('旧版本增量更新信息不一致。')
    return [this.assetUrl(oldRelease, `${this.installer(oldInfo).url}.blockmap`), newMap]
  }

  private async readRelease(url: string): Promise<Release> {
    const raw = await this.httpRequest(new URL(url), API_HEADERS)
    if (raw === null) throw new Error('GitHub 更新发布响应为空。')
    const release = releaseSchema.parse(JSON.parse(raw))
    if (release.html_url !== `${REPOSITORY}/releases/tag/${encodeURIComponent(release.tag_name)}`) {
      throw new Error('更新发布不属于 ElecKoi 仓库。')
    }
    return release
  }

  private async readUpdateInfo(release: Release): Promise<UpdateInfo> {
    const url = this.assetUrl(release, 'latest.yml')
    const info = parseUpdateInfo(await this.httpRequest(url, ASSET_HEADERS), 'latest.yml', url)
    if (!info || typeof info.version !== 'string' || release.tag_name !== `v${info.version}`) {
      throw new Error('更新描述与发布标签不一致。')
    }
    this.installer(info)
    return info
  }

  private installer(info: UpdateInfo): ReturnType<typeof getFileList>[number] {
    const files = getFileList(info)
    if (files.length !== 1 || ('packages' in info && info.packages != null)) throw new Error('Windows 更新必须声明唯一的完整安装包。')
    const file = files[0]
    if (!file || typeof file.url !== 'string' || !/^[^/\\]+\.exe$/i.test(file.url) || !file.sha512) {
      throw new Error('Windows 更新安装包标识或校验和无效。')
    }
    return file
  }

  private assetUrl(release: Release, name: string): URL {
    const matches = release.assets.filter(asset => asset.name === name)
    const asset = matches[0]
    if (matches.length !== 1 || !asset) throw new Error(`发布必须包含唯一的更新附件：${name}`)
    if (asset.state !== 'uploaded' || asset.url !== `${API}/releases/assets/${asset.id}`
      || asset.browser_download_url !== `${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(name)}`) {
      throw new Error(`更新附件的状态或地址无效：${name}`)
    }
    return new URL(asset.url)
  }
}

export function configureGitHubApiUpdates(updater: Pick<AppUpdater, 'setFeedURL'>): void {
  updater.setFeedURL({ provider: 'custom', updateProvider: GitHubApiProvider })
}
