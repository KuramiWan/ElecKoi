# Desktop 产品数据库

本文记录当前 ElecKoi SQLite 基线及其所有权。DSH 已有正式存储合同的领域不在该数据库维护第二份数据：模型与联网搜索配置使用 settings/profile/credentials，聊天正文与运行轨迹使用 Session 日志，bundle 选择使用 profile。

## 所有者与位置

- 唯一所有者：DSH Host 插件 `@eleckoi/dsh-product-data`。
- 数据库文件：Electron `userData/eleckoi-common.sqlite3`，路径由桌面壳作为 Host 启动参数传入。
- SQLite 打开、迁移、恢复和所有 Repository 写入均位于 `packages/dsh-product-data/src`。Electron Main、Client 和 Renderer 不打开数据库。
- 公共 SQL：`resources/database/eleckoi-common-schema-v1.sql`。
- 当前 `PRAGMA user_version`：`7`。
- 当前结构：43 张业务表、2 个视图；数据库物理结构版本只使用 SQLite `PRAGMA user_version`。

`pnpm db:generate` 从固定 SQL 生成内嵌迁移 SQL与 Drizzle 查询映射；`pnpm check:database-schema` 校验生成内容。SQL 是公共结构权威，Drizzle 映射不反向生成迁移。

## 数据边界

| 数据 | 权威存储 |
| --- | --- |
| 角色、角色卡文本、用户资料 | SQLite；媒体字段保存 `eleckoi-media://` 引用，文件位于产品媒体目录 |
| 设定库、变量配置与状态、正则、Agent 预设 | SQLite |
| 聊天目录、角色快照、关系索引、说话者、轮次与最终回复关系 | SQLite |
| 聊天正文、推理、工具调用、工具结果与 Provider replay state | DSH Session 日志 |
| 模型提供商、模型 profile、API Key | DSH settings/profile/credentials |
| Tavily 设置与 API Key | DSH settings/credentials |
| 创作项目 | 用户工作区目录；SQLite 只保存当前需要的产品索引 |
| 显示偏好与聊天选择 | DSH settings；旧 `desktop_preferences` 在 v6 直接删除，不迁移 |

## 与 DSH Storage 的关系

当前产品数据库没有挂载 `@deepseek-ai/dsh-storage-sqlite`。该官方包是 Host 侧文档型 KV 后端，每个键对应一行 JSON；`@deepseek-ai/dsh-storage-domain` 在其上提供 schema 校验、写入串行化和 `domain/changed` 事件。它适合简单、独立、按键读写的领域状态。

ElecKoi 当前 43 张产品表需要关系、外键、排序、搜索、跨表事务和从 v1 连续迁移到当前版本。锁定版本的 DSH Storage 不提供二级索引、跨表事务或自动迁移，因此不替代这套关系型产品库。两者遵守同一所有权边界：只在 DSH Host 打开，Client 通过正式 Remote 调用；新增简单 KV 领域时先评估 `ctx.storageDomain`，新增关系型领域则进入本产品库并维护迁移链。聊天正文与轨迹仍由 DSH Session 持久化，查询索引由官方 `dsh-session-query-sqlite` 负责。

角色扮演的下一轮模型请求从 Session 投影：旧轮次只携带用户输入和角色最终正文，旧推理、工具过程与 Provider replay state 不再发送；当前轮次流程完整保留。该投影不会删除历史轨迹。编辑、删除、回退和重新生成保持同一聊天与 Session ID。

## 迁移链

迁移由 `packages/dsh-product-data/src/storage/sqlite/installSchema.ts` 在 Host 启动时原子执行：

1. v1：公共 SQL 基线。
2. v2：运行期结构整理。
3. v3：设定条目与版本引用整理。
4. v4：DSH Session/turn 绑定。
5. v5：删除废弃消息高度字段。
6. v6：删除已由 DSH 正式存储接管的模型与搜索配置表，并删除不再使用的 `generation_attempts`、`cleanup_operations`、`desktop_preferences` 与旧结构登记表 `desktop_schema`；旧设置不迁移，当前版本只以 `PRAGMA user_version` 标识。
7. v7：原子移除当前预设及其历史版本中的子 Agent 模型选择字段，并更新预设工具配置版本；子 Agent 模型授权只由 DSH Host 设置负责。

较早开发构建创建的 v6 数据库在升级至 v7 前，先原子整理已废弃的执行、偏好与结构登记表，再执行 v6 → v7 迁移。仍有效的角色、预设、设定、变量与聊天索引数据保留，不要求清库。后续结构变化必须提升版本并追加连续迁移。

## 删除与文件

- 删除角色时级联删除其产品关系和聊天索引。
- 删除聊天或清空记录时，产品索引与对应 DSH Session 使用同一聊天标识处理，不创建分叉会话。
- 媒体文件由 Host 的 `LocalMediaStore` 写入；数据库只保存稳定媒体引用。Electron 的媒体协议只负责只读响应。
- 不再使用数据库清理任务表。DSH Session 文件生命周期交给正式 Session API，产品媒体删除由拥有该文件的 Host 操作在业务事务边界内执行。

## 验证

- `pnpm check:database-schema`：43 张公共表、2 个视图与生成文件一致。
- `pnpm test`：覆盖 v1 至 v7 迁移、开发 v6 整理、外键、重启持久化、角色与媒体、设定、变量、正则、预设、聊天索引和 Remote 写入。
- `pnpm rebuild:electron && pnpm check:electron-sqlite`：使用 Electron 的真实原生 SQLite ABI 创建公共结构，核对 43 张业务表、2 个视图、`user_version = 7`、外键和完整性。

架构决策见 [ADR 0018](adr/0018-dsh-host-owns-product-data.md)。
