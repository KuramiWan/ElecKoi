# ADR 0013：DSH 统一插件平台与 ElecKoi 产品数据边界

## 状态

已被 [ADR 0017](0017-dsh-remote-replaces-desktop-gateway.md) 与 [ADR 0018](0018-dsh-host-owns-product-data.md) 取代，2026-10-01。本文仅保留 DSH 统一插件平台的历史决策；Desktop Gateway、Main 数据所有权与“不迁移产品数据”的边界不再适用。

## 背景

ElecKoi 已有角色卡、用户资料、预设、多类型模型配置和 SQLite 用户数据。DSH `0.2.0-rc.2` 提供官方 profile、bundle、插件管理器、Host、Client model、Slots 和 Session，但没有与上述产品数据完全等价的公开存储合同。直接搬动数据所有权会制造双轨读写或要求用户迁移数据库，也不能自动让第三方扩展更安全。

同时，Electron Main 中使用 Cordis 组装内部模块，容易被误解为另一套面向用户的插件系统。

## 决定

1. 面向用户和第三方开发者的插件平台只有 DSH。安装、启用、停用、卸载、依赖、客户端装载和重启恢复均使用锁定版本的 DSH 官方机制。
2. ElecKoi 的角色、预设、模型、用户资料和角色聊天以 DSH Client 插件、Host 插件或 bundle 的身份接入。第三方扩展通过公开 Slots 和受控操作修改界面或功能流程。
3. 现有 SQLite 和产品数据服务继续由 Electron Main 中唯一的 Desktop Gateway 访问。DSH 客户端插件通过类型化 Gateway 操作读取和保存，不直接访问 Electron、Node 或数据库。
4. Main 中的 Cordis 只作为内部依赖装配工具，不发布安装合同、不出现在独立插件商店，也不接受第三方模块。它不构成第二套对外插件平台。
5. 默认界面是每个界面链的后备实现。扩展停用、卸载或不匹配当前数据时，界面恢复为 ElecKoi 自带实现。卸载扩展不得删除角色卡、预设、模型配置或聊天记录。
6. 新增产品扩展能力优先增加同版本 DSH 的 Host/Client 插件及窄接口。只有本机壳职责或 DSH 尚无等价公开合同的产品数据操作可以留在 Main，并继续经 Desktop Gateway 暴露。

## 结果

- 用户只需要理解一个插件中心。
- 第三方开发者只需要遵循 DSH bundle 和 Client Slots 生命周期。
- 现有用户数据不迁移、不复制，也不形成两套保存逻辑。
- DSH 升级时分别验证官方插件生命周期、ElecKoi 的公开接入点和 Gateway 数据操作。

如果未来 DSH 提供适用于这些产品数据的正式 Host 存储合同，可以新增 ADR 设计原子迁移；在此之前不得为了目录形式一致而搬动数据所有权。
