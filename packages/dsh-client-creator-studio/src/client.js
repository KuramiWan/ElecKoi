window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-creator-studio',
  factory(require) {
    // 信封拆解（含「信封不成立」的折叠）只有一份，住 @eleckoi/dsh-product-api/client
    // （ADR 0002 决定 8；票 EH-4a，票 EH-11 的 E 项把 23 份抄写收进它）。
    // 这个包已是 desktop profile 的 bundle 成员，且本插件 inject 了它，所以 require 解析得到。
    const unwrapOrFail = (result, what) => require('@eleckoi/dsh-product-api/client').unwrapOrFail(result, what)
    // 结构取消息，不用 instanceof：契约自己写明跨 bundle / 跨 realm 的副本没有同一个原型
    // （同 foldFailure 的理由），失败的 message 不能因为原型不同就变成 "Error: …"。
    const failureMessage = error => error && typeof error.message === 'string' ? error.message : String(error)
    class CreatorStudioProjects {
      constructor(remote) {
        this.remote = remote
        this.snapshot = { status: 'loading', collection: { items: [] }, error: '' }
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
        this.directoryRequests = new Set()
        this.changeAbort = null
      }

      getSnapshot = () => this.snapshot

      subscribe = listener => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      publish(next) {
        this.snapshot = next
        for (const listener of this.listeners) listener()
      }

      assertCollection(value) {
        if (!value || !Array.isArray(value.items) || value.items.some(item => !item
          || typeof item.id !== 'string' || typeof item.name !== 'string'
          || typeof item.rootPath !== 'string' || typeof item.mode !== 'string')) {
          throw new Error('创作项目返回的数据格式不正确。')
        }
        return value
      }

      adopt(collection) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', collection: this.assertCollection(collection), error: '' })
      }

      start() {
        void this.refresh().catch(() => {})
        this.changeAbort = new AbortController()
        void this.consumeChanges(this.changeAbort.signal)
      }

      async consumeChanges(signal) {
        try {
          const stream = this.remote.eleckoiCreatorStudio.changes.$stream
            ? await this.remote.eleckoiCreatorStudio.changes.$stream(signal)
            : this.remote.eleckoiCreatorStudio.changes(signal)
          for await (const change of stream) {
            if (signal.aborted || this.disposed) break
            if (change?.kind === 'snapshot' || change?.domain === 'creatorProjects') {
              await this.refresh().catch(() => {})
            }
          }
        } catch (error) {
          if (!signal.aborted && !this.disposed) console.error('创作项目变更流已中断。', error)
        }
      }

      async refresh() {
        if (this.disposed) throw new Error('创作项目服务已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.remote.eleckoiCreatorStudio.list()
          const collection = this.assertCollection(unwrapOrFail(result, '创作项目列表没有返回可用的失败对象。'))
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', collection, error: '' })
          }
          return collection
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error', collection: this.snapshot.collection,
              error: failureMessage(error), failure: error
            })
          }
          throw error
        }
      }

      async create(input) {
        if (this.disposed) throw new Error('创作项目服务已关闭。')
        const result = await this.remote.eleckoiCreatorStudio.create(input)
        const collection = this.assertCollection(unwrapOrFail(result, '创作项目创建没有返回可用的失败对象。'))
        this.adopt(collection)
        return collection
      }

      async delete(projectId) {
        if (this.disposed) throw new Error('创作项目服务已关闭。')
        const result = await this.remote.eleckoiCreatorStudio.delete(projectId)
        const collection = this.assertCollection(unwrapOrFail(result, '创作项目删除没有返回可用的失败对象。'))
        this.adopt(collection)
        return collection
      }

      async selectDirectory(signal) {
        if (this.disposed) throw new Error('创作项目服务已关闭。')
        const request = new AbortController()
        this.directoryRequests.add(request)
        try {
          const lifetime = signal ? AbortSignal.any([signal, request.signal]) : request.signal
          lifetime.throwIfAborted()
          const result = await this.remote.directoryPicker.pick(lifetime)
          lifetime.throwIfAborted()
          return unwrapOrFail(result, '保存位置选择没有返回可用的失败对象。')
        } finally {
          this.directoryRequests.delete(request)
        }
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.generation += 1
        this.changeAbort?.abort()
        this.changeAbort = null
        for (const request of this.directoryRequests) request.abort()
        this.directoryRequests.clear()
        this.listeners.clear()
      }
    }

    function apply(ctx) {
      const projects = new CreatorStudioProjects(ctx.remote)
      ctx.provide('eleckoiCreatorStudio', projects)
      ctx.effect(() => {
        projects.start()
        const stopReset = ctx.on('connection/reset', () => { void projects.refresh().catch(() => {}) })
        return () => {
          stopReset()
          projects.dispose()
        }
      }, 'eleckoi: creator studio projects')
    }

    return { inject: ['remote', 'remote.eleckoiCreatorStudio', 'remote.directoryPicker'], apply }
  }
})
