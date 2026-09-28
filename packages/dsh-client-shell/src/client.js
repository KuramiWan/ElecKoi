window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-shell',
  factory(require) {
    const React = require('react')
    const SettingsPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-settings.js')
      .then(module => ({ default: module.SettingsPage })))
    const CommunityNavigationIcon = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-settings.js')
      .then(module => ({ default: module.CommunityNavigationIcon })))
    const nativeSettingsSections = new Set(['account', 'general', 'models', 'agent-presets'])
    const shellActions = new Set(['community'])
    function ElecKoiSidebar({ renderContent, renderSlot }) {
      return renderContent(renderSlot)
    }
    function ElecKoiRoot({ layout, slots, locale, theme, subscribeTheme, conversations, characters, characterConfiguration, models, persona, presets, renderSlot, renderSlotChain }) {
      const [ProductApp, setProductApp] = React.useState(null)
      const [loadError, setLoadError] = React.useState('')
      const settingsVersion = React.useSyncExternalStore(
        listener => slots.subscribe('settings.section', listener),
        () => slots.getVersion('settings.section')
      )
      const navigationVersion = React.useSyncExternalStore(
        listener => slots.subscribe('sidebar.panellist', listener),
        () => slots.getVersion('sidebar.panellist')
      )
      const footerVersion = React.useSyncExternalStore(
        listener => slots.subscribe('sidebar.footer.action', listener),
        () => slots.getVersion('sidebar.footer.action')
      )
      const mainVersion = React.useSyncExternalStore(
        listener => slots.subscribe('main', listener),
        () => slots.getVersion('main')
      )
      const panelInfo = React.useSyncExternalStore(
        listener => layout.panelInfo.subscribe(listener),
        () => layout.panelInfo.getSnapshot()
      )
      const localeRevision = React.useSyncExternalStore(
        listener => locale.subscribe(listener),
        () => locale.getSnapshot().revision
      )
      const settingsSections = React.useMemo(() => {
        const sections = slots.entriesOfSlot('settings.section').filter(entry =>
          !nativeSettingsSections.has(entry.options.id)
        ).map(entry => ({
          id: entry.options.id,
          order: entry.options.order || 0,
          label: typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label || ''
        }))
        return sections.sort((a, b) => a.order - b.order)
      }, [slots, settingsVersion, localeRevision])
      const navigationItems = React.useMemo(() => {
        const panels = new Set(slots.entriesOfSlot('main').map(entry => entry.options.key))
        return slots.entriesOfSlot('sidebar.panellist')
          .filter(entry => panels.has(entry.options.id) || shellActions.has(entry.options.id))
          .map(entry => ({
            id: entry.options.id,
            order: entry.options.order || 0,
            action: shellActions.has(entry.options.id),
            productIcon: entry.registrant?.startsWith('@eleckoi/') || shellActions.has(entry.options.id),
            label: typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label || entry.options.id
          }))
          .sort((a, b) => a.order - b.order)
      }, [slots, navigationVersion, mainVersion, localeRevision])
      const productPanelIds = React.useMemo(() => slots.entriesOfSlot('main')
        .filter(entry => entry.registrant?.startsWith('@eleckoi/dsh-client-'))
        .map(entry => entry.options.key), [slots, mainVersion])
      const hasSidebarFooterActions = React.useMemo(() =>
        slots.entriesOfSlot('sidebar.footer.action').length > 0, [slots, footerVersion])
      React.useEffect(() => {
        const selected = panelInfo.activePanelId
        const panels = slots.entriesOfSlot('main').map(entry => entry.options.key)
        if (selected && !panels.includes(selected) && panels.length > 0) {
          layout.selectPanel(panels.includes('messages') ? 'messages' : panels[0])
        }
      }, [layout, mainVersion, panelInfo, slots])
      React.useEffect(() => {
        let active = true
        const publish = snapshot => {
          if (!active) return
          const scheme = snapshot.active.colorScheme
          document.documentElement.dataset.theme = scheme
          window.dispatchEvent(new CustomEvent('eleckoi:dsh-theme:state', {
            detail: { preference: snapshot.preference, scheme }
          }))
        }
        const setTheme = event => {
          const mode = event.detail?.mode
          if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return
          try {
            theme.setTheme(mode)
            event.detail.applied = true
          } catch (error) {
            event.detail.error = error instanceof Error ? error.message : String(error)
          }
        }
        const stop = subscribeTheme(snapshot => queueMicrotask(() => publish(snapshot)))
        window.addEventListener('eleckoi:dsh-theme:set', setTheme)
        publish(theme.getTheme())
        return () => {
          active = false
          stop()
          window.removeEventListener('eleckoi:dsh-theme:set', setTheme)
        }
      }, [theme, subscribeTheme])

      React.useEffect(() => {
        const profileBundles = new Set([
          '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless',
          '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-acp-app', '@deepseek-ai/dsh-sdk-minimal',
          '@eleckoi/dsh-client-roleplay'
        ])
        let entry = null
        let face = null
        let navigation = null
        let stopManager = () => {}
        let stopLedger = () => {}
        let stopNavigation = () => {}
        const entries = () => {
          if (!face) return []
          const packages = face.hooks.pluginManager.getSnapshot().packages
            .filter(pkg => !profileBundles.has(pkg.name) && (pkg.installed || pkg.optional || pkg.error !== undefined))
          const official = packages.filter(pkg => pkg.optional && !pkg.installed)
          const installed = packages.filter(pkg => pkg.installed || !pkg.optional)
          const toPackage = (pkg, group) => ({
            id: pkg.name,
            kind: 'package',
            name: pkg.meta?.title === undefined ? pkg.name : face.resolveText(pkg.meta.title) || pkg.name,
            icon: pkg.meta?.icon || '',
            group
          })
          return [
            ...official.map(pkg => toPackage(pkg, 'official')),
            ...face.hooks.configLedger.getSnapshot().items.map(item => ({
              id: item.id, kind: 'item', name: item.label, icon: '', group: 'official'
            })),
            ...installed.map(pkg => toPackage(pkg, 'bundles'))
          ]
        }
        const publish = () => {
          const view = navigation?.getSnapshot?.().view
          window.dispatchEvent(new CustomEvent('eleckoi:dsh-plugins:state', {
            detail: {
              entries: entries(),
              status: face?.hooks.pluginManager.getSnapshot().status || 'loading',
              selected: view?.kind === 'item' ? `item:${view.id}`
                : view?.kind === 'package' ? `package:${view.name}` : ''
            }
          }))
        }
        const bind = () => {
          const next = slots.entriesOfSlot('main').find(item => item.options.key === 'plugins') || null
          if (next === entry) return
          stopManager()
          stopLedger()
          stopNavigation()
          entry = next
          face = next?.inject?.() || null
          navigation = next?.store?.create?.() || null
          if (face) {
            stopManager = face.hooks.pluginManager.subscribe(publish)
            stopLedger = face.hooks.configLedger.subscribe(publish)
          }
          if (navigation?.subscribe) stopNavigation = navigation.subscribe(publish)
          publish()
        }
        const request = () => {
          face?.ensure?.()
          publish()
        }
        const select = event => {
          const { id, kind } = event.detail || {}
          if (!entries().some(item => item.id === id && item.kind === kind)) return
          if (!navigation?.actions?.setView) return
          try {
            layout.selectPanel('plugins')
            navigation.actions.setView(kind === 'item' ? { kind: 'item', id } : { kind: 'package', name: id })
            event.detail.opened = true
          } catch (error) {
            event.detail.error = error instanceof Error ? error.message : String(error)
          }
        }
        const add = event => {
          if (!face?.openInstall || !navigation?.actions?.setView) return
          try {
            layout.selectPanel('plugins')
            navigation.actions.setView({ kind: 'list' })
            face.openInstall()
            if (event.detail) event.detail.opened = true
          } catch (error) {
            if (event.detail) event.detail.error = error instanceof Error ? error.message : String(error)
          }
        }
        window.addEventListener('eleckoi:dsh-plugins:request', request)
        window.addEventListener('eleckoi:dsh-plugins:select', select)
        window.addEventListener('eleckoi:dsh-plugins:add', add)
        const stopSlots = slots.subscribe('main', bind)
        bind()
        return () => {
          stopSlots()
          stopManager()
          stopLedger()
          stopNavigation()
          window.removeEventListener('eleckoi:dsh-plugins:request', request)
          window.removeEventListener('eleckoi:dsh-plugins:select', select)
          window.removeEventListener('eleckoi:dsh-plugins:add', add)
        }
      }, [layout, slots])

      React.useEffect(() => {
        const assets = globalThis.__ELECKOI_CLIENT_ASSETS__
        if (!assets || typeof assets.script !== 'string') {
          setLoadError('ElecKoi 客户端资源未准备好。')
          return
        }
        globalThis.__ELECKOI_DSH_PLATFORM__ = {
          react: React,
          jsxRuntime: require('react/jsx-runtime'),
          reactDom: require('react-dom'),
          reactDomClient: require('react-dom/client')
        }
        const ready = () => {
          if (typeof globalThis.__ELECKOI_DSH_APP__ === 'function') {
            setProductApp(() => globalThis.__ELECKOI_DSH_APP__)
            setLoadError('')
          }
        }
        const failed = event => setLoadError(event.detail || 'ElecKoi 客户端启动失败。')
        window.addEventListener('eleckoi:dsh-app-ready', ready)
        window.addEventListener('eleckoi:dsh-app-failed', failed)
        const style = typeof assets.style === 'string' && !document.querySelector('link[data-eleckoi-styles]')
          ? document.createElement('link') : null
        if (style) {
          style.dataset.eleckoiStyles = ''
          style.rel = 'stylesheet'
          style.href = assets.style
          document.head.append(style)
        }
        ready()
        if (!globalThis.__ELECKOI_DSH_APP__ && !document.querySelector('script[data-eleckoi-script]')) {
          const script = document.createElement('script')
          script.dataset.eleckoiScript = ''
          script.type = 'module'
          script.src = assets.script
          script.onerror = () => setLoadError('ElecKoi 客户端脚本加载失败。')
          document.head.append(script)
        }
        return () => {
          window.removeEventListener('eleckoi:dsh-app-ready', ready)
          window.removeEventListener('eleckoi:dsh-app-failed', failed)
        }
      }, [])

      return React.createElement(React.Fragment, null,
        React.createElement('div', {
          id: 'eleckoi-root',
          style: { position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'auto' }
        }, ProductApp ? React.createElement(ProductApp, {
          conversations, characters, characterConfiguration, models, persona, presets, settingsSections,
          navigation: {
            items: navigationItems,
            productPanelIds,
            hasSidebarFooterActions,
            selectedPanelId: panelInfo.activePanelId,
            selectPanel: id => layout.selectPanel(id),
            renderPanel: id => renderSlot('main', {}, { entryKey: id }),
            renderSidebar: renderContent => renderSlot('sidebar', { renderContent })
          },
          renderSettingsSection: (section, close) => renderSlot('settings.section', { close }, { only: section.id }),
          renderRoleplay: owner => renderSlotChain('eleckoi.roleplay', owner, {
            fallback: React.createElement('section', {
              className: 'chat-panel chat-panel-empty-state',
              'aria-label': '角色聊天插件未启用'
            }, React.createElement('div', { className: 'chat-empty-guide' },
              React.createElement('strong', null, '角色聊天插件未启用')))
          })
        }) : loadError),
        React.createElement('div', {
          className: 'eleckoi-plugin-overlay-seat',
          'data-shell-overlay': true,
          style: { position: 'fixed', inset: 0, zIndex: 20, pointerEvents: 'none' }
        }, renderSlot('shell.overlay', {}))
      )
    }

    function apply(ctx) {
      ctx.effect(() => {
        let panelSnapshot = { activePanelId: 'messages' }
        let navigation = new AbortController()
        const listeners = new Set()
        const panelInfo = {
          getSnapshot: () => panelSnapshot,
          subscribe: listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          }
        }
        const layout = {
          panelInfo,
          selectPanel: id => {
            if (id !== null && !ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)) {
              throw new Error(`layout.selectPanel: main panel "${id}" is not registered`)
            }
            if (panelSnapshot.activePanelId === id) return
            navigation.abort()
            navigation = new AbortController()
            panelSnapshot = { activePanelId: id }
            for (const listener of listeners) listener()
          },
          beginNavigation: () => {
            navigation.abort()
            navigation = new AbortController()
            return navigation.signal
          },
          toggleSidebar: () => {},
          openRightbar: () => {},
          closeRightbar: () => {}
        }
        const stopPanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo } })
        const stopLayout = ctx.reflect.provide('layout', layout)
        const stopRoot = ctx.slots.register({
          name: 'root',
          priority: -1,
          children: {
            sidebar: { kind: 'single', scope: 'root' },
            main: { kind: 'keyed', scope: 'root' },
            rightbar: { kind: 'single', scope: 'root' },
            'shell.overlay': { kind: 'list', scope: 'root' },
            'shell.leading': { kind: 'single', scope: 'root' },
            'settings.section': { kind: 'list', scope: 'root' },
            'settings.general.item': { kind: 'list', scope: 'root' },
            'eleckoi.roleplay': { kind: 'chain', scope: 'root' }
          },
          inject: () => ({ layout, slots: ctx.slots, locale: ctx.locale,
            theme: ctx.theme, subscribeTheme: listener => ctx.on('theme/change', listener),
            conversations: ctx.eleckoiConversations, characters: ctx.eleckoiCharacters,
            characterConfiguration: { settingLibraries: ctx.eleckoiSettingLibraries,
              variables: ctx.eleckoiVariables, regexRules: ctx.eleckoiRegexRules },
            models: ctx.eleckoiModels,
            persona: ctx.eleckoiPersona, presets: ctx.eleckoiPresets })
        }, ElecKoiRoot)
        return () => {
          navigation.abort()
          stopRoot()
          stopPanelInfo()
          void stopLayout()
        }
      }, 'eleckoi client root and layout')

      ctx.slots.inject('sidebar', () => ctx.slots.register({
        name: 'sidebar',
        priority: 100,
        registrant: '@eleckoi/dsh-client-shell',
        children: {
          'sidebar.brand.mark': { kind: 'single', scope: 'root' },
          'sidebar.brand.name': { kind: 'single', scope: 'root' },
          'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
          'sidebar.panellist': { kind: 'list', scope: 'root' },
          'sidebar.workspaces': { kind: 'single', scope: 'root' },
          'sidebar.settings': { kind: 'single', scope: 'root' },
          'sidebar.footer.action': { kind: 'list', scope: 'root' }
        }
      }, ElecKoiSidebar))
      for (const name of ['sidebar.brand.mark', 'sidebar.brand.name', 'sidebar.workspaces', 'sidebar.settings']) {
        ctx.slots.inject(name, () => ctx.slots.register({ name, priority: -100, registrant: '@eleckoi/dsh-client-shell' },
          ({ content }) => content))
      }

      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'settings', registrant: '@eleckoi/dsh-client-shell' },
        () => React.createElement(SettingsPage)))
      ctx.slots.inject('sidebar.panellist', () => [
        ctx.slots.register({
          name: 'sidebar.panellist', id: 'community', order: 20,
          label: '社区', registrant: '@eleckoi/dsh-client-shell'
        }, () => React.createElement(CommunityNavigationIcon))
      ])

      ctx.effect(() => {
        let appliedTokens = []
        const themeColorMeta = document.createElement('meta')
        themeColorMeta.name = 'theme-color'
        const present = snapshot => {
          const scheme = snapshot.active.colorScheme
          document.documentElement.style.colorScheme = scheme
          document.documentElement.dataset.dsThemeSource = snapshot.preference === 'system' ? 'system' : scheme
          document.body.toggleAttribute('data-ds-dark-theme', scheme === 'dark')
          document.body.style.setProperty('--dsh-content-font-size', `${snapshot.fontSize}px`)
          for (const name of appliedTokens) document.body.style.removeProperty(name)
          appliedTokens = Object.keys(snapshot.active.tokens)
          for (const name of appliedTokens) document.body.style.setProperty(name, snapshot.active.tokens[name])
          themeColorMeta.content = getComputedStyle(document.body).backgroundColor
          if (!themeColorMeta.isConnected) document.head.append(themeColorMeta)
        }
        present(ctx.theme.getTheme())
        const stop = ctx.on('theme/change', present)
        return () => {
          stop()
          document.documentElement.style.removeProperty('color-scheme')
          delete document.documentElement.dataset.dsThemeSource
          document.body.removeAttribute('data-ds-dark-theme')
          document.body.style.removeProperty('--dsh-content-font-size')
          for (const name of appliedTokens) document.body.style.removeProperty(name)
          themeColorMeta.remove()
        }
      }, 'eleckoi client theme presentation')
    }

    return {
      inject: ['slots', 'locale', 'theme', 'eleckoiConversations', 'eleckoiCharacters', 'eleckoiSettingLibraries', 'eleckoiVariables', 'eleckoiRegexRules', 'eleckoiModels', 'eleckoiPersona', 'eleckoiPresets'],
      apply
    }
  }
})
