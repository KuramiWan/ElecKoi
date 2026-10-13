window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-persona',
  factory(require) {
    // 信封拆解（含「信封不成立」的折叠）只有一份，住 @eleckoi/dsh-product-api/client
    // （ADR 0002 决定 8；票 EH-4a，票 EH-11 的 E 项把 23 份抄写收进它）。
    // 这个包已是 desktop profile 的 bundle 成员，且本插件 inject 了它，所以 require 解析得到。
    const unwrapOrFail = (result, what) => require('@eleckoi/dsh-product-api/client').unwrapOrFail(result, what)
    // 结构取消息，不用 instanceof：契约自己写明跨 bundle / 跨 realm 的副本没有同一个原型
    // （同 foldFailure 的理由），失败的 message 不能因为原型不同就变成 "Error: …"。
    const failureMessage = error => error && typeof error.message === 'string' ? error.message : String(error)
    class PersonaProfile {
      constructor(remote) {
        this.remote = remote
        this.snapshot = { status: 'loading', profile: null, error: '' }
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
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

      start() {
        void this.refresh().catch(() => {})
        this.changeAbort = new AbortController()
        void this.consumeChanges(this.changeAbort.signal)
      }

      async consumeChanges(signal) {
        try {
          const stream = this.remote.eleckoiPersona.changes.$stream
            ? await this.remote.eleckoiPersona.changes.$stream(signal)
            : this.remote.eleckoiPersona.changes(signal)
          for await (const change of stream) {
            if (signal.aborted || this.disposed) break
            if (change?.kind === 'snapshot' || change?.domain === 'persona') {
              await this.refresh().catch(() => {})
            }
          }
        } catch (error) {
          if (!signal.aborted && !this.disposed) console.error('用户资料变更流已中断。', error)
        }
      }

      assertProfile(value) {
        if (!value || typeof value.user_name !== 'string'
          || typeof value.user_avatar !== 'string'
          || typeof value.user_square !== 'string'
          || typeof value.user_portrait !== 'string') {
          throw new Error('用户资料返回的数据格式不正确。')
        }
        return value
      }

      adopt(profile) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', profile: this.assertProfile(profile), error: '' })
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 用户资料已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.remote.eleckoiPersona.read()
          const profile = this.assertProfile(unwrapOrFail(result, '用户资料读取没有返回可用的失败对象。'))
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', profile, error: '' })
          }
          return profile
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error',
              profile: this.snapshot.profile,
              error: failureMessage(error), failure: error
            })
          }
          throw error
        }
      }

      async save(profile) {
        if (this.disposed) throw new Error('ElecKoi 用户资料已关闭。')
        const result = await this.remote.eleckoiPersona.save(this.assertProfile(profile))
        const saved = this.assertProfile(unwrapOrFail(result, '用户资料保存没有返回可用的失败对象。'))
        this.adopt(saved)
        return saved
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.generation += 1
        this.changeAbort?.abort()
        this.changeAbort = null
        this.listeners.clear()
      }
    }

    function apply(ctx) {
      const profile = new PersonaProfile(ctx.remote)
      ctx.provide('eleckoiPersona', profile)
      ctx.effect(() => {
        profile.start()
        const stopReset = ctx.on('connection/reset', () => { void profile.refresh().catch(() => {}) })
        return () => {
          stopReset()
          profile.dispose()
        }
      }, 'eleckoi: user profile')
    }

    return { inject: ['remote', 'remote.eleckoiPersona'], apply }
  }
})
