type AudioListener = NonNullable<Parameters<EventTarget['addEventListener']>[1]>

export class NativeAudioElement extends EventTarget {
  currentTime = 0
  duration = 120
  volume = 1
  muted = false
  paused = true
  preload = ''
  src = ''
  error: { message: string; code: number } | null = null
  deferredPlay = false
  playError: Error | undefined
  readonly listeners = new Map<string, Set<AudioListener>>()
  private pending: { resolve(): void; reject(error: Error): void } | undefined

  override addEventListener(name: string, listener: AudioListener | null, options?: AddEventListenerOptions | boolean): void {
    if (!listener) return
    super.addEventListener(name, listener, options)
    const values = this.listeners.get(name) ?? new Set(); values.add(listener); this.listeners.set(name, values)
  }
  override removeEventListener(name: string, listener: AudioListener | null, options?: EventListenerOptions | boolean): void {
    if (!listener) return
    super.removeEventListener(name, listener, options)
    this.listeners.get(name)?.delete(listener)
  }
  emit(name: string): void { this.dispatchEvent(new Event(name)) }
  play(): Promise<void> {
    if (this.playError) return Promise.reject(this.playError)
    if (!this.deferredPlay) { this.paused = false; this.emit('playing'); return Promise.resolve() }
    return new Promise((resolve, reject) => { this.pending = { resolve, reject } })
  }
  startPlayback(): void { const pending = this.pending; this.pending = undefined; this.paused = false; this.emit('playing'); pending?.resolve() }
  pause(): void {
    this.paused = true
    const pending = this.pending; this.pending = undefined
    pending?.reject(new DOMException('Playback was cancelled', 'AbortError'))
    this.emit('pause')
  }
  load(): void { this.currentTime = 0 }
  removeAttribute(name: string): void { if (name === 'src') this.src = '' }
  get listenerCount(): number { return [...this.listeners.values()].reduce((count, values) => count + values.size, 0) }
}
