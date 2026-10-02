window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-display-preferences',
  factory() {
    const SETTINGS_NAMESPACE = 'eleckoi-display-preferences'

    class DisplayPreferences {
      constructor(remote) {
        this.remote = remote
        this.snapshot = Object.freeze({
          status: 'loading', ui: Object.freeze({}), chatDisplay: Object.freeze({}),
          writable: false, revision: undefined, error: ''
        })
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
        this.writeQueue = Promise.resolve()
      }

      getSnapshot = () => this.snapshot

      subscribe = listener => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      publish(next) {
        this.snapshot = Object.freeze(next)
        for (const listener of this.listeners) listener()
      }

      unwrap(result, fallback) {
        if (!result?.ok) throw new Error(result?.error?.message || fallback)
        return result.value
      }

      normalizedObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value)
          ? Object.freeze({ ...value })
          : Object.freeze({})
      }

      adopt(value) {
        const next = {
          status: 'ready',
          ui: this.normalizedObject(value?.ui),
          chatDisplay: this.normalizedObject(value?.chatDisplay),
          writable: value?.writable === true,
          revision: value?.revision,
          error: ''
        }
        this.publish(next)
        return next
      }

      async refresh() {
        if (this.disposed) throw new Error('显示偏好服务已关闭。')
        const generation = ++this.generation
        try {
          const snapshot = this.unwrap(
            await this.remote.eleckoiDisplayPreferences.read(),
            '读取显示偏好失败。'
          )
          if (this.disposed || generation !== this.generation) return this.snapshot
          return this.adopt(snapshot)
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({ ...this.snapshot, status: 'error', error: error instanceof Error ? error.message : String(error) })
          }
          throw error
        }
      }

      enqueue(method, resolveValue) {
        const operation = this.writeQueue.then(async () => {
          if (this.disposed) throw new Error('显示偏好服务已关闭。')
          const value = resolveValue()
          const snapshot = this.unwrap(
            await this.remote.eleckoiDisplayPreferences[method](value, this.snapshot.revision),
            '保存显示偏好失败。'
          )
          return this.adopt(snapshot)
        })
        this.writeQueue = operation.catch(() => {})
        return operation
      }

      updateUi(update) {
        return this.enqueue('updateUi', () => {
          const current = this.snapshot.ui
          const next = typeof update === 'function' ? update(current) : { ...current, ...(update || {}) }
          return this.normalizedObject(next)
        })
      }

      setChatDisplay(value) {
        return this.enqueue('setChatDisplay', () => this.normalizedObject(value))
      }

      start() {
        void this.refresh().catch(() => {})
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.generation += 1
        this.listeners.clear()
      }
    }

    function apply(ctx) {
      const model = new DisplayPreferences(ctx.remote)
      ctx.provide('eleckoiDisplayPreferences', model)
      ctx.effect(() => {
        model.start()
        const refresh = () => { void model.refresh().catch(() => {}) }
        const stopReset = ctx.on('connection/reset', refresh)
        const stopSettings = ctx.remote.$on('settings/document-updated', ns => {
          if (ns === SETTINGS_NAMESPACE) refresh()
        })
        return () => {
          stopReset()
          stopSettings()
          model.dispose()
        }
      }, 'eleckoi: display preferences')
    }

    return { inject: ['remote', 'remote.settings', 'remote.eleckoiDisplayPreferences'], apply }
  }
})
