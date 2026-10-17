window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-character-configuration',
  factory(require) {
    // 边界⑥ 的信封拆解只有一份实现：@eleckoi/dsh-product-api 的 client 面（本包是 desktop
    // bundle 成员，运行时用同一个 id 取）。它失败时抛出宿主给的失败对象本身，不再把码压成 message。
    const { unwrapOrFail, failureAlreadyPublished } = require('@eleckoi/dsh-product-api')

    const idle = { status: 'idle', value: null, error: '' }

    class CharacterConfigurationBridge {
      constructor(remote) {
        this.remote = remote
        this.listeners = new Set()
        this.disposed = false
        this.abort = null
        this.stream = null
      }

      async request(method, args) {
        const api = this.remote.eleckoiCharacterConfiguration
        if (typeof api[method] !== 'function') throw new Error(`不支持的角色配置操作：${method}`)
        const result = await api[method](...args)
        return unwrapOrFail(result, '角色配置操作失败。')
      }

      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      start() {
        const controller = new AbortController()
        this.abort = controller
        const stream = typeof this.remote?.$stream === 'function'
          ? this.remote.$stream({
            name: 'ElecKoi character configuration changes',
            open: signal => this.remote.eleckoiCharacterConfiguration.changes(signal),
            ended: () => new Error('ElecKoi 角色配置变更流意外结束。')
          })
          : this.remote.eleckoiCharacterConfiguration.changes(controller.signal)
        this.stream = stream
        void this.consume(stream)
      }

      async consume(stream) {
        try {
          for await (const item of stream) {
            if (this.disposed) return
            const change = item?.value ?? item
            item?.accept?.()
            for (const listener of this.listeners) listener(change)
          }
        } catch (error) {
          if (!this.disposed && !this.abort?.signal.aborted) {
            console.error('ElecKoi 角色配置变更流失败：', error)
          }
        }
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.abort?.abort()
        if (typeof this.stream?.dispose === 'function') void this.stream.dispose()
        this.listeners.clear()
        this.abort = null
        this.stream = null
      }

      async listCharacters() {
        const result = await this.remote.eleckoiCharacters.list()
        return unwrapOrFail(result, '读取角色列表失败。')
      }

      async listConversations() {
        const result = await this.remote.eleckoiConversations.list()
        const value = unwrapOrFail(result, '读取聊天消息预览失败。')
        if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string')) {
          throw new Error('会话目录返回的数据格式不正确。')
        }
        return value
      }
    }

    class CharacterConfigurationModel {
      constructor(bridge, moduleName, readMethod, saveMethod, viewStateMethod, validate) {
        this.bridge = bridge
        this.moduleName = moduleName
        this.readMethod = readMethod
        this.saveMethod = saveMethod
        this.viewStateMethod = viewStateMethod
        this.validate = validate
        this.snapshots = new Map()
        this.generations = new Map()
        this.listeners = new Set()
        this.disposed = false
        this.stopEvents = () => {}
      }

      getSnapshot = characterId => this.snapshots.get(characterId) || idle

      subscribe = listener => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      publish(kind, characterId, snapshot) {
        this.snapshots.set(characterId, snapshot)
        for (const listener of this.listeners) listener(kind, characterId, snapshot)
      }

      nextGeneration(characterId) {
        const generation = (this.generations.get(characterId) || 0) + 1
        this.generations.set(characterId, generation)
        return generation
      }

      async request(method, ...args) {
        if (this.disposed) throw new Error('角色配置客户端模型已关闭。')
        return this.bridge.request(method, args)
      }

      async read(characterId) {
        const generation = this.nextGeneration(characterId)
        const previous = this.getSnapshot(characterId)
        this.publish('configuration', characterId, { ...previous, status: 'loading', error: '' })
        try {
          const value = this.validate(await this.request(this.readMethod, characterId), characterId)
          if (!this.disposed && this.generations.get(characterId) === generation) {
            this.publish('configuration', characterId, { status: 'ready', value, error: '' })
          }
          return value
        } catch (error) {
          if (!this.disposed && this.generations.get(characterId) === generation) {
            this.publish('configuration', characterId, {
              status: 'error', value: previous.value,
              // 按形状取 message，不用 instanceof：RemoteError 可能是别的 realm 的副本。
              error: typeof error?.message === 'string' && error.message.trim() ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async readUntracked(characterId) {
        return this.validate(await this.request(this.readMethod, characterId), characterId)
      }

      async save(characterId, value) {
        const generation = this.nextGeneration(characterId)
        const saved = this.validate(await this.request(this.saveMethod, characterId, value), characterId)
        if (!this.disposed && this.generations.get(characterId) === generation) {
          this.publish('configuration', characterId, { status: 'ready', value: saved, error: '' })
        }
        return saved
      }

      async saveViewState(characterId, expandedIds) {
        const field = this.moduleName === 'settingLibraries' ? 'expandedGroupIds' : 'expandedObjectIds'
        const saved = await this.request(this.viewStateMethod, characterId, expandedIds)
        const snapshot = this.getSnapshot(characterId)
        if (snapshot.value) {
          this.publish('configuration', characterId, {
            ...snapshot, value: { ...snapshot.value, [field]: saved }
          })
        }
        return saved
      }

      refreshLoaded(characterId) {
        if (characterId) {
          if (this.snapshots.has(characterId)) void this.read(characterId).catch(failureAlreadyPublished)
          return
        }
        for (const loadedId of this.snapshots.keys()) void this.read(loadedId).catch(failureAlreadyPublished)
      }

      start() {
        this.stopEvents = this.bridge.subscribe(change => {
          if (change?.kind === 'snapshot') this.refreshLoaded()
          else if (change?.kind === 'configuration' && change.domain === this.moduleName) {
            this.refreshLoaded(change.characterId)
          }
        })
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.stopEvents()
        this.listeners.clear()
        this.snapshots.clear()
        this.generations.clear()
      }
    }

    class SettingLibrariesModel extends CharacterConfigurationModel {
      constructor(bridge) {
        super(bridge, 'settingLibraries', 'readSettingLibrary', 'saveSettingLibrary',
          'saveSettingLibraryViewState', (value, characterId) => {
            if (!value || value.characterId !== characterId || !Array.isArray(value.entries)
              || !Array.isArray(value.groups) || !Array.isArray(value.versions)) {
              throw new Error('设定库返回的数据格式不正确。')
            }
            return value
          })
        this.conversationSnapshots = new Map()
        this.conversationGenerations = new Map()
      }

      getConversationSnapshot = characterId => this.conversationSnapshots.get(characterId) || idle

      listCharacters() {
        return this.bridge.listCharacters()
      }

      async readConversations(characterId) {
        const generation = (this.conversationGenerations.get(characterId) || 0) + 1
        this.conversationGenerations.set(characterId, generation)
        const previous = this.getConversationSnapshot(characterId)
        this.publishConversations(characterId, { ...previous, status: 'loading', error: '' })
        try {
          const branches = await this.request('readConversationSettingLibraries', characterId)
          if (!Array.isArray(branches) || branches.some(item => !item || typeof item.sessionId !== 'string'
            || item.library?.characterId !== characterId)) {
            throw new Error('分支设定返回的数据格式不正确。')
          }
          const conversations = branches.length ? await this.bridge.listConversations() : []
          const previews = new Map(conversations.map(item => [item.id, item.preview]))
          const value = branches.map(item => ({ ...item, summary: previews.get(item.sessionId) ?? item.summary }))
          if (!this.disposed && this.conversationGenerations.get(characterId) === generation) {
            this.publishConversations(characterId, { status: 'ready', value, error: '' })
          }
          return value
        } catch (error) {
          if (!this.disposed && this.conversationGenerations.get(characterId) === generation) {
            this.publishConversations(characterId, {
              status: 'error', value: previous.value,
              // 按形状取 message，不用 instanceof：RemoteError 可能是别的 realm 的副本。
              error: typeof error?.message === 'string' && error.message.trim() ? error.message : String(error)
            })
          }
          throw error
        }
      }

      publishConversations(characterId, snapshot) {
        this.conversationSnapshots.set(characterId, snapshot)
        for (const listener of this.listeners) listener('conversations', characterId, snapshot)
      }

      async saveConversation(characterId, sessionId, library) {
        return this.request('saveConversationSettingLibrary', characterId, sessionId, library)
      }

      async resetConversation(characterId, sessionId) {
        return this.request('resetConversationSettingLibrary', characterId, sessionId)
      }

      async saveConversationVersion(characterId, sessionId, name) {
        return this.request('saveConversationSettingLibraryVersion', characterId, sessionId, name)
      }

      refreshLoaded(characterId) {
        super.refreshLoaded(characterId)
        if (characterId) {
          if (this.conversationSnapshots.has(characterId)) void this.readConversations(characterId).catch(failureAlreadyPublished)
          return
        }
        for (const loadedId of this.conversationSnapshots.keys()) {
          void this.readConversations(loadedId).catch(failureAlreadyPublished)
        }
      }

      dispose() {
        super.dispose()
        this.conversationSnapshots.clear()
        this.conversationGenerations.clear()
      }
    }

    class RegexRulesModel extends CharacterConfigurationModel {
      constructor(bridge) {
        super(bridge, 'regexRules', 'readRegexRules', 'saveRegexRules', null,
          (value, characterId) => {
            if (!value || value.characterId !== characterId || !Array.isArray(value.globalRules)
              || !Array.isArray(value.agentPresetRules) || !Array.isArray(value.characterRules)
              || !Array.isArray(value.versions) || !Number.isInteger(value.revision)) {
              throw new Error('正则配置返回的数据格式不正确。')
            }
            return value
          })
      }

      async save(characterId, collection) {
        const generation = this.nextGeneration(characterId)
        const saved = this.validate(await this.request(
          this.saveMethod, characterId, collection, collection.revision
        ), characterId)
        if (!this.disposed && this.generations.get(characterId) === generation) {
          this.publish('configuration', characterId, { status: 'ready', value: saved, error: '' })
        }
        return saved
      }

      async import(characterId, collection, fallbackScope, documents) {
        const generation = this.nextGeneration(characterId)
        const result = await this.request(
          'importRegexRules', characterId, fallbackScope, documents, collection.revision
        )
        const saved = this.validate(result?.collection, characterId)
        if (!this.disposed && this.generations.get(characterId) === generation) {
          this.publish('configuration', characterId, { status: 'ready', value: saved, error: '' })
        }
        return result
      }

      export(characterId, ruleIds) {
        return this.request('exportRegexRules', characterId, ruleIds)
      }

      test(text, rule, target) {
        return this.request('testRegexRule', text, rule, target)
      }

      start() {
        this.stopEvents = this.bridge.subscribe(change => {
          if (change?.kind === 'snapshot') this.refreshLoaded()
          else if (change?.kind === 'configuration'
            && (change.domain === 'regexRules' || change.domain === 'agentPresets')) {
            this.refreshLoaded(change.characterId)
          }
        })
      }
    }

    class RegexEditorsModel extends CharacterConfigurationModel {
      constructor(bridge) {
        super(bridge, 'regexRules', 'readRegexEditor', 'saveRegexEditor', null, (value, key) => {
          const [scope, ownerId] = JSON.parse(key)
          if (!value || value.target?.scope !== scope || value.target?.ownerId !== ownerId
            || !Array.isArray(value.globalRules) || !Array.isArray(value.agentPresetRules)
            || !Array.isArray(value.characterRules) || !Array.isArray(value.versions)
            || !Number.isInteger(value.revision) || typeof value.ownerRevision !== 'string'
            || (scope === 'character' ? value.agentPresetRules.length : value.characterRules.length)) {
            throw new Error('正则编辑配置返回的数据格式不正确。')
          }
          return value
        })
      }
      request(method, ...args) {
        if (method === 'readRegexEditor') {
          const [scope, ownerId] = JSON.parse(args[0])
          return super.request(method, { scope, ownerId })
        }
        return super.request(method, ...args)
      }
      async save(key, collection) {
        this.validate(collection, key)
        const generation = this.nextGeneration(key)
        const saved = this.validate(await this.request('saveRegexEditor', collection), key)
        if (!this.disposed && this.generations.get(key) === generation) this.publish('configuration', key, { status: 'ready', value: saved, error: '' })
        return saved
      }
      async import(key, collection, fallbackScope, documents) {
        this.validate(collection, key)
        const generation = this.nextGeneration(key)
        const result = await this.request('importRegexEditor', collection, fallbackScope, documents)
        const saved = this.validate(result?.collection, key)
        if (!this.disposed && this.generations.get(key) === generation) this.publish('configuration', key, { status: 'ready', value: saved, error: '' })
        return result
      }
      start() {
        this.stopEvents = this.bridge.subscribe(change => {
          if (change?.kind === 'snapshot' || change?.kind === 'configuration'
            && (change.domain === 'regexRules' || change.domain === 'agentPresets')) this.refreshLoaded()
        })
      }
      editor(scope, ownerId) {
        if (!['character', 'preset'].includes(scope) || !ownerId) throw new Error('正则编辑需要明确的角色或预设归属。')
        const key = JSON.stringify([scope, ownerId])
        return {
          getSnapshot: () => this.getSnapshot(key), read: () => this.read(key),
          versions: editorVersionsService(this, this.bridge, 'regex', document => JSON.stringify([document.target.scope, document.target.ownerId])),
          subscribe: listener => this.subscribe((kind, changedKey, snapshot) => { if (kind === 'configuration' && changedKey === key) listener(snapshot) }),
          save: collection => this.save(key, collection),
          import: (collection, fallbackScope, documents) => this.import(key, collection, fallbackScope, documents),
          export: ruleIds => this.request('exportRegexEditor', { scope, ownerId }, ruleIds)
        }
      }
    }

    class ScriptLibrariesModel extends CharacterConfigurationModel {
      constructor(bridge) {
        super(bridge, 'scripts', 'readScriptLibrary', 'saveScriptLibrary', null, (value, key) => {
          const [scope, ownerId] = JSON.parse(key)
          if (!value || value.scope !== scope || value.ownerId !== ownerId || !Array.isArray(value.trees)
            || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.revision)
            || !value.variables || typeof value.variables !== 'object' || Array.isArray(value.variables)) {
            throw new Error('脚本库返回的数据格式不正确。')
          }
          return value
        })
      }
      request(method, ...args) {
        return super.request(method, ...(method === 'readScriptLibrary' ? JSON.parse(args[0]) : [args[1]]))
      }
      refreshLoaded() { super.refreshLoaded() }
    }

    function editorVersionsService(model, bridge, kind, documentKey) {
      function validate(value, scope, ownerId) {
        if (!value || value.kind !== kind || value.scope !== scope || value.ownerId !== ownerId
          || !Number.isSafeInteger(value.revision) || typeof value.resourceRevision !== 'string'
          || typeof value.activeVersionId !== 'string' || !Array.isArray(value.versions)
          || !value.versions.some(version => version.id === value.activeVersionId)
          || value.versions.some(version => typeof version.id !== 'string' || typeof version.name !== 'string' || typeof version.content !== 'string')) {
          throw new Error('配置版本返回的数据或归属不正确。')
        }
        return value
      }
      return {
        subscribe: listener => bridge.subscribe(change => {
          if (change?.kind === 'snapshot' || change?.kind === 'configuration'
            && change.domain === (kind === 'regex' ? 'regexRules' : kind)) listener()
        }),
        async read(scope, ownerId) {
          return validate(await bridge.request('readEditorLibraryVersions', [{ kind, scope, ownerId }]), scope, ownerId)
        },
        async save(documents, versions) {
          const requests = documents.map(document => {
            const key = documentKey(document)
            model.validate(document, key)
            return { key, generation: model.nextGeneration(key) }
          })
          const result = await bridge.request('saveEditorLibraries', [{ kind, documents: documents.map(document => JSON.stringify(document)), versions }])
          if (!Array.isArray(result?.documents) || result.documents.length !== documents.length || !Array.isArray(result.versions)
            || result.versions.length !== versions.length) throw new Error('配置版本保存结果不完整。')
          const saved = result.documents.map((content, index) => model.validate(JSON.parse(content), requests[index].key))
          const storedVersions = result.versions.map((value, index) => validate(value, versions[index].scope, versions[index].ownerId))
          if (!model.disposed) saved.forEach((value, index) => {
            const { key, generation } = requests[index]
            if (model.generations.get(key) === generation) model.publish('configuration', key, { status: 'ready', value, error: '' })
          })
          return { documents: saved, versions: storedVersions }
        },
      }
    }

    function scriptLibraryService(model, bridge) {
      const key = (scope, ownerId) => JSON.stringify([scope, ownerId])
      return {
        versions: editorVersionsService(model, bridge, 'scripts', document => key(document.scope, document.ownerId)),
        getSnapshot: (scope, ownerId) => model.getSnapshot(key(scope, ownerId)),
        read: (scope, ownerId) => model.read(key(scope, ownerId)),
        save: library => model.save(key(library.scope, library.ownerId), library),
        async openDirectory(scope, ownerId) {
          const workspace = await bridge.request('readScriptWorkspace', [scope, ownerId])
          const result = await bridge.remote.session.openWorkspacePath({ path: workspace.path })
          unwrapOrFail(result, '打开脚本目录失败。')
        },
        async saveAll(libraries) {
          const requests = libraries.map(library => {
            const address = key(library.scope, library.ownerId)
            return { address, generation: model.nextGeneration(address) }
          })
          const saved = await bridge.request('saveScriptLibraries', [libraries])
          if (!Array.isArray(saved) || saved.length !== requests.length) throw new Error('批量保存脚本库返回的数据格式不正确。')
          const values = saved.map((library, index) => model.validate(library, requests[index].address))
          if (!model.disposed) values.forEach((value, index) => {
            const { address, generation } = requests[index]
            if (model.generations.get(address) === generation) model.publish('configuration', address, { status: 'ready', value, error: '' })
          })
          return values
        },
        subscribe: listener => model.subscribe((kind, address, snapshot) => {
          const [scope, ownerId] = JSON.parse(address)
          listener(scope, ownerId, snapshot)
        }),
        subscribeChanges: listener => bridge.subscribe(change => {
          if (change?.kind === 'snapshot' || change?.kind === 'configuration'
            && ['scripts', 'agentPresets'].includes(change.domain)) listener()
        }),
        async activePreset() {
          const catalog = await bridge.remote.eleckoiAgentPresets.catalog()
          unwrapOrFail(catalog, '读取当前预设失败。')
          const preset = catalog.value.presets.find(item => item.id === catalog.value.activePresetIds.roleplay)
          if (!preset) throw new Error('当前预设不在预设目录中。')
          return { id: preset.id, name: preset.name }
        },
      }
    }

    class DisplayTemplatesModel extends CharacterConfigurationModel {
      constructor(bridge) {
        super(bridge, 'displayTemplates', 'readDisplayTemplates', 'saveDisplayTemplates', null, (value, address) => {
          const [scope, ownerId] = JSON.parse(address)
          if (scope === 'selection') {
            if (!value || value.characterId !== ownerId || !Array.isArray(value.libraries) || value.libraries.length !== 3
              || value.libraries[0]?.scope !== 'global' || value.libraries[0]?.ownerId !== ''
              || value.libraries[1]?.scope !== 'preset' || !value.libraries[1]?.ownerId
              || value.libraries[2]?.scope !== 'character' || value.libraries[2]?.ownerId !== ownerId
              || value.libraries.some(library => typeof library.enabled !== 'boolean' || !Array.isArray(library.templates)
                || !Number.isSafeInteger(library.revision) || library.revision < 0)) throw new Error('显示模板组合归属不匹配。')
            const previous = this.getSnapshot(address).value
            if (previous?.characterId === value.characterId && previous.libraries.every((library, index) =>
              library.scope === value.libraries[index].scope && library.ownerId === value.libraries[index].ownerId
                && library.revision === value.libraries[index].revision)) return previous
          } else if (!value || value.scope !== scope || value.ownerId !== ownerId || !Array.isArray(value.templates)
            || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('显示模板配置归属或格式不正确。')
          return value
        })
      }
      request(method, address, value) {
        if (this.disposed) throw new Error('显示模板客户端模型已关闭。')
        const [scope, ownerId] = JSON.parse(address)
        if (method === 'saveDisplayTemplates') return this.bridge.request(method, [value])
        return scope === 'selection' ? this.bridge.request('displayTemplatesForCharacter', [ownerId])
          : this.bridge.request(method, [scope, ownerId])
      }
      start() {
        this.stopEvents = this.bridge.subscribe(change => {
          if (change?.kind === 'snapshot' || change?.kind === 'configuration'
            && ['displayTemplates', 'agentPresets'].includes(change.domain)) this.refreshLoaded()
        })
      }
      async saveAll(libraries) {
        if (this.disposed) throw new Error('显示模板客户端模型已关闭。')
        const addresses = libraries.map(library => JSON.stringify([library.scope, library.ownerId]))
        const generations = addresses.map(address => this.nextGeneration(address))
        const values = await this.bridge.request('saveDisplayTemplateLibraries', [libraries])
        if (!Array.isArray(values) || values.length !== libraries.length) throw new Error('显示模板保存结果不完整。')
        return values.map((value, index) => {
          const saved = this.validate(value, addresses[index])
          if (!this.disposed && this.generations.get(addresses[index]) === generations[index]) this.publish('configuration', addresses[index], { status: 'ready', value: saved, error: '' })
          return saved
        })
      }
    }

    function displayTemplateService(model, bridge) {
      const key = (scope, ownerId) => JSON.stringify([scope, ownerId])
      return {
        versions: editorVersionsService(model, bridge, 'displayTemplates', document => key(document.scope, document.ownerId)),
        read: (scope, ownerId) => model.read(key(scope, ownerId)),
        save: library => model.save(key(library.scope, library.ownerId), library),
        saveAll: libraries => model.saveAll(libraries),
        getSnapshot: (scope, ownerId) => model.getSnapshot(key(scope, ownerId)),
        readSelection: characterId => model.read(key('selection', characterId)),
        getSelectionSnapshot: characterId => model.getSnapshot(key('selection', characterId)),
        subscribe: listener => model.subscribe((_kind, address, snapshot) => {
          const [scope, ownerId] = JSON.parse(address)
          listener(scope, ownerId, snapshot)
        }),
      }
    }

    function apply(ctx) {
      const bridge = new CharacterConfigurationBridge(ctx.remote)
      const settingLibraries = new SettingLibrariesModel(bridge)
      const variables = new CharacterConfigurationModel(
        bridge, 'variables', 'readVariableConfig', 'saveVariableConfig',
        'saveVariableConfigViewState', (value, characterId) => {
          if (!value || value.characterId !== characterId || !Array.isArray(value.objects)
            || !Array.isArray(value.variables) || !Array.isArray(value.versions)) {
            throw new Error('变量配置返回的数据格式不正确。')
          }
          return value
        }
      )
      const regexRules = new RegexRulesModel(bridge)
      const regexEditors = new RegexEditorsModel(bridge)
      regexRules.editor = (scope, ownerId) => regexEditors.editor(scope, ownerId)
      const scripts = new ScriptLibrariesModel(bridge)
      const displayTemplates = new DisplayTemplatesModel(bridge)
      ctx.provide('eleckoiSettingLibraries', settingLibraries)
      ctx.provide('eleckoiVariables', variables)
      ctx.provide('eleckoiRegexRules', regexRules)
      ctx.provide('eleckoiScriptLibraries', scriptLibraryService(scripts, bridge))
      ctx.provide('eleckoiDisplayTemplates', displayTemplateService(displayTemplates, bridge))
      ctx.effect(() => {
        settingLibraries.start()
        variables.start()
        regexRules.start()
        regexEditors.start()
        scripts.start()
        displayTemplates.start()
        bridge.start()
        const stopReset = ctx.on('connection/reset', () => {
          settingLibraries.refreshLoaded()
          variables.refreshLoaded()
          regexRules.refreshLoaded()
          regexEditors.refreshLoaded()
          scripts.refreshLoaded()
          displayTemplates.refreshLoaded()
        })
        return () => {
          stopReset()
          bridge.dispose()
          settingLibraries.dispose()
          variables.dispose()
          regexRules.dispose()
          regexEditors.dispose()
          scripts.dispose()
          displayTemplates.dispose()
        }
      }, 'eleckoi: character configuration models')
    }

    return { inject: ['remote', 'remote.session', 'remote.eleckoiCharacters', 'remote.eleckoiConversations', 'remote.eleckoiCharacterConfiguration', 'remote.eleckoiAgentPresets'], apply }
  }
})
