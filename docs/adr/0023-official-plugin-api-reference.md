# ADR 0023：使用 DSH 官方生成器维护插件接口参考

状态：已实施，2026-10-06。补充 ADR 0016 的展示目录决定。

## 问题

bundle 的 `eleckoi.developerInterfaces` 描述接口标题和用途，但人工填写的方法名不能证明实际参数、返回类型和公开能力已经完整记录。部分 Client 服务只有 JavaScript 实现，没有可供插件作者导入的类型声明。接口展示目录与源码可以独立变化。

## 决定

1. 公开服务使用 Cordis `Context` 类型声明、公开包入口和带参数、结果说明的 JSDoc；Client 与 Host 分别分析。跨端方法继续以官方 `@Remote` / `@RemoteScope` 和生成的 `/remote` 为准。
2. 接口分析、类型结构、Cordis 文档区域和可查询目录使用锁定 DSH `0.2.0-rc.2` 的 `@deepseek-ai/dsh-typert-generator` 公开 API。仓库脚本只负责选择公开面、文档归属、类型链接与写入校验，不维护第二种调用协议或类型分析器。
3. `eleckoi.developerInterfaces` 保留为插件中心的导航信息。其服务成员和 Remote 成员必须与源码分析结果核对；新增、删除和改名后重新生成完整参考与目录。
4. 查询注册进入官方 Host / Client `cordisInspect`，由既有 `cordis_inspect_list` 和 `cordis_inspect_query` 读取。注册跟随 Cordis 生命周期清理；不另建 Inspect 注册表、工具或跨端通道。
   官方 `layout` 服务直接导入同版本公开 `ILayout` 类型，接口查询复用官方 Client 的 `Service` 提供方；产品目录只索引该入口。
5. 第三方公开面不包括 SQLite Repository、内部准备服务与私有桌面实现。完整参考记录公开声明的能力，不以生成文档为理由扩大数据权限。

## 锁定版本适配

官方 Cordis 目录投影器只匹配上游 `packages/<分组>/<包>/src`，而本仓库产品包使用 `packages/<包>/src`。在既有 generator 补丁中允许这两种目录深度，保留 Host / Client 分离、同包声明归属、JSDoc 校验、类型链接与官方渲染机制。升级时核对同版本官方实现；上游支持此布局后删除该路径适配。

## 验收

生成参考可查到公开方法的参数、返回值、说明及源码位置；声明缺失、成员漂移、JSDoc 不完整和生成文件过期必须被检查拒绝。真实官方 Inspect 注册、查询与卸载需要通过测试。完成后执行文档、架构检查、测试与构建。

本决定不修改数据库结构、聊天生成规则或团队编排。
