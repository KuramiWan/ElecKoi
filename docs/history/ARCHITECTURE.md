# ElecKoi Desktop 历史架构说明

本文原先描述的自有 Desktop Kernel、Desktop Gateway、业务 Preload bridge 与 `window.eleckoi` 方案已经废弃并从源码删除。保留旧方案的详细操作说明会让新代码误用已经移除的边界，因此本文不再作为实现指南。

当前开发只使用以下基准：

- [DSH 官方客户端架构基准](../DSH_DESKTOP_ARCHITECTURE.md)
- [ADR 0012：DSH 官方客户端基准](../adr/0012-dsh-official-client-baseline.md)
- [ADR 0017：以 DSH Remote 取代 Desktop Gateway](../adr/0017-dsh-remote-replaces-desktop-gateway.md)
- [ElecKoi 插件开发文档](../plugins/README.md)

当前规则是：产品跨 Host/Client 调用使用生成的 Typert Remote 或明确记录的 DSH Connection 正式协议；Electron IPC 只承载官方桌面壳职责。任何业务 `DesktopGateway`、`window.eleckoi`、字符串请求路由或对应兼容层都禁止恢复。
