import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAudioRuntime, nativeAudioMethods } from '@eleckoi/dsh-client-author/audio'
import type { AuthorAudioChannel, AuthorAudioState } from '@eleckoi/author-sdk'
import { NativeAudioElement } from './helpers/nativeAudioElement'

const runtimes: NativeAudioRuntime[] = []
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose() })
function harness(configure: (element: NativeAudioElement) => void = () => {}) {
  const elements: NativeAudioElement[] = [], events: any[] = [], report = vi.fn()
  const runtime = new NativeAudioRuntime({ createAudio() {
    const element = new NativeAudioElement(); configure(element); elements.push(element)
    return element as unknown as HTMLAudioElement
  }, emit: event => events.push(event), report, random: () => 0 })
  runtimes.push(runtime)
  const invoke = (method: string, params: Record<string, unknown> = {}, signal?: AbortSignal) => runtime.invoke('synthetic-chat', method, params, signal)
  const state = async (channel: AuthorAudioChannel = 'bgm') => await invoke('audio.getState', { channel }) as AuthorAudioState
  return { runtime, invoke, state, elements, events, report }
}
const track = (id: string) => ({ id, url: `https://example.com/${id}.wav`, metadata: { nested: { value: 1 } } })

describe('native Client audio', () => {
  it('connects all eleven commands and reads without constructing a player', async () => {
    const r = harness()
    expect(nativeAudioMethods).toHaveLength(11)
    expect(await r.state()).toMatchObject({ status: 'idle', currentIndex: -1, currentTrack: null, duration: null })
    expect(await r.invoke('audio.getPlaylist')).toEqual({ channel: 'bgm', items: [], currentIndex: -1 })
    expect(await r.runtime.invoke('', 'audio.getSettings')).toMatchObject({ masterVolume: 1, muted: false })
    expect(r.elements).toHaveLength(0)
    await expect(r.runtime.invoke('', 'audio.play', { track: track('synthetic-track') })).rejects.toMatchObject({ code: 'CHAT_NOT_READY' })
    await expect(r.invoke('audio.unknown')).rejects.toMatchObject({ code: 'METHOD_UNAVAILABLE' })
  })
  it('shares playback across callers, waits for actual play, pauses, resumes, seeks and stops while retaining the playlist', async () => {
    const r = harness(element => { element.deferredPlay = true })
    let finished = false
    const pending = r.invoke('audio.play', { track: track('synthetic-track'), startAt: 10 }).then(value => { finished = true; return value })
    await Promise.resolve()
    expect(finished).toBe(false); expect((await r.state()).status).toBe('loading')
    r.elements[0]!.startPlayback()
    expect(await pending).toMatchObject({ status: 'playing', currentTime: 10 })
    expect(await r.invoke('audio.pause')).toMatchObject({ status: 'paused' })
    const resumed = r.invoke('audio.resume'); r.elements[0]!.startPlayback()
    expect(await resumed).toMatchObject({ status: 'playing' })
    expect(await r.invoke('audio.seek', { seconds: 35 })).toMatchObject({ currentTime: 35 })
    expect(r.events.some(event => event.name === 'audio.time.updated')).toBe(true)
    expect(await r.invoke('audio.stop')).toMatchObject({ status: 'idle', currentTime: 0, currentTrack: { id: 'synthetic-track' } })
    expect(r.elements[0]!.src).toBe(''); expect(r.elements[0]!.listenerCount).toBe(0)
    const restarted = r.invoke('audio.resume'); r.elements[1]!.startPlayback()
    expect(await restarted).toMatchObject({ status: 'playing', currentTime: 0 })
  })
  it('plays four independent channels and multiplies track, channel and master volume', async () => {
    const r = harness()
    for (const channel of ['bgm', 'ambient', 'voice', 'sfx'] as const) {
      await r.invoke('audio.play', { channel, track: track(`synthetic-${channel}`), volume: 0.5 })
    }
    await r.invoke('audio.setSettings', { settings: { masterVolume: 0.5, channels: { ambient: { volume: 0.4 }, voice: { muted: true } } } })
    expect(r.elements.map(element => element.volume)).toEqual([0.25, 0.1, 0.25, 0.25])
    expect(r.elements.map(element => element.muted)).toEqual([false, false, true, false])
    await r.invoke('audio.pause', { channel: 'ambient' })
    expect((await r.state('ambient')).status).toBe('paused'); expect((await r.state('bgm')).status).toBe('playing')
    await r.invoke('audio.setSettings', { settings: { muted: true } })
    expect(r.elements.every(element => element.muted)).toBe(true)
  })
  it('keeps input metadata, returned state, playlist and settings isolated', async () => {
    const r = harness(), input = track('synthetic-track')
    await r.invoke('audio.play', { track: input })
    input.metadata.nested.value = 9
    const state = await r.state(); (state.playlist[0]!.metadata.nested as any).value = 10
    const playlist = await r.invoke('audio.getPlaylist') as any; playlist.items[0].metadata.nested.value = 11
    const settings = await r.invoke('audio.getSettings') as any; settings.channels.bgm.volume = 0
    expect((await r.state()).currentTrack!.metadata).toEqual({ nested: { value: 1 } })
    expect(await r.invoke('audio.getSettings')).toMatchObject({ channels: { bgm: { volume: 1 } } })
  })
  it('rejects invalid replacements and settings before modifying accepted playback', async () => {
    const r = harness()
    await r.invoke('audio.play', { track: track('synthetic-track') })
    for (const params of [{ track: '' }, { track: track('synthetic-other'), volume: 2 }, { track: track('synthetic-other'), loop: 'yes' }]) {
      await expect(r.invoke('audio.play', params)).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    }
    await expect(r.invoke('audio.setPlaylist', { items: [track('synthetic-other'), {}] })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(r.invoke('audio.setPlaylist', { items: [track('synthetic-other')], currentIndex: 1 })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(r.invoke('audio.seek', { seconds: -1 })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(r.invoke('audio.pause', { channel: 'unknown' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(r.invoke('audio.setSettings', { settings: { masterVolume: 0.5, channels: { voice: { volume: 2 } } } })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(r.invoke('audio.setSettings', { settings: { channels: { unknown: { muted: true } } } })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(await r.state()).toMatchObject({ status: 'playing', currentTrack: { id: 'synthetic-track' }, currentTime: 0 })
    expect(r.elements).toHaveLength(1); expect(r.elements[0]!.paused).toBe(false)
    expect(await r.invoke('audio.getSettings')).toMatchObject({ masterVolume: 1 })
  })
  it('represents unknown duration as null and clamps seek once metadata establishes the duration', async () => {
    const r = harness(element => { element.duration = NaN })
    await r.invoke('audio.play', { track: track('synthetic-track'), startAt: 200 })
    expect(await r.state()).toMatchObject({ currentTime: 200, duration: null })
    r.elements[0]!.duration = 120; r.elements[0]!.emit('loadedmetadata')
    expect(await r.state()).toMatchObject({ currentTime: 120, duration: 120 })
    expect(await r.invoke('audio.seek', { seconds: 500 })).toMatchObject({ currentTime: 120 })
  })
  it('appends valid tracks, advances sequentially, ends at the last track and handles an empty playlist', async () => {
    const r = harness()
    await r.invoke('audio.setPlaylist', { channel: 'ambient', items: [track('synthetic-first')], autoplay: true })
    await r.invoke('audio.appendPlaylist', { channel: 'ambient', items: [track('synthetic-second')] })
    r.elements[0]!.emit('ended')
    await vi.waitFor(async () => expect(await r.state('ambient')).toMatchObject({ status: 'playing', currentTrack: { id: 'synthetic-second' } }))
    r.elements[1]!.emit('ended'); await Promise.resolve()
    expect(await r.state('ambient')).toMatchObject({ status: 'ended', currentIndex: 1 })
    expect(r.elements).toHaveLength(2); expect(r.elements[0]!.listenerCount).toBe(0)
    await r.invoke('audio.setPlaylist', { channel: 'ambient', items: [] })
    expect(await r.state('ambient')).toMatchObject({ status: 'idle', currentTrack: null, currentIndex: -1 })
    await expect(r.invoke('audio.resume', { channel: 'ambient' })).rejects.toMatchObject({ code: 'AUDIO_EMPTY' })
    await r.invoke('audio.appendPlaylist', { channel: 'ambient', items: [track('synthetic-third')] })
    expect(await r.state('ambient')).toMatchObject({ status: 'paused', currentIndex: 0 })
  })
  it('loops a single track and shuffles a finite playlist without repeating in the same cycle', async () => {
    const r = harness()
    await r.invoke('audio.play', { track: track('synthetic-loop'), loop: true })
    r.elements[0]!.emit('ended')
    await vi.waitFor(async () => expect(await r.state()).toMatchObject({ status: 'playing', currentTrack: { id: 'synthetic-loop' } }))
    expect(r.elements).toHaveLength(2)
    await r.invoke('audio.setPlaylist', { items: [track('synthetic-a'), track('synthetic-b'), track('synthetic-c')], currentIndex: 1, shuffle: true, autoplay: true })
    r.elements[2]!.emit('ended')
    await vi.waitFor(async () => expect((await r.state()).currentIndex).toBe(0))
    r.elements[3]!.emit('ended')
    await vi.waitFor(async () => expect((await r.state()).currentIndex).toBe(2))
    r.elements[4]!.emit('ended'); await Promise.resolve()
    expect((await r.state()).status).toBe('ended'); expect(r.elements).toHaveLength(5)
  })
  it('rejects failed browser playback and reports failure during automatic advancement', async () => {
    const r = harness(element => { element.playError = new DOMException('Synthetic autoplay denied', 'NotAllowedError') })
    await expect(r.invoke('audio.play', { track: track('synthetic-track') })).rejects.toMatchObject({ code: 'AUDIO_PLAY_FAILED' })
    expect(await r.state()).toMatchObject({ status: 'error', error: 'Synthetic autoplay denied' })
    const next = harness(element => { if (next.elements.length === 1) element.playError = new Error('Synthetic next track failed') })
    await next.invoke('audio.setPlaylist', { items: [track('synthetic-first'), track('synthetic-second')], autoplay: true })
    next.elements[0]!.emit('ended')
    await vi.waitFor(() => expect(next.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUDIO_PLAY_FAILED' })))
    expect(await next.state()).toMatchObject({ status: 'error', error: 'Synthetic next track failed', currentIndex: 1 })
  })
  it('cancels pending play on request abort, replacement, pause and chat switch without reviving retired state', async () => {
    const r = harness(element => { element.deferredPlay = true }), controller = new AbortController()
    const aborted = r.invoke('audio.play', { track: track('synthetic-first') }, controller.signal)
    const rejected = expect(aborted).rejects.toThrow('Synthetic page closed')
    controller.abort(new Error('Synthetic page closed')); await rejected
    expect(await r.state()).toMatchObject({ status: 'paused' }); expect(r.elements[0]!.paused).toBe(true)
    const pending = r.invoke('audio.resume'), replaced = expect(pending).rejects.toMatchObject({ code: 'AUDIO_SUPERSEDED' })
    const next = r.invoke('audio.play', { track: track('synthetic-second') }); await replaced
    r.elements[1]!.startPlayback(); await next
    r.elements[0]!.emit('error'); r.elements[0]!.emit('ended')
    expect(await r.state()).toMatchObject({ status: 'playing', currentTrack: { id: 'synthetic-second' } })
    await r.invoke('audio.pause')
    const paused = r.invoke('audio.resume'), pausedRejection = expect(paused).rejects.toMatchObject({ code: 'AUDIO_SUPERSEDED' })
    await r.invoke('audio.pause'); await pausedRejection
    const switching = r.invoke('audio.resume'), switched = expect(switching).rejects.toMatchObject({ code: 'AUDIO_CONTEXT_CHANGED' })
    r.runtime.activate('synthetic-other-chat'); await switched
    expect(r.elements.every(element => element.src === '' && element.paused && element.listenerCount === 0)).toBe(true)
    expect(await r.runtime.invoke('synthetic-other-chat', 'audio.getState')).toMatchObject({ status: 'idle', currentTrack: null })
  })
  it('publishes actual media errors and releases all resources on dispose while retaining settings only across chat switches', async () => {
    const r = harness()
    await r.invoke('audio.setSettings', { settings: { masterVolume: 0.4 } })
    await r.invoke('audio.play', { track: track('synthetic-track') })
    r.elements[0]!.error = { code: 3, message: 'Synthetic decoding error' }; r.elements[0]!.emit('error')
    expect(r.events.at(-1)).toMatchObject({ name: 'audio.state.changed', payload: { state: { status: 'error', error: 'Synthetic decoding error' } } })
    r.runtime.activate('synthetic-other-chat')
    expect(await r.runtime.invoke('', 'audio.getSettings')).toMatchObject({ masterVolume: 0.4 })
    await r.runtime.invoke('synthetic-other-chat', 'audio.play', { track: track('synthetic-other') })
    r.runtime.dispose()
    expect(r.elements.every(element => element.src === '' && element.listenerCount === 0 && element.paused)).toBe(true)
    await expect(r.runtime.invoke('', 'audio.getSettings')).rejects.toMatchObject({ code: 'AUDIO_CLOSED' })
  })
})
