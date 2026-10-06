# ElecKoi 角色聊天客户端插槽

该 bundle 由锁定版本 DSH 客户端 Loader 装载，在真实 `SessionReference` 下承载角色聊天与官方 InputBar。输入区只维护官方草稿、发送和原生文件/图片附件链。

类型入口：`@eleckoi/dsh-client-roleplay/slots`。完整接口清单及 owner 类型见 [界面插槽](../../docs/plugins/ui-slots.md#角色聊天入口19)；插件中心标题和说明由本包 `package.json.eleckoi.developerInterfaces` 提供。

## 输入区

| 插槽 | 当前用途 |
| --- | --- |
| `eleckoi.roleplay.conversation.composer.bar` | 替换整套输入框，接收官方输入服务及产品 `leadingAccessory`、`modelAccessory`、`dockAccessory` |
| `eleckoi.roleplay.conversation.composer` | 按 `select(owner)` 临时接管输入区，结束后恢复原输入框 |
| `eleckoi.roleplay.conversation.input.left` | 左侧工具区追加控件 |
| `eleckoi.roleplay.conversation.input.right` | 模型选择器附近追加控件 |
| `eleckoi.roleplay.conversation.input.overlay` | 输入框内浮层 |
| `eleckoi.roleplay.conversation.input.dock` | 输入框上方内容，owner 为官方 `InputZone` |
| `eleckoi.roleplay.conversation.input.attachments` | 替换附件展示，沿用原生添加、移除和重试操作 |
| `eleckoi.roleplay.conversation.input.permission` | 权限控件 |
| `eleckoi.roleplay.conversation.input.plan` | 计划模式控件 |
| `eleckoi.roleplay.conversation.input.model` | 供输入框皮肤调用的模型位置；默认 InputBar 使用产品 `modelAccessory` |
| `eleckoi.roleplay.conversation.input.activity` | 可展开的工具栏活动区 |
| `eleckoi.roleplay.conversation.composer.dock` | 输入框下方追加内容，空 owner；统计可通过 Session `useProjection` 读取 |

官方 `conversation.*` 活动贡献由 DSH Slot Registry 投影到上述位置，保留其优先级、注入、store、本地化与卸载行为。第三方可直接使用官方插槽；产品专属扩展也可注册对应的 `eleckoi.roleplay.conversation.*` 插槽。同一贡献不要同时注册两处。

默认 InputBar 保留原生“＋”和命令弹层，在“＋”右侧显示扮演菜单，在模型位显示 ElecKoi 选择器，在下方显示按当前有效会话重算的统计。官方 `conversation.composer.dock` 中 ID 为 `stats` 的贡献不投影；其他下方贡献与产品统计共用一个区域。输入框皮肤接管后应自行调用需要的子插槽并保留所需的产品装配参数。

## 消息与轨迹

会话标签与选择状态复用官方 `conversation.session.header` 和 `conversation.session` 的注入、共享 store 和切换操作。所有 `conversation.view` 注册项按官方列表的顺序和本地化标签显示；第三方视图由官方 Slot Renderer 在同一个 Session 下直接渲染，保留其 store、hooks、子插槽和卸载行为。内置角色正文与轨迹在对应视图保留产品展示适配，新增视图不需要注册 ElecKoi 专属接口。

`message.content` 包装或替换正文；`message.actions` 与 `message.after` 追加操作和内容。owner 包含产品会话 ID、产品消息 ID、DSH 消息 ID 与角色，正文另外提供 `content`、`streaming`。开场白没有日志消息 ID，不显示 `message.actions`。

`trajectory` 替换轨迹视图，`trajectory.images` 替换详情图片预览；审批详情与计划审核操作仅在对应输入区接管组件调用时显示。

注册使用 `ctx.slots.inject(name, () => ctx.slots.register({ name, ... }, Component))`，生命周期由 DSH 管理。未接入的官方内部插槽不会自动出现在产品角色聊天里；不要使用 DOM 查询或另建插槽总线绕过父组件声明。
