window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-character-configuration',
  factory() {
    const idle = { status: 'idle', value: null, error: '' }

    class CharacterConfigurationModel {
      constructor(bridge, moduleName, readRoute, saveRoute, viewStateRoute, validate) {
        this.bridge = bridge
        this.moduleName = moduleName
        this.readRoute = readRoute
        this.saveRoute = saveRoute
        this.viewStateRoute = viewStateRoute
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

      async request(name, input) {
        if (this.disposed) throw new Error('角色配置客户端模型已关闭。')
        const result = await this.bridge.request(name, input)
        if (!result?.ok) throw new Error(result?.error?.message || '读取角色配置失败。')
        return result.data
      }

      async read(characterId) {
        const generation = this.nextGeneration(characterId)
        const previous = this.getSnapshot(characterId)
        this.publish('configuration', characterId, { ...previous, status: 'loading', error: '' })
        try {
          const value = this.validate(await this.request(this.readRoute, { characterId }), characterId)
          if (!this.disposed && this.generations.get(characterId) === generation) {
            this.publish('configuration', characterId, { status: 'ready', value, error: '' })
          }
          return value
        } catch (error) {
          if (!this.disposed && this.generations.get(characterId) === generation) {
            this.publish('configuration', characterId, {
              status: 'error', value: previous.value,
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async readUntracked(characterId) {
        return this.validate(await this.request(this.readRoute, { characterId }), characterId)
      }

      async save(characterId, value) {
        const generation = this.nextGeneration(characterId)
        const field = this.moduleName === 'settingLibraries' ? 'library' : 'config'
        const saved = this.validate(await this.request(this.saveRoute, { characterId, [field]: value }), characterId)
        if (!this.disposed && this.generations.get(characterId) === generation) {
          this.publish('configuration', characterId, { status: 'ready', value: saved, error: '' })
        }
        return saved
      }

      async saveViewState(characterId, expandedIds) {
        const field = this.moduleName === 'settingLibraries' ? 'expandedGroupIds' : 'expandedObjectIds'
        const saved = await this.request(this.viewStateRoute, { characterId, [field]: expandedIds })
        const snapshot = this.getSnapshot(characterId)
        if (snapshot.value) {
          this.publish('configuration', characterId, {
            ...snapshot, value: { ...snapshot.value, [field]: saved }
          })
        }
        return saved
      }

      refreshLoaded() {
        for (const characterId of this.snapshots.keys()) void this.read(characterId).catch(() => {})
      }

      start() {
        this.stopEvents = this.bridge.subscribe(event => {
          if (event?.name === 'records.changed' && event.payload?.module === this.moduleName) this.refreshLoaded()
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
        super(bridge, 'settingLibraries', 'query.setting_library.read', 'command.setting_library.save',
          'command.setting_library.view_state.save', (value, characterId) => {
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

      async readConversations(characterId) {
        const generation = (this.conversationGenerations.get(characterId) || 0) + 1
        this.conversationGenerations.set(characterId, generation)
        const previous = this.getConversationSnapshot(characterId)
        this.publishConversations(characterId, { ...previous, status: 'loading', error: '' })
        try {
          const value = await this.request('query.setting_library.conversations', { characterId })
          if (!Array.isArray(value) || value.some(item => !item || typeof item.sessionId !== 'string'
            || item.library?.characterId !== characterId)) {
            throw new Error('动态设定返回的数据格式不正确。')
          }
          if (!this.disposed && this.conversationGenerations.get(characterId) === generation) {
            this.publishConversations(characterId, { status: 'ready', value, error: '' })
          }
          return value
        } catch (error) {
          if (!this.disposed && this.conversationGenerations.get(characterId) === generation) {
            this.publishConversations(characterId, {
              status: 'error', value: previous.value,
              error: error instanceof Error ? error.message : String(error)
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
        return this.request('command.setting_library.conversation.save', { characterId, sessionId, library })
      }

      async resetConversation(characterId, sessionId) {
        return this.request('command.setting_library.conversation.reset', { characterId, sessionId })
      }

      async saveConversationVersion(characterId, sessionId, name) {
        return this.request('command.setting_library.conversation.save_version', { characterId, sessionId, name })
      }

      refreshLoaded() {
        super.refreshLoaded()
        for (const characterId of this.conversationSnapshots.keys()) {
          void this.readConversations(characterId).catch(() => {})
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
        super(bridge, 'regexRules', 'query.regex_rules.read', 'command.regex_rules.save', null,
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
        const saved = this.validate(await this.request(this.saveRoute, {
          characterId, collection, expectedRevision: collection.revision
        }), characterId)
        if (!this.disposed && this.generations.get(characterId) === generation) {
          this.publish('configuration', characterId, { status: 'ready', value: saved, error: '' })
        }
        return saved
      }

      async import(characterId, collection, fallbackScope, documents) {
        const generation = this.nextGeneration(characterId)
        const result = await this.request('command.regex_rules.import', {
          characterId, fallbackScope, documents, expectedRevision: collection.revision
        })
        const saved = this.validate(result?.collection, characterId)
        if (!this.disposed && this.generations.get(characterId) === generation) {
          this.publish('configuration', characterId, { status: 'ready', value: saved, error: '' })
        }
        return result
      }

      export(characterId, ruleIds) {
        return this.request('command.regex_rules.export', { characterId, ruleIds })
      }

      test(text, rule, target) {
        return this.request('command.regex_rules.test', { text, rule, target })
      }

      start() {
        this.stopEvents = this.bridge.subscribe(event => {
          if (event?.name === 'records.changed'
            && (event.payload?.module === 'regexRules' || event.payload?.module === 'agentPresets')) {
            this.refreshLoaded()
          }
        })
      }
    }

    function apply(ctx) {
      const bridge = window.eleckoi
      const settingLibraries = new SettingLibrariesModel(bridge)
      const variables = new CharacterConfigurationModel(
        bridge, 'variables', 'query.variable_config.read', 'command.variable_config.save',
        'command.variable_config.view_state.save', (value, characterId) => {
          if (!value || value.characterId !== characterId || !Array.isArray(value.objects)
            || !Array.isArray(value.variables) || !Array.isArray(value.versions)) {
            throw new Error('变量配置返回的数据格式不正确。')
          }
          return value
        }
      )
      const regexRules = new RegexRulesModel(bridge)
      ctx.provide('eleckoiSettingLibraries', settingLibraries)
      ctx.provide('eleckoiVariables', variables)
      ctx.provide('eleckoiRegexRules', regexRules)
      ctx.effect(() => {
        settingLibraries.start()
        variables.start()
        regexRules.start()
        const stopReset = ctx.on('connection/reset', () => {
          settingLibraries.refreshLoaded()
          variables.refreshLoaded()
          regexRules.refreshLoaded()
        })
        return () => {
          stopReset()
          settingLibraries.dispose()
          variables.dispose()
          regexRules.dispose()
        }
      }, 'eleckoi: character configuration models')
    }

    return { apply }
  }
})
