window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-characters',
  factory(require) {
    const React = require('react')
    const CharacterPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-character.js')
      .then(module => ({ default: module.CharacterPage })))
    class CharacterCatalog {
      constructor(bridge) {
        this.bridge = bridge
        this.snapshot = {
          status: 'loading',
          collection: { active_character_id: '', groups: [], items: [] },
          error: ''
        }
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
          if (event?.name !== 'records.changed') return
          if (event.payload?.module !== 'personas' && event.payload?.module !== 'settingLibraries') return
          void this.refresh().catch(() => {})
        })
        void this.refresh().catch(() => {})
      }

      assertCollection(value) {
        if (!value || typeof value.active_character_id !== 'string'
          || !Array.isArray(value.groups) || !value.groups.every(group => typeof group === 'string')
          || !Array.isArray(value.items) || value.items.some(item => !item || typeof item.id !== 'string')) {
          throw new Error('角色列表返回的数据格式不正确。')
        }
        const active = value.items.find(item => item.id === value.active_character_id) || value.items[0]
        return active?.id === value.active_character_id
          ? value
          : { ...value, active_character_id: active?.id || '' }
      }

      adopt(collection) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', collection: this.assertCollection(collection), error: '' })
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 角色列表已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.bridge.request('query.characters.list', {})
          if (!result?.ok) throw new Error(result?.error?.message || '读取角色列表失败。')
          const collection = this.assertCollection(result.data)
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', collection, error: '' })
          }
          return collection
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error',
              collection: this.snapshot.collection,
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
      const catalog = new CharacterCatalog(window.eleckoi)
      ctx.provide('eleckoiCharacters', catalog)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'character', registrant: '@eleckoi/dsh-client-characters' },
        () => React.createElement(CharacterPage)))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: 'character', order: -30, label: '角色列表'
      }, () => null))
      ctx.effect(() => {
        catalog.start()
        const stopReset = ctx.on('connection/reset', () => { void catalog.refresh().catch(() => {}) })
        return () => {
          stopReset()
          catalog.dispose()
        }
      }, 'eleckoi: character catalog')
    }

    return { inject: ['slots'], apply }
  }
})
