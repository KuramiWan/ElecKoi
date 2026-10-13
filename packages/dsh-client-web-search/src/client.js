window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-web-search',
  factory(require) {
    // 信封拆解（含「信封不成立」的折叠）只有一份，住 @eleckoi/dsh-product-api/client
    // （ADR 0002 决定 8；票 EH-4a，票 EH-11 的 E 项把 23 份抄写收进它）。
    // 这个包已是 desktop profile 的 bundle 成员，且本插件 inject 了它，所以 require 解析得到。
    const unwrapOrFail = (result, what) => require('@eleckoi/dsh-product-api/client').unwrapOrFail(result, what)
    // 结构取消息，不用 instanceof：契约自己写明跨 bundle / 跨 realm 的副本没有同一个原型
    // （同 foldFailure 的理由），失败的 message 不能因为原型不同就变成 "Error: …"。
    const failureMessage = error => error && typeof error.message === 'string' ? error.message : String(error)
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

      unwrap(result) {
        return unwrapOrFail(result, '联网搜索调用没有返回可用的失败对象。')
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
          const mode = this.unwrap(selectionResult)
          const settingsDocument = this.unwrap(settingsResult)
          const namespace = settingsDocument?.namespaces?.find(item => item.ns === SETTINGS_NAMESPACE)
          const values = this.normalizeSettings(namespace?.value)
          const credentialsResult = await this.remote.credentials.describe([values.apiKeyEnv])
          const credentials = this.unwrap(credentialsResult)
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
              error: failureMessage(error), failure: error
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
          this.unwrap(await this.remote.eleckoiWebSearch.select(nextMode))
        }
        if (nextMaxResults !== undefined && nextMaxResults !== this.snapshot.maxResults) {
          if (!Number.isInteger(nextMaxResults) || nextMaxResults < 1 || nextMaxResults > 8) {
            throw new Error('Tavily 返回结果数量必须在 1 到 8 之间。')
          }
          this.unwrap(await this.remote.settings.mutate(SETTINGS_NAMESPACE, [{
            op: 'set', path: ['maxResults'], value: nextMaxResults
          }], this.snapshot.revision))
        }
        return this.refresh()
      }

      async saveAndTest(apiKey) {
        const value = String(apiKey || '').trim()
        const connection = this.unwrap(await this.remote.eleckoiWebSearch.testTavily(value))
        this.unwrap(await this.remote.credentials.set(this.snapshot.apiKeyRef, value))
        return { settings: await this.refresh(), connection }
      }

      async test(apiKey = '') {
        const candidate = String(apiKey || '').trim()
        const connection = this.unwrap(
          await this.remote.eleckoiWebSearch.testTavily(candidate || undefined))
        return { connection }
      }

      async removeKey() {
        this.unwrap(await this.remote.credentials.unset(this.snapshot.apiKeyRef))
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
