window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-conversations',
  factory(require) {
    const React = require('react')
    const MessagesPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-messages.js')
      .then(module => ({ default: module.MessagesPage })))
    class ConversationCatalog {
      constructor(bridge) {
        this.bridge = bridge
        this.snapshot = { status: 'loading', items: [], error: '' }
        this.listeners = new Set()
        this.detailsSnapshot = { id: '', status: 'idle', details: null, error: '' }
        this.detailsListeners = new Set()
        this.detailGeneration = 0
        this.timelineSnapshot = { id: '', status: 'idle', timeline: null, error: '' }
        this.timelineListeners = new Set()
        this.timelineGeneration = 0
        this.streamSnapshot = { id: '', status: 'idle', runId: '', requestId: '', messageId: '', sequence: 0, content: '', process: [], error: '' }
        this.streamState = this.streamSnapshot
        this.streamListeners = new Set()
        this.streamGeneration = 0
        this.streamFrame = undefined
        this.pendingRun = null
        this.preferredSessions = new Map()
        this.generation = 0
        this.disposed = false
        this.stopEvents = () => {}
      }

      getSnapshot = () => this.snapshot

      subscribe = listener => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      getDetailsSnapshot = () => this.detailsSnapshot

      rememberSession(characterId, sessionId) {
        if (characterId && sessionId) this.preferredSessions.set(characterId, sessionId)
      }

      preferredSession(characterId) {
        return this.preferredSessions.get(characterId) || ''
      }

      forgetSession(characterId, sessionId) {
        if (this.preferredSessions.get(characterId) === sessionId) this.preferredSessions.delete(characterId)
      }

      subscribeDetails = listener => {
        this.detailsListeners.add(listener)
        return () => this.detailsListeners.delete(listener)
      }

      getTimelineSnapshot = () => this.timelineSnapshot

      subscribeTimeline = listener => {
        this.timelineListeners.add(listener)
        return () => this.timelineListeners.delete(listener)
      }

      getStreamSnapshot = () => this.streamSnapshot

      subscribeStream = listener => {
        this.streamListeners.add(listener)
        return () => this.streamListeners.delete(listener)
      }

      publish(next) {
        this.snapshot = next
        for (const listener of this.listeners) listener()
      }

      publishDetails(next) {
        this.detailsSnapshot = next
        for (const listener of this.detailsListeners) listener()
      }

      publishTimeline(next) {
        this.timelineSnapshot = next
        for (const listener of this.timelineListeners) listener()
      }

      publishStream(next, publication = 'immediate') {
        this.streamState = next
        if (publication === 'animation-frame' && typeof requestAnimationFrame === 'function') {
          if (this.streamFrame !== undefined) return
          this.streamFrame = requestAnimationFrame(() => {
            this.streamFrame = requestAnimationFrame(() => {
              this.streamFrame = requestAnimationFrame(() => {
                this.streamFrame = undefined
                this.flushStream()
              })
            })
          })
          return
        }
        this.cancelStreamFrame()
        this.flushStream()
      }

      flushStream() {
        if (this.streamSnapshot === this.streamState) return
        this.streamSnapshot = this.streamState
        for (const listener of this.streamListeners) listener()
      }

      cancelStreamFrame() {
        if (this.streamFrame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.streamFrame)
        this.streamFrame = undefined
      }

      start() {
        this.stopEvents = this.bridge.subscribe(event => {
          if (event?.name === 'records.changed' && event.payload?.module === 'conversations') {
            const generation = this.generation + 1
            const selectedId = this.detailsSnapshot.id
            const timelineId = this.timelineSnapshot.id
            void this.refresh().then(items => {
              if (this.disposed || generation !== this.generation) return
              const available = new Set(items.map(item => item.id))
              if (selectedId && this.detailsSnapshot.id === selectedId) {
                if (available.has(selectedId)) void this.refreshDetails().catch(() => {})
                else this.activate('')
              }
              if (timelineId && this.timelineSnapshot.id === timelineId) {
                if (available.has(timelineId)) void this.refreshTimeline().catch(() => {})
                else this.closeTimeline(timelineId)
              }
            }).catch(() => {})
          } else if (event?.name === 'messages.changed' && event.payload?.conversationId === this.detailsSnapshot.id) {
            if (event.payload.reason === 'deleted' || event.payload.reason === 'regenerated' || event.payload.reason === 'edited') {
              this.invalidateDetails(event.payload.conversationId)
            } else {
              void this.refreshDetails().catch(() => {})
            }
          } else if (event?.name === 'agent.output.delta') {
            this.acceptDelta(event.payload)
          } else if (event?.name === 'agent.process.updated') {
            this.acceptProcess(event.payload)
          } else if (event?.name === 'agent.run.finished' || event?.name === 'agent.run.failed') {
            this.settleStream(event.payload)
            this.acceptRunTerminal(event.name, event.payload)
          } else if (event?.name === 'agent.state.changed' && event.payload?.conversationId === this.detailsSnapshot.id
            && (event.payload.state === 'starting' || event.payload.state === 'streaming')) {
            void this.refreshStream().catch(() => {})
          }
        })
        void this.refresh().catch(() => {})
      }

      restoreConnection() {
        void this.refresh().catch(() => {})
        if (this.detailsSnapshot.id) void this.refreshDetails().catch(() => {})
        if (this.timelineSnapshot.id) void this.refreshTimeline().catch(() => {})
        if (this.streamState.id) void this.refreshStream().catch(() => {})
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 会话目录已关闭。')
        const generation = ++this.generation
        try {
          const result = await this.bridge.request('query.conversations.list', {})
          if (!result?.ok) throw new Error(result?.error?.message || '读取会话列表失败。')
          if (!Array.isArray(result.data) || result.data.some(item => !item || typeof item.id !== 'string')) {
            throw new Error('会话目录返回的数据格式不正确。')
          }
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', items: result.data, error: '' })
          }
          return result.data
        } catch (error) {
          if (!this.disposed && generation === this.generation) {
            this.publish({
              status: 'error',
              items: this.snapshot.items,
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      activate(id) {
        if (this.disposed) return
        if (id === this.detailsSnapshot.id) return
        this.detailGeneration += 1
        this.publishDetails({ id, status: id ? 'loading' : 'idle', details: null, error: '' })
        this.streamGeneration += 1
        this.publishStream({ id, status: 'idle', runId: '', requestId: '', messageId: '', sequence: 0, content: '', process: [], error: '' })
        if (id) void this.refreshStream().catch(() => {})
      }

      async refreshStream() {
        const id = this.streamState.id
        if (this.disposed || !id) return null
        const generation = ++this.streamGeneration
        const result = await this.bridge.request('query.agent.inspect', { conversationId: id })
        if (!result?.ok) throw new Error(result?.error?.message || '恢复实时回复失败。')
        const inspected = result.data
        if (!inspected || inspected.conversationId !== id || typeof inspected.active !== 'boolean') {
          throw new Error('实时回复返回的数据格式不正确。')
        }
        if (this.disposed || generation !== this.streamGeneration || this.streamState.id !== id) return null
        const current = this.streamState
        if (!inspected.active) {
          this.publishStream({ ...current, status: 'idle' })
          return null
        }
        if (typeof inspected.runId !== 'string' || typeof inspected.requestId !== 'string' || typeof inspected.messageId !== 'string'
          || typeof inspected.accumulated !== 'string' || !Number.isInteger(inspected.sequence)) {
          throw new Error('实时回复返回的数据格式不正确。')
        }
        if (current.runId === inspected.runId && current.sequence > inspected.sequence) return current
        const next = {
          id, status: 'running', runId: inspected.runId, requestId: inspected.requestId, messageId: inspected.messageId,
          sequence: inspected.sequence, content: inspected.accumulated,
          process: current.runId === inspected.runId ? current.process : [], error: ''
        }
        this.publishStream(next)
        return next
      }

      acceptDelta(event) {
        if (this.disposed || !event || event.conversationId !== this.streamState.id || !event.runId) return
        const current = this.streamState
        const sameRun = current.runId === event.runId
        if (sameRun && current.status !== 'running') return
        const previous = sameRun ? current : {
          id: event.conversationId, status: 'running', runId: event.runId, requestId: '', messageId: event.messageId,
          sequence: 0, content: '', process: [], error: ''
        }
        if (!sameRun) this.streamGeneration += 1
        if (!Number.isInteger(event.sequence) || event.sequence <= previous.sequence) return
        if (event.sequence !== previous.sequence + 1) {
          this.publishStream(previous, 'animation-frame')
          void this.refreshStream().catch(() => {})
          return
        }
        this.publishStream({ ...previous, status: 'running', sequence: event.sequence, content: previous.content + event.delta }, 'animation-frame')
      }

      acceptProcess(event) {
        if (this.disposed || !event || event.conversationId !== this.streamState.id || !event.runId) return
        const current = this.streamState
        const sameRun = current.runId === event.runId
        if (sameRun && current.status !== 'running') return
        if (!sameRun) this.streamGeneration += 1
        const previous = sameRun ? current : {
          id: event.conversationId, status: 'running', runId: event.runId, requestId: '', messageId: event.messageId,
          sequence: 0, content: '', process: [], error: ''
        }
        const process = [...previous.process]
        if (event.item?.id) {
          const index = process.findIndex(item => item.id === event.item.id)
          if (index < 0) process.push(event.item)
          else process[index] = event.item
        }
        this.publishStream({ ...previous, status: 'running', process }, 'animation-frame')
        if (!sameRun) void this.refreshStream().catch(() => {})
      }

      settleStream(event) {
        if (this.disposed || !event || event.conversationId !== this.streamState.id) return
        const current = this.streamState
        if (current.runId && current.runId !== event.runId) return
        this.streamGeneration += 1
        this.publishStream({
          ...current, runId: event.runId || current.runId,
          status: event.code ? 'error' : 'idle',
          error: event.code ? event.message || '生成失败。' : ''
        })
        if (this.detailsSnapshot.id === event.conversationId) void this.refreshDetails().catch(() => {})
        if (this.timelineSnapshot.id === event.conversationId) void this.refreshTimeline().catch(() => {})
      }

      async cancelStream(expectedRunId) {
        let current = this.streamState
        if (this.disposed || current.status !== 'running' || !current.runId || current.runId !== expectedRunId) return false
        if (!current.requestId) {
          await this.refreshStream()
          current = this.streamState
          if (current.status !== 'running' || current.runId !== expectedRunId || !current.requestId) return false
        }
        const result = await this.bridge.request('command.agent.cancel', {
          conversationId: current.id, requestId: current.requestId, runId: current.runId
        })
        if (!result?.ok) throw new Error(result?.error?.message || '停止生成失败。')
        return Boolean(result.data?.cancelled)
      }

      acceptRunTerminal(name, event) {
        const pending = this.pendingRun
        if (!pending || !event || pending.conversationId !== event.conversationId) return
        if (!pending.runId) {
          pending.queued.push({ name, event })
          return
        }
        if (pending.runId === event.runId) pending.resolve({ name, event })
      }

      async run(command, input) {
        if (this.disposed || this.pendingRun || !input?.conversationId || !input.requestId
          || (command !== 'command.agent.start' && command !== 'command.agent.regenerate')) {
          throw new Error('无法开始这次回复。')
        }
        let resolveTerminal
        const terminal = new Promise(resolve => { resolveTerminal = resolve })
        const pending = { conversationId: input.conversationId, runId: '', queued: [], resolve: resolveTerminal }
        this.pendingRun = pending
        try {
          const result = await this.bridge.request(command, input)
          if (!result?.ok) throw new Error(result?.error?.message || '生成请求失败。')
          if (!result.data?.accepted || typeof result.data.runId !== 'string') {
            throw new Error('生成请求返回的数据格式不正确。')
          }
          if (this.disposed) throw new Error('会话客户端已关闭。')
          pending.runId = result.data.runId
          const queued = pending.queued.find(item => item.event.runId === pending.runId)
          if (queued) pending.resolve(queued)
          const settled = await terminal
          if (settled.name === 'disposed') throw new Error('会话客户端已关闭。')
          if (settled.name === 'agent.run.failed') throw new Error(settled.event.message || '生成失败。')
          const details = this.detailsSnapshot.id === input.conversationId
            ? await this.refreshDetails()
            : await this.bridge.request('query.conversations.details', { conversationId: input.conversationId })
          const value = details?.ok === true ? details.data : details
          return {
            details: this.assertDetails(value, input.conversationId),
            cancelled: settled.event.message?.status === 'cancelled'
          }
        } finally {
          if (this.pendingRun === pending) this.pendingRun = null
        }
      }

      async cancelRequest(conversationId, requestId) {
        if (this.disposed || !conversationId || !requestId) return false
        const result = await this.bridge.request('command.agent.cancel', { conversationId, requestId })
        if (!result?.ok) throw new Error(result?.error?.message || '停止生成失败。')
        return Boolean(result.data?.cancelled)
      }

      invalidateDetails(id) {
        if (this.disposed || !id || id !== this.detailsSnapshot.id) return
        const runtimeSessionId = this.detailsSnapshot.details?.runtimeSessionId || this.detailsSnapshot.runtimeSessionId || ''
        this.detailGeneration += 1
        this.publishDetails({ id, status: 'loading', details: null, runtimeSessionId, error: '' })
        void this.refreshDetails().catch(() => {})
      }

      assertDetails(value, id) {
        if (!value || value.conversation?.id !== id || !Array.isArray(value.messages)
          || value.messages.some(message => !message || typeof message.id !== 'string')) {
          throw new Error('会话详情返回的数据格式不正确。')
        }
        return value
      }

      mergeTail(previous, incoming) {
        if (!previous || !incoming.messages.length) return incoming
        const firstSequence = incoming.messages.reduce((first, message) =>
          Number.isInteger(message.sequence) ? Math.min(first, message.sequence) : first,
        Number.POSITIVE_INFINITY)
        if (!Number.isFinite(firstSequence)) return incoming
        const incomingIds = new Set(incoming.messages.map(message => message.id))
        const retained = previous.messages.filter(message =>
          Number.isInteger(message.sequence) && message.sequence < firstSequence && !incomingIds.has(message.id))
        return retained.length ? {
          ...incoming,
          messages: [...retained, ...incoming.messages],
          hasMore: previous.hasMore,
          beforeSequence: previous.beforeSequence
        } : incoming
      }

      async refreshDetails() {
        const id = this.detailsSnapshot.id
        if (this.disposed || !id) throw new Error('ElecKoi 当前会话不可用。')
        const generation = ++this.detailGeneration
        try {
          const result = await this.bridge.request('query.conversations.details', { conversationId: id })
          if (!result?.ok) throw new Error(result?.error?.message || '读取会话详情失败。')
          const details = this.assertDetails(result.data, id)
          if (!this.disposed && generation === this.detailGeneration && this.detailsSnapshot.id === id) {
            this.publishDetails({
              id, status: 'ready',
              details: this.mergeTail(this.detailsSnapshot.details, details),
              error: ''
            })
          }
          return details
        } catch (error) {
          if (!this.disposed && generation === this.detailGeneration && this.detailsSnapshot.id === id) {
            this.publishDetails({
              ...this.detailsSnapshot,
              status: 'error',
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async open(id) {
        this.activate(id)
        const details = await this.refreshDetails()
        return this.detailsSnapshot.id === id ? details : null
      }

      async pageOlder(expectedId, expectedBeforeSequence) {
        const current = this.detailsSnapshot
        const id = current.id
        const beforeSequence = current.details?.beforeSequence
        if (this.disposed || !id || id !== expectedId || beforeSequence !== expectedBeforeSequence
          || !current.details?.hasMore || !Number.isInteger(beforeSequence)) return null
        const result = await this.bridge.request('query.conversations.messages', {
          conversationId: id, beforeSequence, limit: 50
        })
        if (!result?.ok) throw new Error(result?.error?.message || '读取更早消息失败。')
        const page = result.data
        if (!page || !Array.isArray(page.messages)
          || page.messages.some(message => !message || typeof message.id !== 'string')
          || typeof page.hasMore !== 'boolean'
          || (page.beforeSequence !== null && !Number.isInteger(page.beforeSequence))) {
          throw new Error('更早消息返回的数据格式不正确。')
        }
        const latest = this.detailsSnapshot
        if (this.disposed || latest.id !== id || latest.details?.beforeSequence !== beforeSequence) return null
        const existingIds = new Set(latest.details.messages.map(message => message.id))
        const older = page.messages.filter(message => !existingIds.has(message.id))
        this.publishDetails({
          id, status: 'ready', error: '',
          details: {
            ...latest.details,
            messages: [...older, ...latest.details.messages],
            hasMore: page.hasMore,
            beforeSequence: page.beforeSequence
          }
        })
        return page
      }

      async refreshTimeline() {
        const id = this.timelineSnapshot.id
        if (this.disposed || !id) throw new Error('ElecKoi 当前变量时间线不可用。')
        const generation = ++this.timelineGeneration
        try {
          const result = await this.bridge.request('query.conversations.variable_timeline', { conversationId: id })
          if (!result?.ok) throw new Error(result?.error?.message || '读取变量时间线失败。')
          const timeline = result.data
          if (!timeline || !Array.isArray(timeline.floors)
            || timeline.floors.some(floor => !floor || typeof floor.id !== 'string')) {
            throw new Error('变量时间线返回的数据格式不正确。')
          }
          if (!this.disposed && generation === this.timelineGeneration && this.timelineSnapshot.id === id) {
            this.publishTimeline({ id, status: 'ready', timeline, error: '' })
          }
          return timeline
        } catch (error) {
          if (!this.disposed && generation === this.timelineGeneration && this.timelineSnapshot.id === id) {
            this.publishTimeline({
              ...this.timelineSnapshot,
              status: 'error',
              error: error instanceof Error ? error.message : String(error)
            })
          }
          throw error
        }
      }

      async openTimeline(id) {
        if (this.disposed || !id) return null
        this.timelineGeneration += 1
        this.publishTimeline({ id, status: 'loading', timeline: null, error: '' })
        await this.refreshTimeline()
        return this.timelineSnapshot.id === id && this.timelineSnapshot.status === 'ready'
          ? this.timelineSnapshot.timeline : null
      }

      closeTimeline(id) {
        if (this.disposed || this.timelineSnapshot.id !== id) return
        this.timelineGeneration += 1
        this.publishTimeline({ id: '', status: 'idle', timeline: null, error: '' })
      }

      dispose() {
        if (this.disposed) return
        this.disposed = true
        this.pendingRun?.resolve({ name: 'disposed' })
        this.pendingRun = null
        this.generation += 1
        this.detailGeneration += 1
        this.timelineGeneration += 1
        this.cancelStreamFrame()
        this.stopEvents()
        this.listeners.clear()
        this.detailsListeners.clear()
        this.timelineListeners.clear()
        this.streamListeners.clear()
      }
    }

    function apply(ctx) {
      const catalog = new ConversationCatalog(window.eleckoi)
      ctx.provide('eleckoiConversations', catalog)
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'messages', registrant: '@eleckoi/dsh-client-conversations' },
        () => React.createElement(MessagesPage)))
      const NavigationIcon = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-messages.js')
        .then(module => ({ default: module.NavigationIcon })))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: 'messages', order: -40, label: '消息', registrant: '@eleckoi/dsh-client-conversations'
      }, () => React.createElement(NavigationIcon)))
      ctx.effect(() => {
        catalog.start()
        const stopReset = ctx.on('connection/reset', () => catalog.restoreConnection())
        return () => {
          stopReset()
          catalog.dispose()
        }
      }, 'eleckoi: conversation catalog')
    }

    return { inject: ['slots'], apply }
  }
})
