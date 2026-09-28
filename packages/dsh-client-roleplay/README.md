# ElecKoi 角色聊天客户端插槽

该 bundle 由 DSH 客户端 Loader 装载，使用 DSH UI Slots 和当前 `SessionReference` 渲染 ElecKoi 角色聊天。它不挂载另一套隐藏的官方聊天页面。

可扩展的 Session 作用域列表插槽：

| 插槽 | 位置 | 提供给插件的参数 |
| --- | --- | --- |
| `eleckoi.roleplay.message.content` | 单条消息正文，可按链式插槽替换 | `conversationId`、`productMessageId`、`messageId`、`role`、`content`、`streaming` |
| `eleckoi.roleplay.message.actions` | AI 消息操作栏 | `conversationId`、产品 `productMessageId`、日志中的 DSH `messageId` |
| `eleckoi.roleplay.message.after` | 消息正文之后 | `conversationId`、`productMessageId`、`messageId`（用户消息可能为空）、`role` |
| `eleckoi.roleplay.input.left` | 输入框工具栏左侧 | `conversationId`、`input`、`setInput`、`isSending` |
| `eleckoi.roleplay.input.right` | 输入框工具栏右侧 | 同上 |
| `eleckoi.roleplay.input.overlay` | 输入框卡片内部 | 同上 |
| `eleckoi.roleplay.composer.dock` | 输入框下方 | `conversationId` |

贡献通过 `ctx.slots.inject(name, () => ctx.slots.register({ name, ... }, Component))` 注册，生命周期由 DSH 管理。消息插槽仅在记录属于当前 DSH Session 时渲染；开场白没有日志消息 ID，因此不会显示 `message.actions`。输入扩展直接操作 ElecKoi 当前草稿，不需要另外维护一份草稿。

TypeScript 插件可以使用 `import type {} from '@eleckoi/dsh-client-roleplay/slots'` 获得这些插槽的类型合同。

官方 `conversation.chat.assistant-actions` 等内部插槽由官方父组件声明。DSH 不允许另一个父组件重复声明同名插槽；只针对这些官方内部插槽编写的插件不会自动出现在 ElecKoi 角色聊天里。
