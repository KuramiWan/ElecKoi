# 工作区包

应用入口与平台构建位于 `apps/`。本目录按职责组织现有包；包名、服务合同与数据所有权不随目录位置改变。决定见 [ADR 0030](../docs/adr/0030-package-responsibility-groups.md)。

| 目录 | 职责 |
| --- | --- |
| `client/features/` | 角色、聊天、模型、预设、设置等产品功能插件；保留各包原有 Host 与 Client 入口。 |
| `host/product-api/` | 产品 Typert Remote 合同、Host 服务与生成的 Client 调用声明。 |
| `host/product-data/` | 产品 SQLite、版本化迁移、媒体与领域 Repository。 |
| `host/runtime/` | 正式 DSH Session 操作与共享会话处理。 |
| `host/web-search-tavily/` | Tavily 搜索服务插件。 |
| `host/web-deepseek/` | DeepSeek 独立 Search、Fetch API 提供器，由联网设置 bundle 装配。 |
| `shared/` | 公共合同、数据校验及纯基础函数；不承担数据库和 AI 运行。 |
| `sdk/` | 作者扩展 SDK。 |
| `compatibility/` | 当前受支持的 MVU 变量格式转换。HTML 显示资源位于 `client/features/`。 |
| `examples/` | 示例插件。 |

后续 Android 专用 Client 装配放在 `client/mobile/`，按实际实现建立。Android 复用当前共享业务与数据模型，平台界面和系统能力分别由移动组件及 `apps/android` 提供。
