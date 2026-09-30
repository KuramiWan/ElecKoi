window.__ModuleLoader__.load({
  id: '@eleckoi/dsh-client-shell',
  factory(require) {
    const React = require('react')
    const {
      PluginArtworkDefault,
      StateDot,
      Tag
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const SettingsPage = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-settings.js')
      .then(module => ({ default: module.SettingsPage })))
    const CreatorStudioNavigationIcon = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-settings.js')
      .then(module => ({ default: module.CreatorStudioNavigationIcon })))
    const CommunityNavigationIcon = React.lazy(() => import('dsh-app://app/eleckoi/assets/eleckoi-page-settings.js')
      .then(module => ({ default: module.CommunityNavigationIcon })))
    const nativeSettingsSections = new Set(['account', 'general', 'models', 'agent-presets'])
    const shellActions = new Set(['creatorStudio', 'community'])
    const runningComponent = (id, title, description) => ({ id, title, description, kind: 'runtime' })
    const extensionPoint = (id, title, description) => ({ id, title, description, kind: 'extension' })
    const builtInPlugins = [
      {
        id: 'eleckoi.characters', label: '角色与角色卡', packageName: '@eleckoi/dsh-client-characters',
        description: '提供角色列表、角色卡资料和角色管理入口。',
        components: [
          runningComponent('eleckoiCharacters', '角色目录服务', '读取、刷新并同步角色、角色卡和角色分组。'),
          runningComponent('main#character', '角色主页面', '在 DSH 主界面显示角色列表与角色资料。'),
          runningComponent('sidebar.panellist#character', '角色导航入口', '在桌面侧边栏打开角色主页面。'),
          extensionPoint('eleckoi.character.page.list', '角色列表接入口', '允许插件包装或替换角色列表。'),
          extensionPoint('eleckoi.character.page.profile', '角色资料接入口', '允许插件包装或替换角色资料区域。'),
          extensionPoint('eleckoi.character.editor.card', '角色卡基础资料接入口', '允许插件扩展角色名称、头像和基础资料编辑。'),
          extensionPoint('eleckoi.character.editor.lore', '设定库编辑接入口', '允许插件扩展角色设定库编辑。'),
          extensionPoint('eleckoi.character.editor.variables', '变量编辑接入口', '允许插件扩展角色变量编辑。'),
          extensionPoint('eleckoi.character.editor.regex', '正则编辑接入口', '允许插件扩展角色正则规则编辑。'),
          extensionPoint('eleckoi.character.editor.dynamic', '动态设定编辑接入口', '允许插件扩展动态设定编辑。'),
          extensionPoint('eleckoi.character.manager', '角色管理接入口', '允许插件包装或替换角色导入、导出和批量管理界面。')
        ]
      },
      {
        id: 'eleckoi.character-configuration', label: '角色配置', packageName: '@eleckoi/dsh-client-character-configuration',
        description: '提供设定库、变量、正则和动态设定编辑。',
        components: [
          runningComponent('eleckoiSettingLibraries', '设定库服务', '读取、保存并同步角色设定库与动态设定。'),
          runningComponent('eleckoiVariables', '变量配置服务', '读取、保存并同步角色变量、对象和版本。'),
          runningComponent('eleckoiRegexRules', '正则规则服务', '读取、保存、导入、导出并测试角色正则规则。')
        ]
      },
      {
        id: 'eleckoi.conversations', label: '角色对话记录', packageName: '@eleckoi/dsh-client-conversations',
        description: '提供角色会话列表、历史记录和会话状态。',
        components: [
          runningComponent('eleckoiConversations', '对话目录服务', '管理对话列表、历史消息、流式状态和变量时间线。'),
          runningComponent('main#messages', '消息主页面', '在 DSH 主界面显示会话列表和角色聊天。'),
          runningComponent('sidebar.panellist#messages', '消息导航入口', '在桌面侧边栏打开消息主页面。'),
          extensionPoint('eleckoi.conversation.list', '对话列表接入口', '允许插件包装或替换对话列表。')
        ]
      },
      {
        id: 'eleckoi.models', label: '模型配置', packageName: '@eleckoi/dsh-client-models',
        description: '提供对话、图像、语音等模型服务的配置和连接检查。',
        components: [
          runningComponent('eleckoiModels', '模型目录服务', '读取、刷新并同步对话与图像模型配置。'),
          runningComponent('main#model', '模型配置主页面', '在 DSH 主界面显示模型提供方和模型配置。'),
          runningComponent('sidebar.panellist#model', '模型配置导航入口', '在桌面侧边栏打开模型配置页面。'),
          extensionPoint('eleckoi.model.editor', '模型编辑接入口', '允许插件包装或替换模型配置编辑器。')
        ]
      },
      {
        id: 'eleckoi.persona', label: '用户资料', packageName: '@eleckoi/dsh-client-persona',
        description: '提供用户身份、头像和个人资料。',
        components: [
          runningComponent('eleckoiPersona', '用户资料服务', '读取、保存并同步用户名称、头像和角色扮演身份。'),
          extensionPoint('eleckoi.persona.editor', '用户资料编辑接入口', '允许插件包装或替换用户资料编辑器。')
        ]
      },
      {
        id: 'eleckoi.presets', label: 'Agent 预设', packageName: '@eleckoi/dsh-client-presets',
        description: '提供预设内容、提示词、工具和正则编辑。',
        components: [
          runningComponent('eleckoiPresets', '预设目录服务', '读取、保存并同步 Agent 预设目录和详细内容。'),
          runningComponent('main#presets', '预设主页面', '在 DSH 主界面显示和编辑 Agent 预设。'),
          runningComponent('sidebar.panellist#presets', '预设导航入口', '在桌面侧边栏打开预设页面。'),
          extensionPoint('eleckoi.preset.editor.profile', '预设基本资料接入口', '允许插件扩展预设名称、分组和基本资料。'),
          extensionPoint('eleckoi.preset.editor.introduction', '预设说明接入口', '允许插件扩展预设说明和开场内容。'),
          extensionPoint('eleckoi.preset.editor.prompts', '提示词编辑接入口', '允许插件扩展预设提示词编辑。'),
          extensionPoint('eleckoi.preset.editor.tools', '工具配置接入口', '允许插件扩展预设工具策略。'),
          extensionPoint('eleckoi.preset.editor.regex', '预设正则接入口', '允许插件扩展预设正则规则。'),
          extensionPoint('eleckoi.preset.manager', '预设管理接入口', '允许插件包装或替换预设导入、导出和管理界面。')
        ]
      },
      {
        id: 'eleckoi.roleplay', label: '角色聊天', packageName: '@eleckoi/dsh-client-roleplay',
        description: '通过 DSH Agent 和 Session 运行角色对话。',
        components: [
          runningComponent('eleckoi-client-roleplay', 'DSH Host 角色预设桥接', '把 ElecKoi 预设和对话上下文注册到 DSH Agent。'),
          runningComponent('eleckoi.roleplay', '角色聊天会话容器', '把角色聊天界面绑定到当前 DSH Session。'),
          extensionPoint('eleckoi.roleplay.message.content', '消息正文接入口', '允许插件包装或替换角色聊天消息正文。'),
          extensionPoint('eleckoi.roleplay.message.actions', '消息操作接入口', '允许插件在消息旁增加操作。'),
          extensionPoint('eleckoi.roleplay.message.after', '消息下方接入口', '允许插件在消息下方增加内容。'),
          extensionPoint('eleckoi.roleplay.input.left', '输入框左侧接入口', '允许插件在角色聊天输入框左侧增加控件。'),
          extensionPoint('eleckoi.roleplay.input.right', '输入框右侧接入口', '允许插件在角色聊天输入框右侧增加控件。'),
          extensionPoint('eleckoi.roleplay.input.overlay', '输入框浮层接入口', '允许插件在角色聊天输入区增加浮层。'),
          extensionPoint('eleckoi.roleplay.composer.dock', '编辑器下方接入口', '允许插件在角色聊天编辑器下方增加内容。'),
          extensionPoint('eleckoi.roleplay.conversation.input.left', 'DSH 输入框左侧投影', '承接 DSH 会话输入框左侧插件组件。'),
          extensionPoint('eleckoi.roleplay.conversation.input.right', 'DSH 输入框右侧投影', '承接 DSH 会话输入框右侧插件组件。'),
          extensionPoint('eleckoi.roleplay.conversation.input.overlay', 'DSH 输入框浮层投影', '承接 DSH 会话输入区浮层插件组件。'),
          extensionPoint('eleckoi.roleplay.conversation.composer.dock', 'DSH 编辑器下方投影', '承接 DSH 会话编辑器下方插件组件。')
        ]
      },
      {
        id: 'eleckoi.session-edit', label: '会话消息编辑', packageName: '@eleckoi/dsh-runtime',
        description: '通过 DSH Session 合同编辑和重新生成消息。',
        components: [
          runningComponent('eleckoiSessionEditor', '会话消息编辑服务', '编辑消息并按指定轮次回退 DSH Session，供重新生成使用。')
        ]
      },
      {
        id: 'eleckoi.shell', label: 'ElecKoi 桌面界面', packageName: '@eleckoi/dsh-client-shell',
        description: '提供 ElecKoi 主窗口、导航和插件中心。',
        components: [
          runningComponent('root#eleckoi-root', 'ElecKoi 客户端根界面', '装配主窗口、页面、主题和当前导航状态。'),
          runningComponent('layout', '界面布局服务', '向 DSH Client 提供页面选择和面板状态。'),
          runningComponent('sidebar', '桌面侧边栏', '装配品牌、主页面导航、工作区和底部操作。'),
          runningComponent('main#settings', '设置主页面', '在 DSH 主界面显示 ElecKoi 设置。'),
          runningComponent('sidebar.brand.mark#fallback', '品牌图标默认内容', '在没有插件覆盖时保留 ElecKoi 品牌图标。'),
          runningComponent('sidebar.brand.name#fallback', '品牌名称默认内容', '在没有插件覆盖时保留 ElecKoi 品牌名称。'),
          runningComponent('sidebar.workspaces#fallback', '工作区默认内容', '承接侧边栏工作区区域的默认内容。'),
          runningComponent('sidebar.settings#fallback', '设置入口默认内容', '承接侧边栏设置区域的默认内容。'),
          runningComponent('sidebar.panellist#creatorStudio', 'AI 创作工作室入口', '在侧边栏提供 AI 创作工作室入口。'),
          runningComponent('sidebar.panellist#community', '社区入口', '在侧边栏提供社区入口。'),
          runningComponent('plugins.item#eleckoi-built-ins', 'ElecKoi 内置插件目录', '向 DSH 官方插件中心注册全部 ElecKoi 内置插件详情。'),
          runningComponent('plugins.detail.badge#eleckoi.built-in-version', '内置插件版本标记', '在插件详情标题旁显示 ElecKoi 插件版本。'),
          extensionPoint('main', '主页面接入口', '允许 DSH Client 插件注册新的主页面。'),
          extensionPoint('sidebar', '侧边栏接入口', '允许插件替换或包装侧边栏。'),
          extensionPoint('rightbar', '右侧面板接入口', '允许插件向主界面提供右侧面板。'),
          extensionPoint('shell.overlay', '全局浮层接入口', '允许插件在桌面界面上方显示浮层。'),
          extensionPoint('shell.leading', '窗口前置区域接入口', '允许插件提供窗口前置内容。'),
          extensionPoint('settings.section', '设置分区接入口', '允许插件在设置中增加分区。'),
          extensionPoint('settings.general.item', '通用设置项接入口', '允许插件增加通用设置项。'),
          extensionPoint('sidebar.brand.mark', '品牌图标接入口', '允许插件替换侧边栏品牌图标。'),
          extensionPoint('sidebar.brand.name', '品牌名称接入口', '允许插件替换侧边栏品牌名称。'),
          extensionPoint('sidebar.toggle.badge', '侧边栏切换标记接入口', '允许插件在侧边栏切换处增加标记。'),
          extensionPoint('sidebar.panellist', '侧边栏页面接入口', '允许插件增加侧边栏主页面入口。'),
          extensionPoint('sidebar.workspaces', '工作区接入口', '允许插件替换侧边栏工作区区域。'),
          extensionPoint('sidebar.settings', '设置入口接入口', '允许插件替换侧边栏设置区域。'),
          extensionPoint('sidebar.footer.action', '侧边栏底部操作接入口', '允许插件增加侧边栏底部操作。')
        ]
      }
    ]
    const builtInPluginById = new Map(builtInPlugins.map(plugin => [plugin.id, plugin]))
    function BuiltInPluginDescription({ plugin, view }) {
      if (view === 'summary') return React.createElement('span', { className: 'eleckoi-plugin-summary' },
        React.createElement('code', null, plugin.packageName),
        React.createElement('span', null, plugin.description))
      const running = plugin.components.filter(component => component.kind === 'runtime').length
      const extensions = plugin.components.length - running
      const countLabel = extensions > 0
        ? `共 ${plugin.components.length} 个 · ${running} 运行中 · ${extensions} 已开放`
        : `共 ${plugin.components.length} 个 · ${running} 运行中`
      return React.createElement('div', { className: 'eleckoi-plugin-components' },
          React.createElement('div', { className: 'eleckoi-plugin-components-head' },
            React.createElement('h4', null, '包含的组件'),
            React.createElement('span', null, countLabel)),
          React.createElement('ul', { className: 'eleckoi-plugin-component-list' },
            plugin.components.map(component => React.createElement('li', {
              key: component.id,
              className: 'eleckoi-plugin-component-row',
              'data-plugin-row': component.id,
              'data-component-kind': component.kind
            },
              React.createElement('span', { className: 'eleckoi-plugin-component-icon', 'aria-hidden': 'true' },
                React.createElement(PluginArtworkDefault, { size: 28 })),
              React.createElement('div', { className: 'eleckoi-plugin-component-main' },
                React.createElement('strong', null, component.title),
                React.createElement('span', null, component.description),
                React.createElement('code', null, component.id),
                React.createElement('code', null, plugin.packageName)),
              React.createElement('span', { className: 'eleckoi-plugin-component-state' },
                React.createElement(StateDot, { state: 'done' }),
                component.kind === 'extension' ? '已开放' : '运行中')))))
    }
    function BuiltInPluginVersion({ subject }) {
      if (subject?.kind !== 'item' || !builtInPluginById.has(subject.id)) return null
      return React.createElement(Tag, { tone: 'neutral' }, 'v0.1.0')
    }
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
          '@eleckoi/dsh-client-character-configuration', '@eleckoi/dsh-client-characters',
          '@eleckoi/dsh-client-conversations', '@eleckoi/dsh-client-models',
          '@eleckoi/dsh-client-persona', '@eleckoi/dsh-client-presets',
          '@eleckoi/dsh-client-roleplay', '@eleckoi/dsh-client-shell'
        ])
        const eleckoiPackages = new Map([
          ['@eleckoi/dsh-web-search-tavily', 'Tavily 联网搜索'],
          ['@deepseek-ai/dsh-llm', 'DSH 模型运行适配'],
          ['@deepseek-ai/dsh-llm-pi-ai', 'DSH 通用模型适配'],
          ['@deepseek-ai/dsh-sdk-jsonrpc-server', 'DSH 桌面通信适配'],
          ['@earendil-works/pi-ai', '模型协议适配']
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
          const toPackage = pkg => ({
            id: pkg.name,
            kind: 'package',
            name: eleckoiPackages.get(pkg.name)
              || (pkg.meta?.title === undefined ? pkg.name : face.resolveText(pkg.meta.title) || pkg.name),
            icon: pkg.meta?.icon || '',
            group: eleckoiPackages.has(pkg.name) ? 'eleckoi'
              : pkg.name.startsWith('@deepseek-ai/') || (pkg.optional && !pkg.installed) ? 'official'
                : 'installed'
          })
          return [
            ...packages.map(toPackage),
            ...face.hooks.configLedger.getSnapshot().items.map(item => ({
              id: item.id, kind: 'item', name: item.label, icon: '',
              group: item.id.startsWith('eleckoi.') ? 'eleckoi' : 'official'
            }))
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
          renderUserProfileEditor: (owner, fallback) => renderSlotChain('eleckoi.persona.editor', { ...owner, fallback }, { fallback }),
          renderCharacterPageSection: (section, owner, fallback) => renderSlotChain(`eleckoi.character.page.${section}`, { ...owner, fallback }, { fallback }),
          renderCharacterEditorSection: (section, owner, fallback) => renderSlotChain(`eleckoi.character.editor.${section}`, { ...owner, fallback }, { fallback }),
          renderCharacterManager: (owner, fallback) => renderSlotChain('eleckoi.character.manager', { ...owner, fallback }, { fallback }),
          renderConversationList: (owner, fallback) => renderSlotChain('eleckoi.conversation.list', { ...owner, fallback }, { fallback }),
          renderPresetEditorSection: (section, owner, fallback) => renderSlotChain(`eleckoi.preset.editor.${section}`, { ...owner, fallback }, { fallback }),
          renderPresetManager: (owner, fallback) => renderSlotChain('eleckoi.preset.manager', { ...owner, fallback }, { fallback }),
          renderModelEditor: (owner, fallback) => renderSlotChain('eleckoi.model.editor', { ...owner, fallback }, { fallback }),
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
            'eleckoi.persona.editor': { kind: 'chain', scope: 'root' },
            'eleckoi.character.page.list': { kind: 'chain', scope: 'root' },
            'eleckoi.character.page.profile': { kind: 'chain', scope: 'root' },
            'eleckoi.character.editor.card': { kind: 'chain', scope: 'root' },
            'eleckoi.character.editor.lore': { kind: 'chain', scope: 'root' },
            'eleckoi.character.editor.variables': { kind: 'chain', scope: 'root' },
            'eleckoi.character.editor.regex': { kind: 'chain', scope: 'root' },
            'eleckoi.character.editor.dynamic': { kind: 'chain', scope: 'root' },
            'eleckoi.character.manager': { kind: 'chain', scope: 'root' },
            'eleckoi.conversation.list': { kind: 'chain', scope: 'root' },
            'eleckoi.preset.editor.profile': { kind: 'chain', scope: 'root' },
            'eleckoi.preset.editor.introduction': { kind: 'chain', scope: 'root' },
            'eleckoi.preset.editor.prompts': { kind: 'chain', scope: 'root' },
            'eleckoi.preset.editor.tools': { kind: 'chain', scope: 'root' },
            'eleckoi.preset.editor.regex': { kind: 'chain', scope: 'root' },
            'eleckoi.preset.manager': { kind: 'chain', scope: 'root' },
            'eleckoi.model.editor': { kind: 'chain', scope: 'root' },
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
      ctx.slots.inject('plugins.item', () => builtInPlugins.map((plugin, index) => ctx.slots.register({
        name: 'plugins.item', id: plugin.id, label: plugin.label, order: 1000 + index, registrant: '@eleckoi/dsh-client-shell'
      }, props => React.createElement(BuiltInPluginDescription, { ...props, plugin }))))
      ctx.slots.inject('plugins.detail.badge', () => ctx.slots.register({
        name: 'plugins.detail.badge', id: 'eleckoi.built-in-version', order: 1000, registrant: '@eleckoi/dsh-client-shell'
      }, BuiltInPluginVersion))
      ctx.slots.inject('sidebar.panellist', () => [
        ctx.slots.register({
          name: 'sidebar.panellist', id: 'creatorStudio', order: 10,
          label: 'AI创作工作室', registrant: '@eleckoi/dsh-client-shell'
        }, () => React.createElement(CreatorStudioNavigationIcon)),
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
