import type { AuthorAudioChannel, AuthorAudioState, AuthorAudioTrackInput, ElecKoiAuthorApi } from '@eleckoi/author-sdk'
import { fields, record, FrontendCompatibilityError } from './common'

export function createAudioFunctions(sdk: ElecKoiAuthorApi, runtime: {
  requireCapability(method: string): void; state(channel: AuthorAudioChannel): AuthorAudioState
  accept(state: AuthorAudioState): void; write<T>(operation: () => Promise<T>): Promise<T>; track(operation: Promise<unknown>): void
  baseUrl: string
}) {
  const channel = (type: string): AuthorAudioChannel => {
    if (!['bgm', 'ambient'].includes(type)) throw new TypeError('兼容音频频道只能是 bgm 或 ambient。')
    return type as AuthorAudioChannel
  }
  const track = (value: unknown): AuthorAudioTrackInput & { url: string; name: string } => {
    const item = record(value, '音频'); fields(item, ['url', 'title'], '音频')
    if (typeof item.url !== 'string' || !item.url) throw new TypeError('音频 URL 不能为空。')
    if (item.title !== undefined && typeof item.title !== 'string') throw new TypeError('音频标题必须是文本。')
    const url = new URL(item.url, runtime.baseUrl)
    const name = item.title as string | undefined ?? decodeURIComponent(url.pathname.split('/').at(-1) || url.hostname)
    return { url: item.url, name }
  }
  const save = (type: string, operation: (state: AuthorAudioState) => Promise<AuthorAudioState>): void => {
    const key = channel(type); runtime.requireCapability('audio.getState')
    runtime.track(runtime.write(async () => {
      const owner = await sdk.context.current(), state = await sdk.audio.getState(key)
      if ((await sdk.context.current()).conversationId !== owner.conversationId) throw new FrontendCompatibilityError('CONTEXT_CHANGED', '音频操作期间聊天已切换。')
      runtime.accept(await operation(state))
    }))
  }
  return {
    getAudioList(type: string) {
      runtime.requireCapability('audio.getState')
      return runtime.state(channel(type)).playlist.map(item => ({ title: item.name, url: item.url }))
    },
    getCurrentAudio(type: string) {
      runtime.requireCapability('audio.getState')
      const state = runtime.state(channel(type))
      if (state.currentTrack && (state.duration === null || state.duration <= 0)) throw new FrontendCompatibilityError('AUDIO_NOT_READY', '音频时长尚未就绪，无法返回准确进度。')
      return { src: state.currentTrack?.url || '', title: state.currentTrack?.name || '', playing: state.status === 'playing',
        progress: state.currentTrack ? Math.min(100, state.currentTime / state.duration! * 100) : 0 }
    },
    pauseAudio(type: string): void {
      runtime.requireCapability('audio.pause')
      save(type, () => sdk.audio.pause(channel(type)))
    },
    playAudio(type: string, value: unknown): void {
      runtime.requireCapability('audio.setPlaylist')
      const item = track(value)
      save(type, state => {
        const matches = state.playlist.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.url === item.url || entry.name === item.name)
        if (matches.length > 1) throw new FrontendCompatibilityError('AMBIGUOUS_AUDIO', '音频标题与 URL 对应多个现有曲目。')
        const currentIndex = matches[0]?.index ?? state.playlist.length
        const playlist = matches.length ? state.playlist : [...state.playlist, item]
        return sdk.audio.setPlaylist(channel(type), playlist, { currentIndex, autoplay: true, loop: state.loop, shuffle: state.shuffle })
      })
    },
    replaceAudioList(type: string, values: unknown[]): void {
      runtime.requireCapability('audio.setPlaylist')
      if (!Array.isArray(values)) throw new TypeError('音频列表必须是数组。')
      const items = values.map(track)
      save(type, () => sdk.audio.setPlaylist(channel(type), items))
    },
    appendAudioList(type: string, values: unknown[]): void {
      runtime.requireCapability('audio.appendPlaylist')
      if (!Array.isArray(values)) throw new TypeError('音频列表必须是数组。')
      const items = values.map(track)
      save(type, async state => {
        const titles = new Set(state.playlist.map(item => item.name)), urls = new Set(state.playlist.map(item => item.url))
        const additions = items.filter(item => {
          if (titles.has(item.name) || urls.has(item.url)) return false
          titles.add(item.name); urls.add(item.url); return true
        })
        return additions.length ? sdk.audio.appendPlaylist(channel(type), additions) : state
      })
    },
  }
}
