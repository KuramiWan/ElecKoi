# ADR 0016：插件开发接口由 bundle 自声明

状态：已采纳，2026-09-30。公开类型、完整参考和源码校验由 [ADR 0023](0023-official-plugin-api-reference.md) 补充；本 ADR 的 manifest 声明继续用于插件中心导航。

## 问题

插件详情最初在界面代码中手写了一张 UI Slot 表。它只能列出部分界面接入点，导致实际提供 Cordis 服务的角色配置、消息编辑，以及向 DSH 注册搜索实现的 Tavily 被错误显示为“扩展接口 0”。界面表也会与真实插件代码独立演进，无法作为第三方开发依据。

## 决定

- 每个 bundle 在 `package.json.eleckoi.developerInterfaces` 中声明自身稳定、公开的开发合同。
- 合同分为 `ui-slot`、`service`、`event`、`remote` 和 `contribution`。`provides` 表示该包开放合同，`contributes` 表示该包接入另一个包拥有的注册点。
- 每项合同必须包含稳定 ID、类型、标题、说明、使用方式和作用域；可调用服务列出公开成员，能力接入列出所属包。
- 锁定版本的 DSH PluginManager 负责读取、限制长度、过滤非法类型和重复 ID，再沿已有 Remote 与 Client PluginManager 状态传到界面。插件中心不读取磁盘，也不建立第二套注册表、加载器或启停状态。
- 插件详情只显示“运行组件”和“开发接口”。前者来自真实 bundle 行，后者来自上述已校验合同。接口类型和作用域只描述开发用途，不冒充运行状态。
- SQLite Repository、Electron 和内部协作服务不因目录展示自动成为公开接口。只有明确列入合同并经过 DSH Remote、Connection 或 Client Slot 边界的能力可供第三方使用。

## 当前公开面

- Client UI Slots：角色、预设、模型、用户资料、聊天、轨迹和桌面 Shell 的可替换或可追加区域。
- Client Cordis 服务：角色目录、角色配置、聊天记录、模型、用户资料、Agent 预设和桌面布局。
- Host Cordis 服务：正式会话日志上的消息编辑与轮次回退。
- DSH 能力接入：Tavily 通过 `@deepseek-ai/dsh-web` 的搜索提供方注册点接入。

## 验证与升级

运行时清单检查要求每个内置 bundle 至少声明一个有效合同，并检查全局 ID 唯一性、公开成员和能力所属包。界面测试将每个 UI Slot、服务与注册成员反查到实际源码声明。升级 DSH 时必须复核 PluginManager 补丁；上游提供等价 manifest 扩展元数据后迁移到上游合同并移除补丁。

本决定不改变数据库结构和产品数据归属。
