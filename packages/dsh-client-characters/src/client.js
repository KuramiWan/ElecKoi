window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-characters',
  factory(require) {
    const React = require('react')
    // 信封拆解（含「信封不成立」的折叠）只有一份，住 @eleckoi/dsh-product-api/client
    // （ADR 0002 决定 8；票 EH-4a，票 EH-11 的 E 项把 23 份抄写收进它）。
    // 这个包已是 desktop profile 的 bundle 成员，且本插件 inject 了它，所以 require 解析得到。
    const unwrapOrFail = (result, what) => require('@eleckoi/dsh-product-api/client').unwrapOrFail(result, what)
    // 结构取消息，不用 instanceof：契约自己写明跨 bundle / 跨 realm 的副本没有同一个原型
    // （同 foldFailure 的理由），失败的 message 不能因为原型不同就变成 "Error: …"。
    const failureMessage = error => error && typeof error.message === 'string' ? error.message : String(error)
    const CharacterPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-character.js')
      .then(module => ({ default: module.CharacterPage })))
    class CharacterCatalog {
      constructor(remote) {
        this.remote = remote
        this.snapshot = {
          status: 'loading',
          collection: { active_character_id: '', groups: [], items: [] },
          error: ''
        }
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
          const stream = this.remote.eleckoiCharacters.changes.$stream
            ? await this.remote.eleckoiCharacters.changes.$stream(signal)
            : this.remote.eleckoiCharacters.changes(signal)
          for await (const change of stream) {
            if (signal.aborted || this.disposed) break
            if (change?.kind === 'snapshot' || change?.domain === 'characters') {
              await this.refresh().catch(() => {})
            }
          }
        } catch (error) {
          if (!signal.aborted && !this.disposed) console.error('角色变更流已中断。', error)
        }
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
          const result = await this.remote.eleckoiCharacters.list()
          const collection = this.assertCollection(unwrapOrFail(result, '角色列表没有返回可用的失败对象。'))
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', collection, error: '' })
          }
          return collection
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error',
              collection: this.snapshot.collection,
              error: failureMessage(error), failure: error
            })
          }
          throw error
        }
      }

      async mutate(method, args) {
        if (this.disposed) throw new Error('ElecKoi 角色列表已关闭。')
        const result = await this.remote.eleckoiCharacters[method](...args)
        const collection = this.assertCollection(unwrapOrFail(result, `角色操作 ${method} 没有返回可用的失败对象。`))
        this.adopt(collection)
        return collection
      }

      create(character) {
        return this.mutate('create', [character])
      }

      update(character) {
        return this.mutate('update', [character])
      }

      select(characterId) {
        return this.mutate('select', [characterId])
      }

      saveGroups(groups, assignments = []) {
        return this.mutate('saveGroups', [groups, assignments])
      }

      delete(characterIds) {
        return this.mutate('delete', [characterIds || []])
      }

      async prepareImport(source, files) {
        const result = await this.remote.eleckoiCharacters.prepareImport(files, source)
        return unwrapOrFail(result, '角色卡导入准备没有返回可用的失败对象。')
      }

      async commitImport(token) {
        const result = await this.remote.eleckoiCharacters.commitImport(token)
        const value = unwrapOrFail(result, '角色卡导入提交没有返回可用的失败对象。')
        this.adopt(value.collection)
        return value
      }

      async discardImport(token) {
        const result = await this.remote.eleckoiCharacters.discardImport(token)
        unwrapOrFail(result, '角色卡导入清理没有返回可用的失败对象。')
      }

      async exportCharacters(characterIds, format) {
        const written = []
        const failures = []
        for (const characterId of [...new Set(characterIds || [])]) {
          try {
            const result = await this.remote.eleckoiCharacters.export(characterId, format)
            const value = unwrapOrFail(result, '角色卡导出没有返回可用的失败对象。')
            downloadExport(value)
            written.push({ characterId, fileName: value.fileName })
          } catch (error) {
            failures.push({ characterId, message: error instanceof Error ? error.message : '导出失败。' })
          }
        }
        return { canceled: false, directory: '下载目录', written, failures }
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
      const catalog = new CharacterCatalog(ctx.remote)
      ctx.provide('eleckoiCharacters', catalog)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'character', registrant: '@eleckoi/dsh-client-characters' },
        () => React.createElement(CharacterPage)))
      const NavigationIcon = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-character.js')
        .then(module => ({ default: module.NavigationIcon })))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: 'character', order: -30, label: '角色列表', registrant: '@eleckoi/dsh-client-characters'
      }, () => React.createElement(NavigationIcon)))
      ctx.effect(() => {
        catalog.start()
        const stopReset = ctx.on('connection/reset', () => { void catalog.refresh().catch(() => {}) })
        return () => {
          stopReset()
          catalog.dispose()
        }
      }, 'eleckoi: character catalog')
    }

    return { inject: ['slots', 'remote', 'remote.eleckoiCharacters'], apply }
  }
})

function downloadExport(file) {
  const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.fileName
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
