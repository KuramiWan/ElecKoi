window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-presets',
  factory(require) {
    const React = require('react')
    class PresetCatalog {
      constructor(bridge) {
        this.bridge = bridge
        this.snapshot = { status: 'loading', catalog: null, error: '' }
        this.listeners = new Set()
        this.generation = 0
        this.details = new Map()
        this.detailListeners = new Map()
        this.detailGenerations = new Map()
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

      getDetailSnapshot = id => this.details.get(id) || { status: 'idle', preset: null, error: '' }

      subscribeDetail = (id, listener) => {
        let listeners = this.detailListeners.get(id)
        if (!listeners) {
          listeners = new Set()
          this.detailListeners.set(id, listeners)
        }
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          if (!listeners.size) this.detailListeners.delete(id)
        }
      }

      publishDetail(id, next) {
        this.details.set(id, next)
        for (const listener of this.detailListeners.get(id) || []) listener()
      }

      assertPreset(value, id) {
        if (!value || value.id !== id || !Array.isArray(value.regexRules)) {
          throw new Error('预设详情返回的数据格式不正确。')
        }
        return value
      }

      adoptDetail(preset) {
        if (this.disposed) return
        const id = preset?.id
        if (typeof id !== 'string' || !id) throw new Error('预设 ID 无效。')
        this.detailGenerations.set(id, (this.detailGenerations.get(id) || 0) + 1)
        this.publishDetail(id, { status: 'ready', preset: this.assertPreset(preset, id), error: '' })
      }

      async read(id) {
        if (this.disposed) throw new Error('ElecKoi 预设目录已关闭。')
        const generation = (this.detailGenerations.get(id) || 0) + 1
        this.detailGenerations.set(id, generation)
        try {
          const result = await this.bridge.request('query.agent_presets.read', { presetId: id })
          if (!result?.ok) throw new Error(result?.error?.message || '读取预设失败。')
          const preset = this.assertPreset(result.data, id)
          if (!this.disposed && generation === this.detailGenerations.get(id)) {
            this.publishDetail(id, { status: 'ready', preset, error: '' })
          }
          return this.getDetailSnapshot(id).preset || preset
        } catch (error) {
          if (!this.disposed && generation === this.detailGenerations.get(id)) {
            this.publishDetail(id, { status: 'error', preset: this.getDetailSnapshot(id).preset,
              error: error instanceof Error ? error.message : String(error) })
          }
          throw error
        }
      }

      async save(preset, expectedRegexRules) {
        if (this.disposed) throw new Error('ElecKoi 预设目录已关闭。')
        const result = await this.bridge.request('command.agent_presets.save', { preset, expectedRegexRules })
        if (!result?.ok) throw new Error(result?.error?.message || '保存预设失败。')
        const saved = this.assertPreset(result.data, preset.id)
        this.adoptDetail(saved)
        return saved
      }

      start() {
        this.stopEvents = this.bridge.subscribe(event => {
          if (event?.name !== 'records.changed' || event.payload?.module !== 'agentPresets') return
          void this.refresh().catch(() => {})
          for (const id of this.details.keys()) void this.read(id).catch(() => {})
        })
        void this.refresh().catch(() => {})
      }

      assertCatalog(value) {
        if (!value || typeof value.activePresetId !== 'string'
          || !Array.isArray(value.groups)
          || value.groups.some(group => !group || typeof group.id !== 'string')
          || !Array.isArray(value.presets)
          || value.presets.some(preset => !preset || typeof preset.id !== 'string')) {
          throw new Error('预设目录返回的数据格式不正确。')
        }
        return value
      }

      adopt(catalog) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', catalog: this.assertCatalog(catalog), error: '' })
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 预设目录已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.bridge.request('query.agent_presets.catalog', {})
          if (!result?.ok) throw new Error(result?.error?.message || '读取预设目录失败。')
          const catalog = this.assertCatalog(result.data)
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', catalog, error: '' })
          }
          return catalog
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error',
              catalog: this.snapshot.catalog,
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
        this.details.clear()
        this.detailListeners.clear()
        this.detailGenerations.clear()
      }
    }

    function apply(ctx) {
      const catalog = new PresetCatalog(window.eleckoi)
      ctx.provide('eleckoiPresets', catalog)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'presets' },
        ({ productMainPages, view }) => productMainPages?.presets
          ? React.createElement(productMainPages.presets, { view }) : null))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: 'presets', order: -20, label: '预设'
      }, () => null))
      ctx.effect(() => {
        catalog.start()
        const stopReset = ctx.on('connection/reset', () => {
          void catalog.refresh().catch(() => {})
          for (const id of catalog.details.keys()) void catalog.read(id).catch(() => {})
        })
        return () => {
          stopReset()
          catalog.dispose()
        }
      }, 'eleckoi: preset catalog')
    }

    return { inject: ['slots'], apply }
  }
})
