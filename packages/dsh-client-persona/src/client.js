window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-persona',
  factory() {
    class PersonaProfile {
      constructor(bridge) {
        this.bridge = bridge
        this.snapshot = { status: 'loading', profile: null, error: '' }
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
        this.stopEvents = () => {}
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
        this.stopEvents = this.bridge.subscribe(event => {
          if (event?.name !== 'records.changed' || event.payload?.module !== 'personas') return
          void this.refresh().catch(() => {})
        })
        void this.refresh().catch(() => {})
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
          const result = await this.bridge.request('query.persona.read', {})
          if (!result?.ok) throw new Error(result?.error?.message || '读取用户资料失败。')
          const profile = this.assertProfile(result.data)
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

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.generation += 1
        this.stopEvents()
        this.listeners.clear()
      }
    }

    function apply(ctx) {
      const profile = new PersonaProfile(window.eleckoi)
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

    return { apply }
  }
})
