window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-display-preferences',
  factory(require) {
    // 信封拆解（含「信封不成立」的折叠）只有一份，住 @eleckoi/dsh-product-api/client
    // （ADR 0002 决定 8；票 EH-4a，票 EH-11 的 E 项把 23 份抄写收进它）。
    // 这个包已是 desktop profile 的 bundle 成员，且本插件 inject 了它，所以 require 解析得到。
    const unwrapOrFail = (result, what) => require('@eleckoi/dsh-product-api/client').unwrapOrFail(result, what)
    // 结构取消息，不用 instanceof：契约自己写明跨 bundle / 跨 realm 的副本没有同一个原型
    // （同 foldFailure 的理由），失败的 message 不能因为原型不同就变成 "Error: …"。
    const failureMessage = error => error && typeof error.message === 'string' ? error.message : String(error)
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

      unwrap(result) {
        return unwrapOrFail(result, '显示偏好调用没有返回可用的失败对象。')
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
            await this.remote.eleckoiDisplayPreferences.read()
          )
          if (this.disposed || generation !== this.generation) return this.snapshot
          return this.adopt(snapshot)
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({ ...this.snapshot, status: 'error', error: failureMessage(error), failure: error })
          }
          throw error
        }
      }

      enqueue(method, resolveValue) {
        const operation = this.writeQueue.then(async () => {
          if (this.disposed) throw new Error('显示偏好服务已关闭。')
          const value = resolveValue()
          const snapshot = this.unwrap(
            await this.remote.eleckoiDisplayPreferences[method](value, this.snapshot.revision)
          )
          return this.adopt(snapshot)
        })
        // 队列吞掉拒绝只是为了让后面的写继续排队；失败本身带上实例发到快照（ADR 0002 决定 12），
        // 订阅者从 status:'error' 那条快照的 failure 里读到 code 与 details；调用方仍拿到拒绝。
        this.writeQueue = operation.catch(error => {
          if (!this.disposed) {
            this.publish({ ...this.snapshot, status: 'error',
              error: failureMessage(error), failure: error })
          }
        })
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
