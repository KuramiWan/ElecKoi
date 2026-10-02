window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-roleplay',
  factory(require) {
    const React = require('react')
    const bridgedComposerChildren = Object.freeze({
      'conversation.approval.detail': 'eleckoi.roleplay.conversation.approval.detail',
      'conversation.plan-review.actions': 'eleckoi.roleplay.conversation.plan-review.actions',
      'conversation.input.attachments': 'eleckoi.roleplay.conversation.input.attachments',
      'conversation.input.overlay': 'eleckoi.roleplay.conversation.input.overlay',
      'conversation.input.permission': 'eleckoi.roleplay.conversation.input.permission',
      'conversation.input.left': 'eleckoi.roleplay.conversation.input.left',
      'conversation.input.plan': 'eleckoi.roleplay.conversation.input.plan',
      'conversation.input.right': 'eleckoi.roleplay.conversation.input.right',
      'conversation.input.model': 'eleckoi.roleplay.conversation.input.model',
      'conversation.input.activity': 'eleckoi.roleplay.conversation.input.activity',
      'conversation.composer.dock': 'eleckoi.roleplay.conversation.composer.dock'
    })

    function RoleplaySessionView({
      matched, sessionId, useSession, useSessionStatus, useInput, renderSlot, renderSlotChain
    }) {
      const session = useSession(snapshot => snapshot)
      const input = useInput(snapshot => snapshot)
      const pendingInteraction = useSessionStatus(snapshot => snapshot.get(sessionId)?.pendingInteraction)
      const renderRoleplayMessage = React.useCallback((owner, content) => renderSlotChain(
        'eleckoi.roleplay.message.content', owner, {
          fallback: content
        }
      ), [renderSlotChain])
      return React.createElement(matched.component, {
        ...matched.props,
        renderRoleplaySlot: renderSlot,
        renderRoleplaySlotChain: renderSlotChain,
        renderRoleplayMessage,
        dshComposerOwner: { sessionId, session, pendingInteraction },
        dshInputZone: { session, input }
      })
    }

    function RoleplayView({ matched, sessions, SessionProvider, renderSlot }) {
      const runtimeSessionId = matched.props.runtimeSessionId
      const [reference, setReference] = React.useState(null)
      React.useEffect(() => {
        if (!runtimeSessionId) {
          setReference(null)
          return undefined
        }
        let current = true
        let retained
        let retryTimer
        let opening = false
        let attempts = 0
        let cancelReady = () => {}
        const waitUntilReady = reference => new Promise((resolve, reject) => {
          let settled = false
          let timer
          const settle = error => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            cancelReady = () => {}
            if (error) reject(error)
            else resolve()
          }
          timer = setTimeout(() => settle(new Error('DSH Session did not become ready')), 10000)
          cancelReady = () => settle(new Error('DSH Session binding closed'))
          Promise.resolve(reference.ready).then(() => settle(), settle)
        })
        const scheduleRetry = () => {
          if (!current || retryTimer !== undefined) return
          const delay = Math.min(250 * (2 ** Math.min(attempts, 4)), 4000)
          retryTimer = setTimeout(() => {
            retryTimer = undefined
            void open()
          }, delay)
        }
        const open = async () => {
          if (!current || opening || retained) return
          opening = true
          try {
            if (!sessions.list.getSnapshot().byId[runtimeSessionId]) await sessions.refresh()
            if (!current) return
            const reference = sessions.retain(runtimeSessionId, { source: 'mainView' })
            retained = reference
            await waitUntilReady(reference)
            if (!current) return
            attempts = 0
            setReference(reference)
          } catch {
            retained?.release()
            retained = undefined
            if (current) {
              setReference(null)
              attempts += 1
            }
          } finally {
            opening = false
            if (current && !retained) scheduleRetry()
          }
        }
        void open()
        return () => {
          current = false
          if (retryTimer !== undefined) clearTimeout(retryTimer)
          cancelReady()
          retained?.release()
          retained = undefined
        }
      }, [runtimeSessionId, sessions])
      const active = Boolean(runtimeSessionId) && reference?.sessionId === runtimeSessionId
      const view = React.createElement(matched.component, {
        ...matched.props,
        renderRoleplaySlot: undefined,
        renderRoleplaySlotChain: undefined,
        renderRoleplayMessage: undefined,
        dshComposerOwner: undefined,
        dshInputZone: undefined
      })
      if (!active) return view
      const scopedView = renderSlot('eleckoi.roleplay.session', { matched }, { fallback: view })
      return React.createElement(SessionProvider, { session: reference }, scopedView)
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        const projectConversationSeat = (source, target, options = {}) => {
          ctx.slots.inject(target, () => {
            const projected = new Map()
            const adapt = entry => function ConversationSeatEntry(ownerProps) {
              if (source === 'conversation.composer.dock' && entry.options.id === 'stats') {
                const adjustment = ownerProps.useProjection('eleckoiHistoryStatsAdjustment')
                if (ownerProps.generationStatsEnabled === false) return null
                const upstreamUseProjection = ownerProps.useProjection
                const useProjection = key => {
                  const value = upstreamUseProjection(key)
                  if (key !== 'sessionStats' || !value) return value
                  if (!adjustment) return value
                  return {
                    ...value,
                    steps: Math.max(0, value.steps - (Number(adjustment.steps) || 0)),
                    turns: Math.max(0, value.turns - (Number(adjustment.turns) || 0))
                  }
                }
                return React.createElement(entry.component, { ...ownerProps, useProjection })
              }
              if (source === 'conversation.composer' || source === 'conversation.composer.bar') {
                const { renderBridgeSlot, ...props } = ownerProps
                const renderSlot = (name, owner, renderOptions) => {
                  const bridged = bridgedComposerChildren[name]
                  return bridged && renderBridgeSlot
                    ? renderBridgeSlot(bridged, owner, renderOptions)
                    : null
                }
                return React.createElement(entry.component, { ...props, renderSlot })
              }
              if (source !== 'conversation.view') return React.createElement(entry.component, ownerProps)
              const { component, ...props } = ownerProps
              const renderSlot = (name, owner) => name === 'conversation.trajectory.images'
                ? ownerProps.renderSlot('eleckoi.roleplay.trajectory.images', owner) : null
              return React.createElement(component || entry.component, { ...props, renderSlot })
            }
            const sync = () => {
              const sourceSpec = ctx.slots.spec(source)
              const targetSpec = ctx.slots.spec(target)
              const sourceEntries = sourceSpec && targetSpec && sourceSpec.scope === targetSpec.scope
                ? ctx.slots.entriesOfSlot(source)
                : []
              const entries = (options.winnerOnly ? sourceEntries.slice(0, 1) : sourceEntries)
                .filter(entry => {
                  if (options.entryId && entry.options.id !== options.entryId) return false
                  if (options.leafOnly && entry.children && Object.keys(entry.children).length > 0) return false
                  return options.include ? options.include(entry) : true
                })
              const current = new Set(entries)
              for (const [entry, dispose] of projected) {
                if (current.has(entry)) continue
                dispose()
                projected.delete(entry)
              }
              for (const entry of entries) {
                if (projected.has(entry)) continue
                const registrationOptions = {
                  name: target,
                  ...(targetSpec.kind === 'list'
                    ? { id: `dsh:${source}:${entry.options.id}` }
                    : targetSpec.kind === 'keyed' ? { key: entry.options.key } : {}),
                  ...(entry.options.order !== undefined ? { order: entry.options.order } : {}),
                  ...(entry.options.label !== undefined ? { label: entry.options.label } : {}),
                  ...(entry.options.priority !== undefined ? { priority: entry.options.priority } : {}),
                  ...(entry.select ? { select: entry.select } : {}),
                  ...(entry.inject ? { inject: entry.inject } : {}),
                  ...(entry.store ? { store: entry.store } : {}),
                  ...(entry.locale ? { locale: entry.locale } : {}),
                  ...(entry.registrant ? { registrant: entry.registrant } : {})
                }
                projected.set(entry, ctx.slots.register(registrationOptions, adapt(entry)))
              }
            }
            const unsubscribe = ctx.slots.subscribe(source, sync)
            sync()
            return () => {
              unsubscribe()
              for (const dispose of projected.values()) dispose()
            }
          })
        }

        ctx.slots.inject('eleckoi.roleplay', () => ctx.slots.register({
          name: 'eleckoi.roleplay',
          priority: 100,
          children: {
            'eleckoi.roleplay.session': { kind: 'single', scope: 'session' }
          },
          inject: () => ({ sessions: ctx.sessions }),
          select: owner => owner?.component ? owner : null
        }, RoleplayView))
        ctx.slots.inject('eleckoi.roleplay.session', () => ctx.slots.register({
          name: 'eleckoi.roleplay.session',
          children: {
            'eleckoi.roleplay.message.content': { kind: 'chain', scope: 'session' },
            'eleckoi.roleplay.message.actions': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.message.after': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.header.corner': { kind: 'single', scope: 'session' },
            'eleckoi.roleplay.conversation.input.left': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.input.right': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.input.overlay': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.input.dock': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
            'eleckoi.roleplay.conversation.input.permission': { kind: 'single', scope: 'session' },
            'eleckoi.roleplay.conversation.input.plan': { kind: 'single', scope: 'session' },
            'eleckoi.roleplay.conversation.input.model': { kind: 'single', scope: 'session' },
            'eleckoi.roleplay.conversation.input.activity': { kind: 'single', scope: 'session' },
            'eleckoi.roleplay.conversation.composer.dock': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.composer': { kind: 'chain', scope: 'session' },
            'eleckoi.roleplay.conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
            'eleckoi.roleplay.conversation.approval.detail': { kind: 'single', scope: 'session' },
            'eleckoi.roleplay.conversation.plan-review.actions': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.trajectory.images': { kind: 'single', scope: 'session' },
            'eleckoi.roleplay.trajectory': { kind: 'single', scope: 'session' }
          }
        }, RoleplaySessionView))
        projectConversationSeat('conversation.session.header.corner', 'eleckoi.roleplay.conversation.header.corner', {
          winnerOnly: true
        })
        projectConversationSeat('conversation.composer', 'eleckoi.roleplay.conversation.composer')
        projectConversationSeat('conversation.composer.bar', 'eleckoi.roleplay.conversation.composer.bar', {
          winnerOnly: true
        })
        projectConversationSeat('conversation.input.left', 'eleckoi.roleplay.conversation.input.left', { leafOnly: true })
        projectConversationSeat('conversation.input.right', 'eleckoi.roleplay.conversation.input.right', { leafOnly: true })
        projectConversationSeat('conversation.input.overlay', 'eleckoi.roleplay.conversation.input.overlay', { leafOnly: true })
        projectConversationSeat('conversation.input.dock', 'eleckoi.roleplay.conversation.input.dock', { leafOnly: true })
        projectConversationSeat('conversation.input.attachments', 'eleckoi.roleplay.conversation.input.attachments', { leafOnly: true })
        projectConversationSeat('conversation.input.permission', 'eleckoi.roleplay.conversation.input.permission', { leafOnly: true })
        projectConversationSeat('conversation.input.plan', 'eleckoi.roleplay.conversation.input.plan', { leafOnly: true })
        projectConversationSeat('conversation.input.model', 'eleckoi.roleplay.conversation.input.model', { leafOnly: true })
        projectConversationSeat('conversation.input.activity', 'eleckoi.roleplay.conversation.input.activity', { leafOnly: true })
        projectConversationSeat('conversation.composer.dock', 'eleckoi.roleplay.conversation.composer.dock', { leafOnly: true })
        projectConversationSeat('conversation.approval.detail', 'eleckoi.roleplay.conversation.approval.detail', { leafOnly: true })
        projectConversationSeat('conversation.plan-review.actions', 'eleckoi.roleplay.conversation.plan-review.actions', { leafOnly: true })
        projectConversationSeat('conversation.trajectory.images', 'eleckoi.roleplay.trajectory.images')
        projectConversationSeat('conversation.view', 'eleckoi.roleplay.trajectory', { entryId: 'trajectory' })
      }
    }
  }
})
