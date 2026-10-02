window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-persona',
  factory() {
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
          if (!result?.ok) throw new Error(result?.error?.message || '读取用户资料失败。')
          const profile = this.assertProfile(result.value)
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', profile, error: '' })
          }
          return profile
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error',
              profile: this.snapshot.profile,
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async save(profile) {
        if (this.disposed) throw new Error('ElecKoi 用户资料已关闭。')
        const result = await this.remote.eleckoiPersona.save(this.assertProfile(profile))
        if (!result?.ok) throw new Error(result?.error?.message || '保存用户资料失败。')
        const saved = this.assertProfile(result.value)
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
