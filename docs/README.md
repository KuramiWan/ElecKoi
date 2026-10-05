# ElecKoi Desktop 文档

本目录区分当前开发规范、插件教程、架构决策和历史资料。实现以仓库锁定版本的 DSH 官方源码为基准，ADR 说明决策原因，不替代当前接口合同。

## 当前架构

- [DSH 官方客户端架构基准](DSH_DESKTOP_ARCHITECTURE.md)：Host、Client、桌面壳及上游版本边界。
- [产品数据库](DATABASE.md)：数据所有权、结构与迁移。
- [插件归属与接入清单](DSH_PLUGIN_MIGRATION.md)：内置能力的归属与公开接入点。

## 插件开发

从 [插件开发文档](plugins/README.md) 开始；第一次写插件先看 [快速入门](plugins/quick-start.md)。查询能力时使用 [接口总表](plugins/api-reference.md)，跨 Host/Client 调用见 [Remote](plugins/remote.md)。

接口总表由当前仓库的 bundle manifest 自动生成，不能手工维护数量和成员。

## 决策与历史

- [架构决策索引](adr/README.md)：按编号查看决定、状态与替代关系。
- [历史资料](history/README.md)：旧架构说明，不作为当前实现指南。

## 文档维护

- [v0.2.7 发布说明](releases/v0.2.7.md)

新增、改名、归档和同步规则见 [文档维护约定](MAINTENANCE.md)。运行 `pnpm check:docs` 检查本地链接、ADR 编号、标题和索引；接口总表由 `pnpm check:plugin-docs` 单独校验。

## 公开课题与产品截图

- [AI 角色扮演开发难题](open-problems/README.md)
- [Open development questions](open-problems/README.en.md)
- 正式截图放在 `screenshots/`，供仓库产品介绍引用。
