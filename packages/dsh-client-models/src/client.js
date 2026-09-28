window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-models',
  factory(require) {
    const React = require('react')
    const ModelPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-model.js')
      .then(module => ({ default: module.ModelPage })))
    class ModelCatalog {
      constructor(bridge) {
        this.bridge = bridge
        this.snapshot = { status: 'loading', configs: [], error: '' }
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

      assertConfigs(value) {
        if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string'
          || typeof item.provider !== 'string' || typeof item.model !== 'string')) {
          throw new Error('模型配置返回的数据格式不正确。')
        }
        return value
      }

      adopt(configs) {
        if (this.disposed) return
        this.generation += 1
        this.publish({ status: 'ready', configs: this.assertConfigs(configs), error: '' })
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 模型目录已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.bridge.request('query.models.list', {})
          if (!result?.ok) throw new Error(result?.error?.message || '读取模型配置失败。')
          const configs = this.assertConfigs(result.data)
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', configs, error: '' })
          }
          return configs
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'error', configs: this.snapshot.configs,
              error: error instanceof Error ? error.message : String(error) })
          }
          throw error
        }
      }

      start() {
        this.stopEvents = this.bridge.subscribe(event => {
          if (event?.name === 'records.changed' && event.payload?.module === 'models') {
            void this.refresh().catch(() => {})
          }
        })
        void this.refresh().catch(() => {})
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
      const catalog = new ModelCatalog(window.eleckoi)
      ctx.provide('eleckoiModels', catalog)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'model', registrant: '@eleckoi/dsh-client-models' },
        () => React.createElement(ModelPage)))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: 'model', order: 30, label: '模型配置'
      }, () => null))
      ctx.effect(() => {
        catalog.start()
        const stopReset = ctx.on('connection/reset', () => { void catalog.refresh().catch(() => {}) })
        return () => {
          stopReset()
          catalog.dispose()
        }
      }, 'eleckoi: model catalog')
    }

    return { inject: ['slots'], apply }
  }
})
