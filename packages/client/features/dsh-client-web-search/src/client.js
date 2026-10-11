window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-web-search',
  factory() {
    const SETTINGS_NAMESPACE = 'web-search-tavily'
    const TAVILY_API_KEY_REF = 'TAVILY_API_KEY'

    class WebSearchSettings {
      constructor(remote) {
        this.remote = remote
        this.snapshot = {
          status: 'loading',
          mode: 'provider_native',
          maxResults: 5,
          apiKeyConfigured: false,
          apiKeyRef: TAVILY_API_KEY_REF,
          apiKeyWritable: true,
          writable: false,
          tavilyAvailable: false,
          revision: undefined,
          error: ''
        }
        this.listeners = new Set()
        this.generation = 0
        this.disposed = false
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

      unwrap(result, fallback) {
        if (!result?.ok) throw new Error(result?.error?.message || fallback)
        return result.value
      }

      normalizeSettings(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { maxResults: 5, apiKeyEnv: TAVILY_API_KEY_REF }
        const maxResults = Number.isInteger(value.maxResults) && value.maxResults >= 1 && value.maxResults <= 8
          ? value.maxResults : 5
        const apiKeyEnv = typeof value.apiKeyEnv === 'string' && value.apiKeyEnv.trim()
          ? value.apiKeyEnv.trim() : TAVILY_API_KEY_REF
        return { maxResults, apiKeyEnv }
      }

      async refresh() {
        if (this.disposed) throw new Error('联网搜索设置已关闭。')
        const generation = ++this.generation
        try {
          const [selectionResult, settingsResult] = await Promise.all([
            this.remote.eleckoiWebSearch.selection(),
            this.remote.settings.describe()
          ])
          const mode = this.unwrap(selectionResult, '读取搜索方式失败。')
          const settingsDocument = this.unwrap(settingsResult, '读取联网搜索设置失败。')
          const namespace = settingsDocument?.namespaces?.find(item => item.ns === SETTINGS_NAMESPACE)
          const values = this.normalizeSettings(namespace?.value)
          const credentialsResult = await this.remote.credentials.describe([values.apiKeyEnv])
          const credentials = this.unwrap(credentialsResult, '读取 Tavily 凭据状态失败。')
          const credential = credentials?.[values.apiKeyEnv]
          const next = {
            status: 'ready',
            mode: mode === 'tavily' ? 'tavily' : 'provider_native',
            maxResults: values.maxResults,
            apiKeyConfigured: credential?.configured === true,
            apiKeyRef: values.apiKeyEnv,
            apiKeyWritable: credential?.writable !== false,
            writable: settingsDocument.writable === true,
            tavilyAvailable: Boolean(namespace),
            revision: namespace?.revision,
            error: ''
          }
          if (!this.disposed && generation === this.generation) this.publish(next)
          return next
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              ...this.snapshot,
              status: 'error',
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async update(patch) {
        if (this.disposed) throw new Error('联网搜索设置已关闭。')
        const nextMode = patch?.mode
        const nextMaxResults = patch?.maxResults
        if (nextMode !== undefined && nextMode !== this.snapshot.mode) {
          this.unwrap(await this.remote.eleckoiWebSearch.select(nextMode), '保存搜索方式失败。')
        }
        if (nextMaxResults !== undefined && nextMaxResults !== this.snapshot.maxResults) {
          if (!Number.isInteger(nextMaxResults) || nextMaxResults < 1 || nextMaxResults > 8) {
            throw new Error('Tavily 返回结果数量必须在 1 到 8 之间。')
          }
          this.unwrap(await this.remote.settings.mutate(SETTINGS_NAMESPACE, [{
            op: 'set', path: ['maxResults'], value: nextMaxResults
          }], this.snapshot.revision), '保存 Tavily 设置失败。')
        }
        return this.refresh()
      }

      async saveAndTest(apiKey) {
        const value = String(apiKey || '').trim()
        const connection = this.unwrap(await this.remote.eleckoiWebSearch.testTavily(value), 'Tavily 连接失败。')
        this.unwrap(await this.remote.credentials.set(this.snapshot.apiKeyRef, value), '保存 Tavily API Key 失败。')
        return { settings: await this.refresh(), connection }
      }

      async test(apiKey = '') {
        const candidate = String(apiKey || '').trim()
        const connection = this.unwrap(
          await this.remote.eleckoiWebSearch.testTavily(candidate || undefined),
          'Tavily 连接失败。'
        )
        return { connection }
      }

      async removeKey() {
        this.unwrap(await this.remote.credentials.unset(this.snapshot.apiKeyRef), '移除 Tavily API Key 失败。')
        return this.refresh()
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
      const settings = new WebSearchSettings(ctx.remote)
      ctx.provide('eleckoiWebSearch', settings)
      ctx.effect(() => {
        settings.start()
        const refresh = () => { void settings.refresh().catch(() => {}) }
        const stopReset = ctx.on('connection/reset', refresh)
        const stopCredentials = ctx.remote.$on('credentials/reference-updated', ref => {
          if (ref === settings.getSnapshot().apiKeyRef) refresh()
        })
        const stopSettings = ctx.remote.$on('settings/document-updated', ns => {
          if (ns === SETTINGS_NAMESPACE) refresh()
        })
        const stopPlugins = ctx.remote.$on('plugin-manager/changed', refresh)
        return () => {
          stopReset()
          stopCredentials()
          stopSettings()
          stopPlugins()
          settings.dispose()
        }
      }, 'eleckoi: web search settings')
    }

    return { inject: ['remote', 'remote.eleckoiWebSearch', 'remote.settings', 'remote.credentials'], apply }
  }
})
