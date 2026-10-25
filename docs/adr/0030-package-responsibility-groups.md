# ADR 0030：按职责分组工作区包

## 状态

已采纳，2026-10-07。补充 [ADR 0028](0028-multi-application-workspace.md) 的包目录安排；不改变 DSH 版本、包身份、服务合同、业务行为和数据所有权。

## 背景

现有功能插件、Host 数据服务、公共合同与示例包平铺在 `packages/` 下，加入移动界面后难以区分职责。锁定 DSH 提交的工作区以职责父目录组织包，应用入口单独位于 `apps/`。

## 决定

1. `packages/client/features/` 保存现有产品功能插件，各包保留原有 Host、Client、Remote、Slots 和生命周期入口，不因分类目录拆开或复制业务实现。
2. Android 专用界面装配插件在实际接入时进入 `packages/client/mobile/`；移动页面组件进入 `apps/web/src/mobile/`，Android 原生壳与构建进入 `apps/android/`。本次只整理现有包，不创建没有实现用途的移动目录。
3. `packages/host/product-api`、`product-data`、`runtime` 和 `web-search-tavily` 分别保存现有产品 Remote、数据服务、DSH 会话运行和搜索服务包。Host 仍是产品数据库唯一写入方。
4. `packages/shared/` 是原 `@eleckoi/product-shared` 包的新位置，直接包含 `package.json` 和 `src/contracts`、`src/foundation`，不额外增加同名包目录。
5. 示例包进入 `packages/examples/`；`packages/sdk/` 与 `packages/compatibility/` 继续按现有职责组织。
6. 目录位置不决定 npm 包身份。所有现有 `package.json.name`、exports、版本、Cordis 服务名、Remote 命名空间、bundle/profile 标识及应用数据路径保持原样。只更新源码位置、相对引用、工作区声明、构建与检查入口。
7. Android 采用 PR 的共享 Node Host 运行方式，从当前正式数据模型的空数据基线开始；不采用旧 Android Room 数据导入与为其保留旧字段的兼容实现。PC 数据与既有升级迁移不受此决定影响。
8. 锁定版本的 Cordis 目录投影补丁按官方 `PackageModel.root` 和包身份识别源码，不依赖目录层数；生成后核对公开服务完整性，防止目录变深时静默丢失声明。见 [ADR 0023](0023-official-plugin-api-reference.md)。

## 实施与验证

先整理开发工作树的现有目录，更新路径引用、包发现、架构检查与文档。校验包身份和数据库定义未改变，执行桌面测试、构建和 Host/Client 启动检查，再由用户实际启动验收。Android 接入、PR 合并和公开工作树同步分别在后续阶段执行。

目录依据：[锁定工作区](https://github.com/deepseek-ai/deepseek-harness/blob/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/pnpm-workspace.yaml)、[官方 Client 分组](https://github.com/deepseek-ai/deepseek-harness/tree/c1b47e41fcd54d20a0f061df28683bfc29ee24e5/packages/client)。
