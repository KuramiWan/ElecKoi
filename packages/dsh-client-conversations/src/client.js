window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-conversations',
  factory(require) {
    const React = require('react')
    const MessagesPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-messages.js')
      .then(module => ({ default: module.MessagesPage })))

    const contentText = content => Array.isArray(content)
      ? content.filter(block => block?.type === 'text').map(block => String(block.text || '')).join('')
      : ''

    const assistantText = blocks => Array.isArray(blocks)
      ? blocks.filter(block => block?.kind === 'text').map(block => String(block.text || '')).join('')
      : ''

    const FinalOpenTag = '<FINAL>'
    const FinalCloseTag = '</FINAL>'

    const removeLeadingLineBreak = value => value.replace(/^(?:\r\n|\r|\n)/, '')
    const removeTrailingLineBreak = value => value.replace(/(?:\r\n|\r|\n)$/, '')

    function withoutPartialFinalClose(value) {
      for (let length = FinalCloseTag.length - 1; length > 0; length -= 1) {
        if (value.endsWith(FinalCloseTag.slice(0, length))) {
          return removeTrailingLineBreak(value.slice(0, -length))
        }
      }
      return value
    }

    function finalReplyText(value) {
      const markerIndex = value.indexOf(FinalOpenTag)
      if (markerIndex < 0) return value
      const content = removeLeadingLineBreak(value.slice(markerIndex + FinalOpenTag.length))
      const closingIndex = content.indexOf(FinalCloseTag)
      return removeTrailingLineBreak(closingIndex < 0 ? content : content.slice(0, closingIndex))
    }

    function liveFinalReply(value) {
      const markerIndex = value.indexOf(FinalOpenTag)
      if (markerIndex < 0) return { started: false, content: '' }
      const content = removeLeadingLineBreak(value.slice(markerIndex + FinalOpenTag.length))
      const closingIndex = content.indexOf(FinalCloseTag)
      return {
        started: true,
        content: closingIndex < 0
          ? withoutPartialFinalClose(content)
          : removeTrailingLineBreak(content.slice(0, closingIndex))
      }
    }

    const processText = content => Array.isArray(content)
      ? content.map(block => block?.type === 'text' ? String(block.text || '') : JSON.stringify(block)).join('\n')
      : ''

    const processKind = name => name === 'subagent' || name === 'subagent_fork' ? 'subagent' : 'tool'

    const orderedChatNodes = snapshot => Array.isArray(snapshot?.order)
      ? snapshot.order.map(key => snapshot.nodes?.get(key)).filter(Boolean)
      : []

    function nodeTurn(node) {
      const turn = node?.location?.kind === 'step' || node?.location?.kind === 'turn'
        ? node.location.turn?.turn : node?.data?.turn
      return Number.isSafeInteger(turn) && turn > 0 ? Number(turn) : undefined
    }

    function projectedUserTurn(nodes, index) {
      const direct = nodeTurn(nodes[index])
      if (direct !== undefined) return direct
      // User nodes are not stamped with a turn by DSH. A completed tail is
      // the authoritative boundary for the queued inputs immediately before
      // it; if there is no later tail, the input is still outside a turn.
      for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
        const candidate = nodes[cursor]
        if (candidate?.kind !== 'turn-tail') continue
        const turn = nodeTurn(candidate)
        if (turn !== undefined) return turn
      }
      return undefined
    }

    function toolProcess(block, parentId = '') {
      if (!block?.callId) return []
      const settled = block.kind === 'tool-result'
      const name = settled ? block.call?.name || block.callId : block.name || block.callId
      const item = {
        id: String(block.callId), kind: processKind(name),
        status: settled ? block.isError ? 'error' : 'complete' : 'running',
        toolName: name,
        arguments: settled ? block.call?.argsRaw || '' : block.argsRaw || '',
        summary: name,
        detail: settled ? processText(block.content) || block.error?.reason || block.error?.code || '' : '',
        startedAtMillis: Number(settled ? block.callTime : block.time) || 0,
        ...(settled ? { completedAtMillis: Number(block.time) || 0 } : {}),
        ...(parentId ? { parentId } : {})
      }
      return [item, ...(block.subCalls || []).flatMap(child => toolProcess(child, item.id))]
    }

    function officialProcess(snapshot) {
      const byTurn = new Map()
      const append = (turn, item) => {
        if (!Number.isSafeInteger(turn) || turn < 0) return
        const items = byTurn.get(turn) || []
        const index = items.findIndex(candidate => candidate.id === item.id)
        if (index < 0) byTurn.set(turn, [...items, item])
        else byTurn.set(turn, items.map((candidate, at) => at === index ? item : candidate))
      }
      const nodes = orderedChatNodes(snapshot)
      for (const node of nodes) {
        const turn = node.location?.kind === 'step' || node.location?.kind === 'turn'
          ? node.location.turn.turn : node.data?.turn
        if (node.kind === 'assistant-step') {
          const blocks = node.data?.blocks || []
          const hasToolCall = blocks.some(block => block?.kind === 'tool-call')
          blocks.forEach((block, index) => {
            if (block?.kind === 'reasoning' && block.text) append(turn, {
              id: `reasoning:${turn}:${node.data?.step ?? 0}:${index}`,
              kind: 'reasoning', status: node.data?.status === 'running' ? 'running' : 'complete',
              toolName: 'reasoning', arguments: '', summary: '', detail: block.text,
              startedAtMillis: Number(node.data?.time) || 0,
            })
            if (hasToolCall && block?.kind === 'text' && block.text) append(turn, {
              id: `narrative:${turn}:${node.data?.step ?? 0}:${index}`,
              kind: 'narrative', status: node.data?.status === 'running' ? 'running' : 'complete',
              toolName: 'assistant_narrative', arguments: '', summary: block.text, detail: block.text,
              startedAtMillis: Number(node.data?.time) || 0,
            })
          })
        }
        if (node.kind === 'tool-call') {
          for (const item of toolProcess(node.data?.root)) append(turn, item)
        }
      }
      return byTurn
    }

    function mergedProcess(product = [], official = []) {
      const items = [...product]
      for (const item of official) {
        const index = items.findIndex(candidate => candidate.id === item.id)
        if (index < 0) items.push(item)
        else items[index] = { ...items[index], ...item }
      }
      return items
    }

    const inputImages = content => Array.isArray(content) ? content.flatMap(block => {
      const attachment = block?.type === 'image' ? block.attachment : null
      return attachment?.attachmentId ? [{ ...attachment }] : []
    }) : []

    const inputFiles = content => Array.isArray(content) ? content.flatMap(block => {
      const attachment = block?.type === 'file' ? block.attachment : null
      return attachment?.attachmentId ? [{ ...attachment }] : []
    }) : []

    async function waitForOfficialSession(session, eventSource, requestId) {
      return new Promise((resolve, reject) => {
        let settled = false
        const disposers = []
        const finish = (error, value) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          for (const dispose of disposers) dispose()
          if (error) reject(error)
          else resolve(value)
        }
        const timeout = setTimeout(() => {
          finish(new Error('等待 DSH 会话完成超时。'))
        }, 10 * 60 * 1000)
        const check = () => {
          if (settled) return
          const snapshot = session.getSnapshot()
          if (snapshot?.promptError?.op === 'send') {
            finish(new Error(snapshot.promptError.error?.message || '生成失败。'))
            return
          }
          // Agent execution errors arrive separately from prompt admission and journal frames.
          if (snapshot?.lastAgentError) {
            finish(new Error(snapshot.lastAgentError))
            return
          }
          if (snapshot?.openError || snapshot?.removed) {
            finish(new Error(snapshot.openError?.message || 'DSH 会话已关闭。'))
            return
          }
          if (snapshot?.running) return
          const events = (eventSource.getSnapshot()?.entries || [])
            .filter(entry => entry.type === 'event').map(entry => entry.event)
          const userIndex = events.findLastIndex(event => event.type === 'user/message'
            && event.data?.source?.kind === 'user' && event.data.source.rpcId === requestId)
          if (userIndex < 0) return
          const ended = events.slice(userIndex + 1).find(event => event.type === 'turn/end')
          if (!ended) return
          const reason = ended.data?.reason
          if (reason?.kind === 'error') finish(new Error(reason.error?.message || snapshot.lastAgentError || '生成失败。'))
          else finish(null, { cancelled: reason?.kind === 'aborted' || reason?.kind === 'interrupted' })
        }
        disposers.push(session.subscribe(check), eventSource.subscribe(check))
        check()
      })
    }

    function officialMessages(snapshot, details, runtimeSessionId, processByTurn = new Map()) {
      if (!snapshot) return details?.messages || []
      const nodes = orderedChatNodes(snapshot)
      const projected = nodes.flatMap((node, nodeIndex) => {
        if (node.kind === 'user' || node.kind === 'steering') {
          const input = node.data
          const dshTurn = projectedUserTurn(nodes, nodeIndex)
          return [{
            role: 'user', seq: input.seq, time: input.time, content: contentText(input.content),
            images: inputImages(input.content), files: inputFiles(input.content), dshMessageId: input.messageId || '',
            sessionEventSeq: input.seq,
            // `null` is intentional: this official user node is still outside
            // a DSH turn. An omitted field remains compatible with legacy
            // product-only fixtures until their session is rebound.
            dshTurn: dshTurn ?? null
          }]
        }
        if (node.kind !== 'turn-tail' || !node.data?.closing) return []
        const tail = node.data
        const closing = tail.closing
        const finalNode = closing.finalNode
        return [{
          role: 'assistant', seq: finalNode.seq, time: finalNode.time, content: assistantText(closing.blocks),
          displayContent: finalReplyText(assistantText(closing.blocks)),
          dshMessageId: finalNode.messageId || '', interrupted: finalNode.interrupted === true,
          usage: closing.usage, turnUsage: tail.tokenUsage, sessionEventSeq: finalNode.seq, dshTurn: tail.turn
        }]
      })
      projected.sort((left, right) => {
        const leftSeq = Number.isFinite(left.seq) ? left.seq : Number.MAX_SAFE_INTEGER
        const rightSeq = Number.isFinite(right.seq) ? right.seq : Number.MAX_SAFE_INTEGER
        if (leftSeq !== rightSeq) return leftSeq - rightSeq
        return Number(left.time || 0) - Number(right.time || 0)
      })
      const product = Array.isArray(details?.messages) ? details.messages : []
      const opening = product.filter(message => message.id === 'opening')
      const candidates = product.filter(message => message.id !== 'opening')
      const matched = new Map()
      const claimedCandidates = new Set()
      for (let index = 0; index < projected.length; index += 1) {
        const item = projected[index]
        const sourceIndex = candidates.findIndex(candidate => !claimedCandidates.has(candidate)
          && candidate.role === item.role
          && ((item.dshMessageId && candidate.dshMessageId === item.dshMessageId)
            || candidate.sessionEventSeq === item.seq))
        if (sourceIndex >= 0) {
          const source = candidates[sourceIndex]
          claimedCandidates.add(source)
          matched.set(index, source)
        }
      }
      for (let index = 0; index < projected.length; index += 1) {
        if (matched.has(index)) continue
        const source = candidates.find(candidate => !claimedCandidates.has(candidate)
          && !candidate.dshMessageId
          && candidate.role === projected[index].role
          // Older product rows may not have a DSH id yet. Content equality is
          // the only safe fallback; role-only matching attaches an old row to
          // an unrelated current DSH event and makes rewind target the wrong
          // message.
          && typeof candidate.content === 'string'
          && candidate.content === projected[index].content)
        if (source) { claimedCandidates.add(source); matched.set(index, source) }
      }
      const visible = projected.map((item, index) => {
        const source = matched.get(index)
        const id = source?.id || item.dshMessageId || `dsh-${runtimeSessionId}-${item.seq}-${item.role}`
        const runtimeVariableState = item.role === 'assistant' && Number.isSafeInteger(item.dshTurn)
          ? details?.runtimeVariableStateByTurn?.[String(item.dshTurn)]
          : undefined
        const message = {
          ...(source || {}), id, conversationId: details?.conversation?.id || source?.conversationId || '',
          ...(Number.isInteger(source?.productSequence ?? source?.sequence) ? { productSequence: source.productSequence ?? source.sequence } : {}),
          runtimeSessionId, dshMessageId: item.dshMessageId || source?.dshMessageId || '',
          sessionEventSeq: item.sessionEventSeq,
          ...(Object.prototype.hasOwnProperty.call(item, 'dshTurn') && item.dshTurn === null ? { dshTurn: null } : {}),
          ...(item.role === 'assistant' && Number.isSafeInteger(item.dshTurn) ? {
            dshTurn: item.dshTurn,
            renderKey: `dsh-reply-${runtimeSessionId}-${item.dshTurn}`
          } : {}),
          // `sequence` is the durable DSH event position. `messageIndex` is only
          // the current visible list position and must be rebuilt after sorting.
          sequence: item.seq, messageIndex: index,
          role: item.role, content: item.content,
          // Product projection owns an explicit display value, including an
          // intentional empty result. Only an unmapped live message uses the
          displayContent: source?.content === item.content && typeof source.displayContent === 'string'
            ? source.displayContent
            : item.displayContent ?? item.content,
          // The DSH turn is the stable identity after regeneration. Its
          // checkpoint is the exact post-reply state used by the old renderer;
          // product-row metadata is only a fallback for pre-checkpoint history.
          variableStateJson: runtimeVariableState || source?.variableStateJson || '{}',
          createdAt: source?.createdAt || new Date(item.time || Date.now()).toISOString(),
          status: item.pending ? 'streaming' : item.interrupted ? 'cancelled' : 'complete',
          process: mergedProcess(source?.process, processByTurn.get(item.dshTurn)),
          ...(item.turnUsage || source?.turnUsage ? { turnUsage: item.turnUsage || source.turnUsage } : {}),
          ...(item.images?.length ? { inputImageAttachments: item.images } : {}),
          ...(item.files?.length ? { inputFileAttachments: item.files } : {})
        }
        const hasAttachments = Boolean(message.inputImageAttachments?.length || message.inputFileAttachments?.length)
        const hasProcess = Array.isArray(message.process) && message.process.length > 0
        const hasText = String(message.content || '').trim().length > 0
        return { message, keep: hasText || hasAttachments || hasProcess || message.status === 'streaming' }
      }).filter(item => item.keep).map(item => item.message)
      const anchor = visible.findIndex(message => Number.isSafeInteger(matched.get(projected.findIndex(item => item.seq === message.sequence))?.messageIndex))
      const firstFloor = !details?.hasMore || anchor < 0 ? opening.length : Math.max(opening.length,
        matched.get(projected.findIndex(item => item.seq === visible[anchor].sequence)).messageIndex - anchor)
      return [...opening, ...visible.map((message, index) => ({ ...message, messageIndex: firstFloor + index }))]
    }

    class ConversationCatalog {
      constructor(remote, sessions, uiConversation, fileUpload, regexRules) {
        this.remote = remote
        this.sessions = sessions
        this.uiConversation = uiConversation
        this.fileUpload = fileUpload
        this.regexRules = regexRules
        this.snapshot = { status: 'loading', items: [], error: '' }
        this.listeners = new Set()
        this.detailsSnapshot = { id: '', status: 'idle', details: null, error: '' }
        this.detailsListeners = new Set()
        this.modelSelectionSnapshot = { provider: '', model: '' }
        this.modelSelectionListeners = new Set()
        this.detailGeneration = 0
        this.timelineSnapshot = { id: '', status: 'idle', timeline: null, error: '' }
        this.timelineListeners = new Set()
        this.timelineGeneration = 0
        this.streamSnapshot = { id: '', status: 'idle', runId: '', requestId: '', messageId: '', sequence: 0, content: '', process: [], error: '' }
        this.streamState = this.streamSnapshot
        this.streamListeners = new Set()
        this.streamGeneration = 0
        this.streamFrame = undefined
        this.preferredSessions = new Map()
        this.selectionWriteQueue = Promise.resolve()
        this.sessionReference = null
        this.sessionTarget = null
        this.stopSessionTarget = () => {}
        this.stopSessionState = () => {}
        this.stopProjections = () => {}
        this.statsSnapshot = { id: '', stats: null }
        this.latestStatsSnapshot = this.statsSnapshot
        this.statsListeners = new Set()
        this.sessionBindingGeneration = 0
        this.activeRequests = new Map()
        this.nativeInputHandler = null
        this.sessionMutations = new Map()
        this.generation = 0
        this.disposed = false
        this.changeFeedAbort = null
        this.changeFeed = null
        this.stopEvents = () => {}
        this.stopRegexRules = () => {}
        this.displayProjectionKey = ''
        this.displayProjectionGeneration = 0
        this.displayProjectionResults = null
        this.officialProjectionSignature = null
      }

      getSnapshot = () => this.snapshot

      subscribe = listener => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      getDetailsSnapshot = () => this.detailsSnapshot

      getStatsSnapshot = () => this.statsSnapshot

      subscribeStats = listener => {
        this.statsListeners.add(listener)
        return () => this.statsListeners.delete(listener)
      }

      publishStats(id, stats) {
        this.latestStatsSnapshot = { id, stats }
        const request = this.activeRequests.get(id)
        if (request?.statsPending) {
          // Rewound baseline counts belong to the retained prefix. Hand off
          // the display only when the new run records its first settled step.
          if (request.statsBaselineSteps === undefined
            || !(stats?.sessionStats?.steps > request.statsBaselineSteps)) return
          request.statsPending = false
        }
        this.statsSnapshot = { id, stats }
        for (const listener of this.statsListeners) listener()
      }

      async readImage(conversationId, attachment) {
        if (this.disposed || !attachment?.attachmentId) throw new Error('图片不可用。')
        const runtimeSessionId = this.runtimeSessionId(conversationId)
          || (this.detailsSnapshot.id === conversationId ? this.detailsSnapshot.runtimeSessionId : '')
        if (!runtimeSessionId) throw new Error('当前聊天缺少 DSH Session。')
        if (this.detailsSnapshot.id === conversationId) await this.bindOfficialSession(conversationId)
        return this.uiConversation.imageUrl(runtimeSessionId, attachment)
      }

      rememberSession(characterId, sessionId) {
        if (characterId && sessionId) this.preferredSessions.set(characterId, sessionId)
      }

      preferredSession(characterId) {
        return this.preferredSessions.get(characterId) || ''
      }

      forgetSession(characterId, sessionId) {
        if (this.preferredSessions.get(characterId) === sessionId) this.preferredSessions.delete(characterId)
      }

      normalizeSelection(value) {
        const preferred = value?.preferred_sessions
        return {
          active_conversation_id: typeof value?.active_conversation_id === 'string' ? value.active_conversation_id : '',
          preferred_sessions: preferred && typeof preferred === 'object' && !Array.isArray(preferred)
            ? Object.fromEntries(Object.entries(preferred).filter(([key, item]) => key && typeof item === 'string' && item))
            : {}
        }
      }

      unwrap(result, fallback) {
        if (!result?.ok) throw new Error(result?.error?.message || fallback)
        return result.value
      }

      async readSelection() {
        const document = this.unwrap(await this.remote.settings.describe(), '读取当前聊天记录失败。')
        const namespace = document?.namespaces?.find(item => item.ns === 'eleckoi-client-conversations')
        return this.normalizeSelection(namespace?.value?.selection)
      }

      saveSelection(value) {
        const selection = this.normalizeSelection(value)
        const operation = this.selectionWriteQueue.then(async () => {
          const document = this.unwrap(await this.remote.settings.describe(), '读取聊天选择状态失败。')
          const namespace = document?.namespaces?.find(item => item.ns === 'eleckoi-client-conversations')
          this.unwrap(await this.remote.settings.mutate('eleckoi-client-conversations', [{
            op: 'set', path: ['selection'], value: selection
          }], namespace?.revision), '保存当前聊天记录失败。')
          return selection
        })
        this.selectionWriteQueue = operation.catch(() => {})
        return operation
      }

      async readModelSelection(conversationId) {
        const selected = this.unwrap(
          await this.remote.eleckoiConversationModels.current(conversationId),
          '读取全局模型失败。'
        )
        this.publishModelSelection(selected)
        return selected
      }

      async readAuthorState(conversationId) {
        if (!conversationId) throw new Error('请先打开一个聊天。')
        return this.unwrap(
          await this.remote.eleckoiConversations.authorState(conversationId),
          '读取作者接口上下文失败。'
        )
      }

      async exportArchive(conversationId) {
        if (!conversationId) throw new Error('请选择要导出的聊天记录。')
        return this.unwrap(
          await this.remote.eleckoiConversations.exportArchive(conversationId),
          '导出聊天记录失败。'
        )
      }

      async importArchive(characterId, json) {
        if (!characterId) throw new Error('请先选择角色，再导入聊天记录。')
        return this.unwrap(
          await this.remote.eleckoiConversations.importArchive(characterId, json),
          '导入聊天记录失败。'
        )
      }

      async revealFile(conversationId, attachmentId, name) {
        if (!conversationId) throw new Error('当前聊天不可用。')
        this.unwrap(
          await this.remote.eleckoiConversations.revealFile(conversationId, attachmentId, name),
          '无法在文件管理器中显示该文件。'
        )
      }

      async readTrajectory(conversationId) {
        if (!conversationId) throw new Error('请先打开一个聊天。')
        if (conversationId !== this.detailsSnapshot.id) await this.open(conversationId)
        await this.bindOfficialSession(conversationId)
        const binding = this.sessionReference?.binding
        if (!binding) throw new Error('当前聊天的 DSH Session 尚未就绪。')
        const target = this.uiConversation.binding(binding).target('trajectory')
        const snapshot = target.getSnapshot()
        if (!snapshot) throw new Error('DSH 轨迹投影尚未就绪。')
        return snapshot
      }

      async replaceAuthorVariableState(conversationId, state) {
        if (!conversationId) throw new Error('请先打开一个聊天。')
        const stateJson = JSON.stringify(state)
        const saved = this.unwrap(
          await this.remote.eleckoiConversations.replaceVariableState(conversationId, stateJson),
          '保存作者接口变量失败。'
        )
        if (this.timelineSnapshot.id === conversationId) void this.refreshTimeline().catch(() => {})
        return JSON.parse(saved || '{}')
      }

      async selectModel(conversationId, selection) {
        const selected = this.unwrap(
          await this.remote.eleckoiConversationModels.select(conversationId, selection),
          '保存全局模型失败。'
        )
        this.publishModelSelection(selected)
        return selected
      }

      getModelSelectionSnapshot = () => this.modelSelectionSnapshot

      subscribeModelSelection = listener => {
        this.modelSelectionListeners.add(listener)
        return () => this.modelSelectionListeners.delete(listener)
      }

      publishModelSelection(selection) {
        this.modelSelectionSnapshot = { ...selection }
        for (const listener of this.modelSelectionListeners) listener()
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

      publishDetails(next, officialProjectionSignature = null) {
        const request = this.activeRequests.get(next.id)
        if (Number.isSafeInteger(request?.rewindEventSeq) && next.details) {
          // The selected input owns the visible branch while the Host rewinds.
          // A refresh of the retiring Session must not put its old replies back.
          const messages = next.details.messages.filter(message => message.id === 'opening'
            || message.sessionEventSeq <= request.rewindEventSeq).map(message =>
            message.role === 'user' && message.sessionEventSeq === request.rewindEventSeq
              && request.replacementMessage != null
              ? { ...message, content: request.replacementMessage, displayContent: request.replacementMessage }
              : message)
          next = { ...next, details: { ...next.details, messages } }
        }
        next = this.applyDisplayProjection(next)
        this.detailsSnapshot = next
        this.officialProjectionSignature = officialProjectionSignature
        for (const listener of this.detailsListeners) listener()
        if (next.status === 'ready' && next.details) this.scheduleDisplayProjection(next.id, next.details)
      }

      displayProjectionInput(messages) {
        return messages.filter(message => typeof message.content === 'string')
          .map(message => ({
            id: message.id,
            role: message.role,
            content: message.content,
            variableStateJson: typeof message.variableStateJson === 'string' ? message.variableStateJson : '{}',
            status: message.status,
            createdAt: message.createdAt
          }))
      }

      applyDisplayProjection(next) {
        if (next.status !== 'ready' || !next.details || !this.displayProjectionResults) return next
        const input = this.displayProjectionInput(next.details.messages || [])
        if (`${next.id}\u0000${JSON.stringify(input)}` !== this.displayProjectionKey) return next
        const byId = new Map(this.displayProjectionResults.map(result => [result?.id, result]))
        let changed = false
        const messages = next.details.messages.map(message => {
          const result = byId.get(message.id)
          if (!result || result.sourceContent !== message.content
            || typeof result.displayContent !== 'string'
            || typeof result.variableStateJson !== 'string') return message
          if (message.displayContent === result.displayContent
            && message.variableStateJson === result.variableStateJson) return message
          changed = true
          return { ...message, displayContent: result.displayContent, variableStateJson: result.variableStateJson }
        })
        return changed ? { ...next, details: { ...next.details, messages } } : next
      }

      scheduleDisplayProjection(id, details) {
        const projectDisplay = this.remote?.eleckoiConversations?.projectDisplay
        if (this.disposed || !id || typeof projectDisplay !== 'function') return
        const input = this.displayProjectionInput(details.messages || [])
        const key = `${id}\u0000${JSON.stringify(input)}`
        if (key === this.displayProjectionKey) return
        this.displayProjectionKey = key
        this.displayProjectionResults = null
        const generation = ++this.displayProjectionGeneration
        void projectDisplay.call(this.remote.eleckoiConversations, id, input).then((response) => {
          const results = this.unwrap(response, '生成消息显示内容失败。')
          if (!Array.isArray(results)) throw new Error('消息显示投影返回的数据格式不正确。')
          const current = this.detailsSnapshot
          if (this.disposed || generation !== this.displayProjectionGeneration
            || current.id !== id || current.status !== 'ready' || !current.details) return
          this.displayProjectionResults = results
          const projected = this.applyDisplayProjection(current)
          if (projected !== current) this.publishDetails(projected)
        }).catch((error) => {
          if (generation === this.displayProjectionGeneration) this.displayProjectionKey = ''
          console.error('ElecKoi 消息显示投影失败：', error)
        })
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
        const controller = new AbortController()
        this.changeFeedAbort = controller
        const remoteStream = typeof this.remote?.$stream === 'function'
          ? this.remote.$stream({
            name: 'ElecKoi conversation changes',
            open: signal => this.remote.eleckoiConversations.changes(signal),
            ended: () => new Error('ElecKoi 会话变更流意外结束。')
          })
          : this.remote.eleckoiConversations.changes(controller.signal)
        this.changeFeed = remoteStream
        void this.consumeChanges(remoteStream)
        this.stopEvents = () => {
          controller.abort()
          if (typeof remoteStream?.dispose === 'function') void remoteStream.dispose()
        }
        if (this.regexRules?.subscribe) {
          this.stopRegexRules = this.regexRules.subscribe((kind, characterId, snapshot) => {
            const current = this.detailsSnapshot
            if (kind !== 'configuration' || snapshot?.status !== 'ready'
              || !current.details || current.details.metadata?.characterId !== characterId) return
            this.displayProjectionKey = ''
            this.scheduleDisplayProjection(current.id, current.details)
          })
        }
      }

      async consumeChanges(stream) {
        try {
          for await (const item of stream) {
            if (this.disposed) return
            const change = item?.value ?? item
            item?.accept?.()
            this.handleChange(change)
          }
        } catch (error) {
          if (!this.disposed && !this.changeFeedAbort?.signal.aborted) {
            console.error('ElecKoi 会话变更流失败：', error)
            void this.refresh().catch(() => {})
          }
        }
      }

      handleChange(change) {
        if (!change || typeof change !== 'object') return
        if (change.kind === 'snapshot' || change.kind === 'catalog') {
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
          return
        }
        if (change.kind !== 'messages' || change.conversationId !== this.detailsSnapshot.id) return
        if (change.reason === 'deleted' || change.reason === 'regenerated' || change.reason === 'edited') {
          this.invalidateDetails(change.conversationId)
        } else {
          void this.refreshDetails().catch(() => {})
        }
      }

      restoreConnection() {
        void this.refresh().catch(() => {})
        if (this.detailsSnapshot.id) void this.refreshDetails().catch(() => {})
        if (this.timelineSnapshot.id) void this.refreshTimeline().catch(() => {})
        if (this.detailsSnapshot.id) void this.bindOfficialSession(this.detailsSnapshot.id).catch(() => {})
      }

      async refresh() {
        if (this.disposed) throw new Error('ElecKoi 会话目录已关闭。')
        const generation = ++this.generation
        try {
          const items = this.unwrap(
            await this.remote.eleckoiConversations.list(),
            '读取会话列表失败。'
          )
          if (!Array.isArray(items) || items.some(item => !item || typeof item.id !== 'string')) {
            throw new Error('会话目录返回的数据格式不正确。')
          }
          if (!this.disposed && generation === this.generation) {
            this.publish({ status: 'ready', items, error: '' })
            if (this.detailsSnapshot.id) void this.bindOfficialSession(this.detailsSnapshot.id).catch(() => {})
          }
          return items
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

      async create(input) {
        const value = this.unwrap(
          await this.remote.eleckoiConversations.create(input),
          '新建聊天失败。'
        )
        const conversationId = value?.conversation?.id
        if (typeof conversationId !== 'string' || !conversationId) throw new Error('新建聊天返回的数据格式不正确。')
        const details = this.assertDetails(value, conversationId)
        await Promise.all([this.refresh(), this.sessions.refresh()])
        return details
      }

      async delete(conversationId) {
        if (!conversationId) return
        if (this.detailsSnapshot.id === conversationId) this.activate('')
        this.unwrap(
          await this.remote.eleckoiConversations.delete(conversationId),
          '删除聊天失败。'
        )
        if (this.timelineSnapshot.id === conversationId) this.closeTimeline(conversationId)
        await Promise.all([this.refresh(), this.sessions.refresh()])
      }

      async selectOpening(conversationId, openingId) {
        if (!conversationId || !openingId) throw new Error('请选择要切换的开场白。')
        const details = this.assertDetails(this.unwrap(
          await this.remote.eleckoiConversations.selectOpening(conversationId, openingId),
          '切换开场白失败。'
        ), conversationId)
        this.acceptMutationDetails(conversationId, details)
        await this.refresh()
        return this.detailsSnapshot.id === conversationId ? this.refreshDetails() : details
      }

      async updateOpening(conversationId, content) {
        if (!conversationId) throw new Error('请先打开一个聊天。')
        const details = this.assertDetails(this.unwrap(
          await this.remote.eleckoiConversations.updateOpening(conversationId, content),
          '修改开场白失败。'
        ), conversationId)
        this.acceptMutationDetails(conversationId, details)
        await this.refresh()
        return this.detailsSnapshot.id === conversationId ? this.refreshDetails() : details
      }

      async editMessage(conversationId, eventSeq, role, content) {
        if (!this.sessions || !this.uiConversation) throw new Error('DSH 会话客户端尚未就绪。')
        await this.mutateSession(conversationId, async () => this.unwrap(
          await this.remote.eleckoiConversations.editMessage(conversationId, eventSeq, role, content),
          '修改消息失败。'
        ))
        await this.sessions.refresh()
        await this.bindOfficialSession(conversationId)
        await this.refreshDetails()
        return this.detailsSnapshot.details
      }

      async deleteMessagesFrom(conversationId, eventSeq, role) {
        if (!this.sessions || !this.uiConversation) throw new Error('DSH 会话客户端尚未就绪。')
        const result = await this.mutateSession(conversationId, async () => this.unwrap(
          await this.remote.eleckoiConversations.deleteMessagesFrom(conversationId, eventSeq, role),
          '删除消息失败。'
        ))
        await this.sessions.refresh()
        await this.bindOfficialSession(conversationId)
        await this.refreshDetails()
        await this.refresh()
        return { ...result, details: this.detailsSnapshot.details }
      }

      acceptMutationDetails(conversationId, details) {
        if (this.detailsSnapshot.id !== conversationId) return
        this.detailGeneration += 1
        const chat = this.sessionTarget?.getSnapshot()
        const runtimeSessionId = details.runtimeSessionId || this.detailsSnapshot.runtimeSessionId || ''
        const hasMore = chat ? Boolean(this.sessionReference.binding.eventSource.getSnapshot().hasMore) : details.hasMore
        const next = { ...details, runtimeSessionId, hasMore,
          messages: chat ? officialMessages(chat, { ...details, hasMore }, runtimeSessionId, officialProcess(chat))
            : details.messages.filter(message => message.id === 'opening') }
        if (chat) next.beforeSequence = next.messages.find(message => message.id !== 'opening')?.sequence ?? null
        this.publishDetails({
          id: conversationId,
          status: 'ready',
          details: next,
          runtimeSessionId,
          error: ''
        })
      }

      activate(id) {
        if (this.disposed) return
        if (id === this.detailsSnapshot.id) return
        this.releaseOfficialSession()
        this.publishStats('', null)
        this.detailGeneration += 1
        const runtimeSessionId = this.runtimeSessionId(id)
        this.publishDetails({ id, status: id ? 'loading' : 'idle', details: null, runtimeSessionId, error: '' })
        this.streamGeneration += 1
        this.publishStream({ id, status: 'idle', runId: '', requestId: '', messageId: '', sequence: 0, content: '', process: [], error: '' })
        if (id) {
          void this.bindOfficialSession(id).catch(() => {})
        }
      }

      runtimeSessionId(id) {
        return this.snapshot.items.find(item => item.id === id)?.runtimeSessionId || ''
      }

      releaseOfficialSession() {
        this.displayProjectionGeneration += 1
        this.displayProjectionKey = ''
        this.displayProjectionResults = null
        this.sessionBindingGeneration += 1
        this.stopSessionTarget()
        this.stopSessionState()
        this.stopProjections()
        this.stopSessionTarget = () => {}
        this.stopSessionState = () => {}
        this.stopProjections = () => {}
        this.sessionTarget = null
        this.officialProjectionSignature = null
        this.sessionReference?.release()
        this.sessionReference = null
      }

      createOfficialProjectionSignature(chat, runtimeSessionId, hasMore) {
        const nodes = orderedChatNodes(chat)
        const closedTurns = new Set(nodes.filter(node => node.kind === 'turn-tail' && node.data?.closing)
          .map(node => nodeTurn(node)).filter(Number.isSafeInteger))
        return {
          runtimeSessionId,
          hasMore,
          // Live assistant/tool nodes belong only to the stream snapshot. They
          // must not invalidate the settled transcript until their turn closes.
          nodes: nodes.filter(node => node.kind === 'user' || node.kind === 'steering'
            || (node.kind === 'turn-tail' && node.data?.closing)
            || ((node.kind === 'assistant-step' || node.kind === 'tool-call')
              && closedTurns.has(nodeTurn(node))))
        }
      }

      sameOfficialProjection(left, right) {
        return left?.runtimeSessionId === right?.runtimeSessionId
          && left?.hasMore === right?.hasMore
          && left?.nodes?.length === right?.nodes?.length
          && left.nodes.every((node, index) => node === right.nodes[index])
      }

      async mutateSession(conversationId, operation) {
        if (this.sessionMutations.has(conversationId)) throw new Error('当前聊天正在修改消息。')
        await this.bindOfficialSession(conversationId)
        let finish
        const settled = new Promise(resolve => { finish = resolve })
        this.sessionMutations.set(conversationId, settled)
        this.detailGeneration += 1
        const reference = this.sessionReference
        this.sessionReference = null
        this.releaseOfficialSession()
        const session = reference?.binding.session
        let stop = () => {}
        let timeout
        const retired = session ? new Promise((resolve, reject) => {
          const check = () => { if (session.getSnapshot().removed) resolve() }
          stop = session.subscribe(check)
          timeout = setTimeout(() => reject(new Error('等待 DSH 会话关闭通知超时。')), 15_000)
          check()
        }) : Promise.resolve()
        void retired.catch(() => {})
        try {
          const result = await operation()
          await retired
          const runtimeSessionId = reference?.sessionId || this.runtimeSessionId(conversationId)
          if (runtimeSessionId) await this.sessions.reloadHistory(runtimeSessionId)
          return result
        } catch (error) {
          // A rejected preflight may keep the writer; a reverted edit replaces it.
          // In either case discard the retired generation before the next action.
          const runtimeSessionId = reference?.sessionId || this.runtimeSessionId(conversationId)
          if (runtimeSessionId) await this.sessions.reloadHistory(runtimeSessionId).catch(() => {})
          throw error
        } finally {
          clearTimeout(timeout)
          stop()
          reference?.release()
          this.detailGeneration += 1
          this.sessionMutations.delete(conversationId)
          finish()
        }
      }

      async bindOfficialSession(id, runtimeSessionIdHint = '') {
        // A rewind closes the Host writer. Catalog and change-feed refreshes
        // must not materialize the next Client generation until it has finished.
        const mutation = this.sessionMutations.get(id)
        if (mutation) await mutation
        if (this.disposed || !id || id !== this.detailsSnapshot.id) return
        const runtimeSessionId = runtimeSessionIdHint || this.runtimeSessionId(id) || this.detailsSnapshot.runtimeSessionId || ''
        if (!runtimeSessionId) return
        if (this.sessionReference?.sessionId === runtimeSessionId && this.sessionTarget) return
        let reference = this.sessionReference?.sessionId === runtimeSessionId ? this.sessionReference : null
        if (!reference) this.releaseOfficialSession()
        const generation = this.sessionBindingGeneration
        if (!reference) {
          if (!this.sessions.list.getSnapshot().byId[runtimeSessionId]) await this.sessions.refresh()
          if (this.disposed || generation !== this.sessionBindingGeneration || id !== this.detailsSnapshot.id) return
          reference = this.sessions.retain(runtimeSessionId, { source: 'mainView' })
          this.sessionReference = reference
        }
        try {
          const binding = await reference.ready
          if (this.disposed || generation !== this.sessionBindingGeneration || id !== this.detailsSnapshot.id) {
            reference.release()
            return
          }
          if (this.sessionTarget) return
          const target = this.uiConversation.binding(binding).target('chat')
          this.sessionTarget = target
          const publish = () => this.acceptOfficialSession(id, runtimeSessionId, binding.session, target)
          this.stopSessionTarget = target.subscribe(publish)
          this.stopSessionState = binding.session.subscribe(publish)
          const projections = ['sessionStats', 'tokenUsage', 'contextPressure', 'contextBreakdown', 'eleckoiHistoryStatsAdjustment']
            .map(key => [key, binding.session.projections?.faceOf(key)])
          const publishProjections = () => {
            if (this.disposed || generation !== this.sessionBindingGeneration || id !== this.detailsSnapshot.id) return
            const stats = Object.fromEntries(projections.map(([key, face]) => [key, face?.getSnapshot()]))
            const adjustment = stats.eleckoiHistoryStatsAdjustment
            delete stats.eleckoiHistoryStatsAdjustment
            if (adjustment && stats.sessionStats) stats.sessionStats = {
              ...stats.sessionStats,
              steps: Math.max(0, stats.sessionStats.steps - (Number(adjustment.steps) || 0)),
              turns: Math.max(0, stats.sessionStats.turns - (Number(adjustment.turns) || 0))
            }
            this.publishStats(id, stats)
          }
          const stops = projections.map(([, face]) => face?.subscribe(publishProjections)).filter(Boolean)
          this.stopProjections = () => { for (const stop of stops) stop() }
          publishProjections()
          publish()
        } catch (error) {
          if (this.sessionReference === reference) this.sessionReference = null
          reference.release()
          throw error
        }
      }

      acceptOfficialSession(id, runtimeSessionId, session, target) {
        if (this.disposed || id !== this.detailsSnapshot.id) return
        const sessionState = session.getSnapshot()
        const chat = target.getSnapshot()
        const details = this.detailsSnapshot.details
        const processByTurn = officialProcess(chat)
        if (details) {
          const hasMore = Boolean(this.sessionReference?.binding.eventSource.getSnapshot().hasMore)
          const signature = this.createOfficialProjectionSignature(chat, runtimeSessionId, hasMore)
          if (!this.sameOfficialProjection(signature, this.officialProjectionSignature)) {
            const next = {
              ...details, runtimeSessionId,
              messages: officialMessages(chat, { ...details, hasMore }, runtimeSessionId, processByTurn),
              hasMore,
            }
            next.beforeSequence = next.messages.find(message => message.id !== 'opening')?.sequence ?? null
            this.publishDetails({ id, status: 'ready', details: next, runtimeSessionId, error: '' }, signature)
          }
        }
        const runningAssistant = orderedChatNodes(chat)
          .findLast(node => node.kind === 'assistant-step' && node.data?.status === 'running')
        const current = this.streamState
        const openTurn = runningAssistant?.data?.turn
          ?? [...(chat?.timeline?.turns?.values?.() || [])].findLast(turn => turn.status === 'open')?.turn
          ?? current.dshTurn
        const sameLiveTurn = current.id === id && current.status === 'running' && current.dshTurn === openTurn
        const projectedReply = liveFinalReply(assistantText(runningAssistant?.data?.blocks))
        const content = projectedReply.started ? projectedReply.content
          : !runningAssistant && sameLiveTurn ? current.content : ''
        const promptError = sessionState.promptError?.op === 'send'
          ? sessionState.promptError.error?.message || '生成失败。'
          : ''
        const executionError = promptError || sessionState.lastAgentError || sessionState.openError?.message
          || (sessionState.removed ? 'DSH 会话已关闭。' : '')
        const turnSettled = sameLiveTurn && Number.isSafeInteger(current.dshTurn)
          && orderedChatNodes(chat).some(node => node.kind === 'turn-tail' && node.data?.turn === current.dshTurn)
        if (executionError) {
          this.publishStream({ ...current, id, runId: runtimeSessionId, status: 'error', error: executionError })
        } else if (turnSettled) {
          this.publishStream({ ...current, status: 'idle', error: '' })
        } else if (sessionState.running) {
          const message = details?.messages?.findLast(item => item.role === 'assistant'
            && item.status === 'streaming' && item.dshTurn === openTurn)
          const process = mergedProcess(message?.process || (sameLiveTurn ? current.process : []), processByTurn.get(openTurn))
          // Activity creates the live row before final text. The body boundary
          // controls only its content, not the visibility of reasoning and tools.
          const hasLiveMessage = projectedReply.started || process.length > 0 || (sameLiveTurn && Boolean(current.messageId))
          this.publishStream({
            id, status: 'running', runId: runtimeSessionId, requestId: '',
            messageId: hasLiveMessage ? message?.id || (sameLiveTurn ? current.messageId : '') || `dsh-live-${runtimeSessionId}` : '',
            renderKey: `dsh-reply-${runtimeSessionId}-${openTurn}`,
            dshTurn: openTurn,
            sequence: current.id === id ? current.sequence + 1 : 1,
            content, process, error: ''
          })
        } else if (!sessionState.running && current.id === id && current.status === 'running') {
          this.publishStream({ ...current, status: 'idle', error: '' })
        }
      }

      async cancelStream(expectedRunId) {
        const current = this.streamState
        if (this.disposed || current.status !== 'running' || !current.runId || current.runId !== expectedRunId) return false
        const session = this.sessionReference?.binding.session
        if (!session) return false
        const result = await session.cancel()
        if (!result?.ok) throw new Error(result?.error?.message || '停止生成失败。')
        return true
      }

      async send(input) {
        if (this.disposed || !input?.conversationId || !input.requestId) throw new Error('无法开始这次回复。')
        if (!this.sessions || !this.uiConversation || !this.remote?.session) {
          throw new Error('DSH 会话客户端尚未就绪。')
        }
        return this.runRequest(input, request => this.runOfficialPrompt(input, request))
      }

      registerNativeInputHandler(handler) {
        if (this.disposed || typeof handler !== 'function') return () => {}
        this.nativeInputHandler = handler
        return () => {
          if (this.nativeInputHandler === handler) this.nativeInputHandler = null
        }
      }

      async sendNativeInput(input) {
        if (input?.signal?.aborted) {
          const error = new Error('生成请求已取消。')
          error.name = 'AbortError'
          throw error
        }
        const conversationId = this.detailsSnapshot.id
        if (!conversationId || this.runtimeSessionId(conversationId) !== input?.sessionId) {
          return { kind: 'error', text: '当前聊天与输入框会话不一致。' }
        }
        if (typeof this.nativeInputHandler !== 'function') {
          return { kind: 'error', text: 'ElecKoi 发送服务尚未就绪。' }
        }
        const outcome = await this.nativeInputHandler({ ...input, conversationId })
        return outcome?.kind === 'success'
          ? outcome
          : { kind: 'error', ...(outcome?.text ? { text: outcome.text } : {}) }
      }

      async regenerate(input) {
        if (this.disposed || !input?.conversationId || !input.requestId) throw new Error('无法重新生成这次回复。')
        if (!this.sessions || !this.uiConversation || !this.remote?.session) {
          throw new Error('DSH 会话客户端尚未就绪。')
        }
        return this.runRequest(input, request => this.runOfficialRegeneration(input, request))
      }

      async runRequest(input, run) {
        if (this.activeRequests.has(input.conversationId)) throw new Error('当前聊天正在生成。')
        const request = { requestId: input.requestId, cancelled: false, session: null }
        this.activeRequests.set(input.conversationId, request)
        this.publishStream({
          id: input.conversationId, status: 'idle', runId: '', requestId: input.requestId,
          messageId: '', sequence: 0, content: '', process: [], error: ''
        })
        try {
          return await run(request)
        } catch (error) {
          if (this.streamState.id === input.conversationId) {
            this.publishStream({ ...this.streamState, status: 'error', error: error.message || String(error) })
          }
          throw error
        } finally {
          if (this.activeRequests.get(input.conversationId) === request) this.activeRequests.delete(input.conversationId)
          if (request.statsPending && this.detailsSnapshot.id === input.conversationId
            && this.latestStatsSnapshot.id === input.conversationId) {
            this.publishStats(input.conversationId, this.latestStatsSnapshot.stats)
          }
        }
      }

      async runOfficialPrompt(input, request) {
        const conversationId = input.conversationId
        const runtimeSessionId = this.runtimeSessionId(conversationId) || this.detailsSnapshot.runtimeSessionId
        if (!runtimeSessionId) throw new Error('当前聊天缺少 DSH Session。')
        await this.unwrap(
          await this.remote.eleckoiConversations.preparePrompt(conversationId, input.text || ''),
          '准备 DSH 会话失败。'
        )
        if (!this.sessionReference || this.sessionReference.sessionId !== runtimeSessionId) {
          await this.bindOfficialSession(conversationId)
        }
        const session = this.sessionReference?.binding.session
        if (!session) throw new Error('当前聊天的 DSH Session 尚未连接。')
        request.session = session
        if (request.cancelled || input.signal?.aborted) {
          return { details: await this.refreshDetails(), cancelled: true }
        }
        const content = []
        if (typeof input.text === 'string' && input.text.length > 0) content.push({ type: 'text', text: input.text })
        for (const image of Array.isArray(input.images) ? input.images : []) {
          if (!image?.data || !image?.mediaType) continue
          content.push({ type: 'image', data: image.data, mediaType: image.mediaType, ...(image.name ? { name: image.name } : {}) })
        }
        for (const file of Array.isArray(input.files) ? input.files : []) {
          if (typeof file !== 'string' || !file) continue
          content.push({ type: 'file', receiptId: file })
        }
        const accepted = await session.prompt(content, input.mode === 'steer' ? 'steer' : 'queue', input.signal, input.requestId)
        if (!accepted?.ok) throw new Error(accepted?.error?.message || '生成请求失败。')
        if (request.cancelled || input.signal?.aborted) this.unwrap(await session.cancel(), '停止生成失败。')
        const completed = await waitForOfficialSession(session, this.sessionReference.binding.eventSource, input.requestId)
        const details = this.detailsSnapshot.id === conversationId
          ? await this.refreshDetails()
          : this.unwrap(await this.remote.eleckoiConversations.details(conversationId, undefined, undefined), '读取会话详情失败。')
        return {
          details: this.assertDetails(details, conversationId),
          cancelled: completed.cancelled || request.cancelled
        }
      }

      async uploadFile(conversationId, file, options = {}) {
        if (this.disposed) throw new Error('ElecKoi 会话目录已关闭。')
        if (!conversationId) throw new Error('请先打开一个聊天。')
        if (!file || typeof file.name !== 'string') throw new Error('请选择有效文件。')
        if (!this.fileUpload) throw new Error('DSH 文件上传服务尚未就绪。')
        if (this.detailsSnapshot.id !== conversationId) await this.open(conversationId)
        const runtimeSessionId = this.runtimeSessionId(conversationId)
          || (this.detailsSnapshot.id === conversationId ? this.detailsSnapshot.runtimeSessionId : '')
          || (this.detailsSnapshot.id === conversationId ? this.detailsSnapshot.details?.runtimeSessionId : '')
        if (!runtimeSessionId) throw new Error('当前聊天缺少 DSH Session。')
        const uploaded = this.unwrap(
          await this.fileUpload.upload(
            runtimeSessionId,
            file,
            file.name,
            options.signal,
            options.onProgress
          ),
          '文件上传失败。'
        )
        if (!uploaded || typeof uploaded.receiptId !== 'string'
          || !uploaded.file || typeof uploaded.file.attachmentId !== 'string') {
          throw new Error('DSH 文件上传服务返回的数据格式不正确。')
        }
        return {
          id: uploaded.receiptId,
          receiptId: uploaded.receiptId,
          attachmentId: uploaded.file.attachmentId,
          name: typeof uploaded.file.name === 'string' && uploaded.file.name ? uploaded.file.name : file.name,
          bytes: Number.isSafeInteger(uploaded.file.bytes) ? uploaded.file.bytes : file.size
        }
      }

      async runOfficialRegeneration(input, request) {
        if (!Number.isSafeInteger(input.eventSeq)) throw new Error('找不到这条输入对应的 DSH 消息。')
        request.statsPending = this.statsSnapshot.id === input.conversationId && Boolean(this.statsSnapshot.stats)
        request.rewindEventSeq = input.eventSeq
        request.replacementMessage = input.replacementMessage
        this.detailGeneration += 1
        this.displayProjectionGeneration += 1
        this.displayProjectionKey = ''
        if (this.detailsSnapshot.id === input.conversationId) this.publishDetails(this.detailsSnapshot)
        let prepared
        try {
          prepared = await this.mutateSession(input.conversationId, async () => this.unwrap(
            await this.remote.eleckoiConversations.regenerateMessage(
              input.conversationId,
              input.eventSeq,
              input.requestId,
              input.replacementMessage == null ? undefined : input.replacementMessage
            ),
            '重新生成失败。'
          ))
        } catch (error) {
          request.rewindEventSeq = undefined
          await (async () => {
            await this.sessions.refresh()
            await this.bindOfficialSession(input.conversationId)
            await this.refreshDetails()
          })().catch(() => {})
          throw error
        } finally {
          request.rewindEventSeq = undefined
        }
        await this.sessions.refresh()
        await this.bindOfficialSession(input.conversationId)
        request.statsBaselineSteps = this.latestStatsSnapshot.stats?.sessionStats?.steps ?? 0
        const session = this.sessionReference?.binding.session
        if (!session || prepared.prepared !== true) throw new Error('重新生成请求未完成 DSH Session 回退。')
        request.session = session
        const cancelled = request.cancelled || input.signal?.aborted === true
        const accepted = this.unwrap(
          await this.remote.eleckoiConversations.startRegeneration(input.conversationId, input.requestId, cancelled),
          '重新生成请求失败。'
        )
        if (cancelled) return { details: await this.refreshDetails(), cancelled: true }
        if (accepted.accepted !== true) throw new Error('重新生成请求未被 DSH Session 接受。')
        if (request.cancelled || input.signal?.aborted) this.unwrap(await session.cancel(), '停止生成失败。')
        const completed = await waitForOfficialSession(session, this.sessionReference.binding.eventSource, input.requestId)
        const details = await this.refreshDetails()
        return {
          details: this.assertDetails(details, input.conversationId),
          cancelled: completed.cancelled || request.cancelled
        }
      }

      async cancelRequest(conversationId, requestId) {
        if (this.disposed || !conversationId || !requestId) return false
        const request = this.activeRequests.get(conversationId)
        if (!request || request.requestId !== requestId) return false
        request.cancelled = true
        if (request.session) this.unwrap(await request.session.cancel(), '停止生成失败。')
        return true
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
          const details = this.assertDetails(this.unwrap(
            await this.remote.eleckoiConversations.details(id, undefined, undefined),
            '读取会话详情失败。'
          ), id)
          const runtimeSessionId = details.runtimeSessionId || this.runtimeSessionId(id)
          if (runtimeSessionId && this.sessions && this.uiConversation) {
            await this.bindOfficialSession(id, runtimeSessionId)
          }
          if (this.disposed || this.detailsSnapshot.id !== id) return null
          const chat = this.sessionTarget?.getSnapshot()
          if (runtimeSessionId && this.sessions && this.uiConversation && !chat) {
            throw new Error('DSH 聊天正文尚未加载。')
          }
          const hasMore = chat ? Boolean(this.sessionReference.binding.eventSource.getSnapshot().hasMore) : details.hasMore
          const projected = chat
            ? { ...details, runtimeSessionId, hasMore,
              messages: officialMessages(chat, { ...details, hasMore }, runtimeSessionId, officialProcess(chat)) }
            : details
          if (chat) projected.beforeSequence = projected.messages.find(message => message.id !== 'opening')?.sequence ?? null
          if (generation === this.detailGeneration) {
            this.publishDetails({
              id, status: 'ready',
              details: chat ? projected : this.mergeTail(this.detailsSnapshot.details, projected),
              runtimeSessionId,
              error: ''
            })
            return this.detailsSnapshot.details
          }
          return projected
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
        const session = this.sessionReference?.binding.session
        const bindingGeneration = this.sessionBindingGeneration
        const metadataSequence = current.details.messages.reduce((first, message) =>
          Number.isInteger(message.productSequence) ? Math.min(first, message.productSequence) : first,
        Number.POSITIVE_INFINITY)
        const [, result] = await Promise.all([
          session?.loadOlder(),
          this.remote.eleckoiConversations.details(id, Number.isFinite(metadataSequence) ? metadataSequence : beforeSequence, 50)
        ])
        const page = this.unwrap(result, '读取更早消息失败。')
        if (!page || !Array.isArray(page.messages)
          || page.messages.some(message => !message || typeof message.id !== 'string')
          || typeof page.hasMore !== 'boolean'
          || (page.beforeSequence !== null && !Number.isInteger(page.beforeSequence))) {
          throw new Error('更早消息返回的数据格式不正确。')
        }
        const latest = this.detailsSnapshot
        if (this.disposed || latest.id !== id || bindingGeneration !== this.sessionBindingGeneration
          || (!session && latest.details?.beforeSequence !== beforeSequence)) return null
        const chat = this.sessionTarget?.getSnapshot()
        if (chat) {
          const metadata = { ...latest.details, messages: [...page.messages, ...latest.details.messages] }
          const hasMore = Boolean(this.sessionReference.binding.eventSource.getSnapshot().hasMore)
          const messages = officialMessages(chat, { ...metadata, hasMore }, latest.runtimeSessionId, officialProcess(chat))
          const next = { ...latest.details, messages, hasMore,
            beforeSequence: messages.find(message => message.id !== 'opening')?.sequence ?? null }
          this.publishDetails({ ...latest, status: 'ready', error: '', details: next })
          return { ...page, messages, hasMore, beforeSequence: next.beforeSequence, replace: true }
        }
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
          const timeline = this.unwrap(
            await this.remote.eleckoiConversations.variableTimeline(id),
            '读取变量时间线失败。'
          )
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
        this.generation += 1
        this.detailGeneration += 1
        this.timelineGeneration += 1
        this.releaseOfficialSession()
        this.publishStats('', null)
        this.cancelStreamFrame()
        this.stopEvents()
        this.stopRegexRules()
        this.changeFeed = null
        this.changeFeedAbort = null
        this.nativeInputHandler = null
        this.listeners.clear()
        this.detailsListeners.clear()
        this.modelSelectionListeners.clear()
        this.timelineListeners.clear()
        this.streamListeners.clear()
        this.statsListeners.clear()
      }
    }

    function apply(ctx) {
      const catalog = new ConversationCatalog(ctx.remote, ctx.sessions, ctx.uiConversation, ctx.fileUpload, ctx.eleckoiRegexRules)
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

    return { inject: ['slots', 'sessions', 'uiConversation', 'fileUpload', 'eleckoiRegexRules', 'remote', 'remote.settings', 'remote.session', 'remote.eleckoiConversationModels', 'remote.eleckoiConversations'], apply }
  }
})
