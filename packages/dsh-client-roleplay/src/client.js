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
        const open = async () => {
          try {
            if (!sessions.list.getSnapshot().byId[runtimeSessionId]) await sessions.refresh()
            if (!current) return
            retained = sessions.retain(runtimeSessionId, { source: 'mainView' })
            await retained.ready
            if (current) setReference(retained)
          } catch {
            retained?.release()
            retained = undefined
            if (current) setReference(null)
          }
        }
        void open()
        return () => {
          current = false
          retained?.release()
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
            'eleckoi.roleplay.composer.dock': { kind: 'list', scope: 'session' }
          },
          inject: () => ({ sessions: ctx.sessions }),
          select: owner => owner?.component ? owner : null
        }, RoleplayView))
      }
    }
  }
})
