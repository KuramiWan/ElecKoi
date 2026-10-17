window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-web-search',
  factory(require) {
    // 边界⑥ 的信封拆解只有一份实现（@eleckoi/dsh-product-api 的 client 面）。
    const { unwrapOrFail, failureAlreadyPublished } = require('@eleckoi/dsh-product-api')
    const SETTINGS_NAMESPACE = 'web-search-tavily'
    const TAVILY_API_KEY_REF = 'TAVILY_API_KEY'
    const DEEPSEEK_NAMESPACE = 'eleckoi-web-deepseek'
    const DEEPSEEK_KEY_REF = 'DEEPSEEK_WEB_API_KEY'

    class WebSearchSettings {
      constructor(remote) {
        this.remote = remote
        this.snapshot = {
          status: 'loading',
          mode: 'provider_native',
          fetchMode: 'http',
          deepseek: { available: false, count: 10, needContent: false, localization: '', apiKeyRef: DEEPSEEK_KEY_REF, apiKeyConfigured: false, apiKeyWritable: false },
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
        return unwrapOrFail(result, fallback)
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
          const [selectionResult, fetchSelectionResult, settingsResult] = await Promise.all([
            this.remote.eleckoiWebSearch.selection(),
            this.remote.eleckoiWebSearch.fetchSelection(),
            this.remote.settings.describe()
          ])
          const mode = this.unwrap(selectionResult, '读取搜索方式失败。')
          const fetchMode = this.unwrap(fetchSelectionResult, '读取抓取方式失败。')
          const settingsDocument = this.unwrap(settingsResult, '读取联网搜索设置失败。')
          const namespace = settingsDocument?.namespaces?.find(item => item.ns === SETTINGS_NAMESPACE)
          const values = this.normalizeSettings(namespace?.value)
          const deepseekNamespace = settingsDocument?.namespaces?.find(item => item.ns === DEEPSEEK_NAMESPACE)
          const deepseekValues = deepseekNamespace?.value ?? {}
          const deepseekRef = typeof deepseekValues.apiKeyEnv === 'string' && deepseekValues.apiKeyEnv.trim() ? deepseekValues.apiKeyEnv.trim() : DEEPSEEK_KEY_REF
          const credentialsResult = await this.remote.credentials.describe([...new Set([values.apiKeyEnv, deepseekRef])])
          const credentials = this.unwrap(credentialsResult, '读取 Tavily 凭据状态失败。')
          const credential = credentials?.[values.apiKeyEnv]
          const next = {
            status: 'ready',
            mode,
            fetchMode,
            deepseek: {
              available: Boolean(deepseekNamespace), count: deepseekValues.count ?? 10,
              needContent: deepseekValues.needContent ?? false, localization: deepseekValues.localization ?? '',
              apiKeyRef: deepseekRef, apiKeyConfigured: credentials?.[deepseekRef]?.configured === true,
              apiKeyWritable: credentials?.[deepseekRef]?.writable !== false, revision: deepseekNamespace?.revision
            },
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
              error: typeof error?.message === 'string' && error.message.trim() ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async update(patch) {
        if (this.disposed) throw new Error('联网搜索设置已关闭。')
        const nextMode = patch?.mode
        const nextMaxResults = patch?.maxResults
        const deepseekOperations = []
        if (patch.deepseekCount !== undefined) {
          if (!Number.isInteger(patch.deepseekCount) || patch.deepseekCount < 1 || patch.deepseekCount > 50) throw new Error('DeepSeek 返回条数必须在 1 到 50 之间。')
          deepseekOperations.push({ op: 'set', path: ['count'], value: patch.deepseekCount })
        }
        if (patch.needContent !== undefined) {
          if (typeof patch.needContent !== 'boolean') throw new Error('网页正文选项必须为布尔值。')
          deepseekOperations.push({ op: 'set', path: ['needContent'], value: patch.needContent })
        }
        if (patch.localization !== undefined) deepseekOperations.push({ op: 'set', path: ['localization'], value: patch.localization })
        if (patch.deepseekKeyRef !== undefined) {
          if (typeof patch.deepseekKeyRef !== 'string' || !patch.deepseekKeyRef.trim()) throw new Error('请选择有效的凭据引用。')
          deepseekOperations.push({ op: 'set', path: ['apiKeyEnv'], value: patch.deepseekKeyRef.trim() })
        }
        if (deepseekOperations.length) this.unwrap(await this.remote.settings.mutate(DEEPSEEK_NAMESPACE, deepseekOperations, this.snapshot.deepseek.revision), '保存 DeepSeek 联网配置失败。')
        if (patch.fetchMode !== undefined && patch.fetchMode !== this.snapshot.fetchMode) this.unwrap(await this.remote.eleckoiWebSearch.selectFetch(patch.fetchMode), '保存抓取方式失败。')
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

      async saveAndTest(apiKey, provider = 'tavily') {
        if (provider !== 'tavily' && provider !== 'deepseek_api') throw new Error('不支持的密钥提供商。')
        const value = String(apiKey || '').trim()
        if (!value) throw new Error('请先填写 API Key。')
        const ref = provider === 'deepseek_api' ? this.snapshot.deepseek.apiKeyRef : this.snapshot.apiKeyRef
        const connection = this.unwrap(await this.remote.eleckoiWebSearch[provider === 'deepseek_api' ? 'testDeepSeek' : 'testTavily'](value), '联网连接测试失败。')
        this.unwrap(await this.remote.credentials.set(ref, value), '保存 API Key 失败。')
        return { settings: await this.refresh(), connection }
      }

      async test(apiKey = '', provider = 'tavily') {
        if (provider !== 'tavily' && provider !== 'deepseek_api') throw new Error('不支持的密钥提供商。')
        const candidate = String(apiKey || '').trim()
        const connection = this.unwrap(
          await this.remote.eleckoiWebSearch[provider === 'deepseek_api' ? 'testDeepSeek' : 'testTavily'](candidate || undefined),
          '联网连接测试失败。'
        )
        return { connection }
      }

      async removeKey(provider = 'tavily') {
        if (provider !== 'tavily' && provider !== 'deepseek_api') throw new Error('不支持的密钥提供商。')
        this.unwrap(await this.remote.credentials.unset(provider === 'deepseek_api' ? this.snapshot.deepseek.apiKeyRef : this.snapshot.apiKeyRef), '移除 API Key 失败。')
        return this.refresh()
      }

      start() {
        void this.refresh().catch(failureAlreadyPublished)
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
        const refresh = () => { void settings.refresh().catch(failureAlreadyPublished) }
        const stopReset = ctx.on('connection/reset', refresh)
        const stopCredentials = ctx.remote.$on('credentials/reference-updated', ref => {
          if (ref === settings.getSnapshot().apiKeyRef || ref === settings.getSnapshot().deepseek.apiKeyRef) refresh()
        })
        const stopSettings = ctx.remote.$on('settings/document-updated', ns => {
          if (ns === SETTINGS_NAMESPACE || ns === DEEPSEEK_NAMESPACE) refresh()
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
