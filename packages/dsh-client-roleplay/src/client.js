window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-roleplay',
  factory(require) {
    const React = require('react')

    function RoleplayView({ matched, sessions, SessionProvider, renderSlot, renderSlotChain }) {
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
        renderRoleplaySlot: active ? renderSlot : undefined,
        renderRoleplayMessage: active ? (owner, fallback) => renderSlotChain(
          'eleckoi.roleplay.message.content', owner, { fallback }
        ) : undefined
      })
      return active ? React.createElement(SessionProvider, { session: reference }, view) : view
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        const projectConversationSeat = (source, target) => {
          ctx.slots.inject(target, () => {
            const projected = new Map()
            const adapt = entry => function ConversationSeatEntry(ownerProps) {
              if (source !== 'conversation.composer.dock') return React.createElement(entry.component, ownerProps)
              const { generationStats, ...props } = ownerProps
              const useProjection = key => {
                const value = props.useProjection(key)
                if (key === 'sessionStats') return generationStats ?? { turns: 0, steps: 0 }
                if (key === 'tokenUsage') return generationStats?.tokenUsage
                return value
              }
              return React.createElement(entry.component, { ...props, useProjection })
            }
            const sync = () => {
              const spec = ctx.slots.spec(source)
              const entries = spec?.kind === 'list' && spec.scope === 'session'
                ? ctx.slots.entriesOfSlot(source).filter(entry =>
                  !entry.children || Object.keys(entry.children).length === 0
                )
                : []
              const current = new Set(entries)
              for (const [entry, dispose] of projected) {
                if (current.has(entry)) continue
                dispose()
                projected.delete(entry)
              }
              for (const entry of entries) {
                if (projected.has(entry)) continue
                const options = {
                  ...entry.options,
                  name: target,
                  id: `dsh:${source}:${entry.options.id}`,
                  ...(entry.inject ? { inject: entry.inject } : {}),
                  ...(entry.store ? { store: entry.store } : {}),
                  ...(entry.locale ? { locale: entry.locale } : {}),
                  ...(entry.registrant ? { registrant: entry.registrant } : {})
                }
                projected.set(entry, ctx.slots.register(options, adapt(entry)))
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
            'eleckoi.roleplay.message.content': { kind: 'chain', scope: 'session' },
            'eleckoi.roleplay.message.actions': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.message.after': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.input.left': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.input.right': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.input.overlay': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.composer.dock': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.input.left': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.input.right': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.input.overlay': { kind: 'list', scope: 'session' },
            'eleckoi.roleplay.conversation.composer.dock': { kind: 'list', scope: 'session' }
          },
          inject: () => ({ sessions: ctx.sessions }),
          select: owner => owner?.component ? owner : null
        }, RoleplayView))
        projectConversationSeat('conversation.input.left', 'eleckoi.roleplay.conversation.input.left')
        projectConversationSeat('conversation.input.right', 'eleckoi.roleplay.conversation.input.right')
        projectConversationSeat('conversation.input.overlay', 'eleckoi.roleplay.conversation.input.overlay')
        projectConversationSeat('conversation.composer.dock', 'eleckoi.roleplay.conversation.composer.dock')
      }
    }
  }
})
