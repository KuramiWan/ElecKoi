# ADR 0017：以 DSH Remote 取代 Desktop Gateway

## 状态

已实施，2026-10-01。本文取代 [ADR 0013](0013-dsh-plugin-platform-and-product-data.md) 中“产品数据长期通过 Desktop Gateway 访问”的决定，以及 [ADR 0015](0015-dsh-built-in-bundle-registration.md) 中继续依赖该 Gateway 的数据边界描述。业务 Gateway、Preload bridge、`window.eleckoi`、共享请求合同及 Renderer client 已从源码删除。

## 背景

ElecKoi 的官方 DSH Web Client 已经运行在 DSH Host 提供的页面与 Connection 上，但角色、聊天索引、模型、预设和用户资料等客户端插件仍通过 `window.eleckoi` 调用 Electron IPC，再由自建 `DesktopGateway` 分发到 Main 中的产品服务。这使同一个客户端同时依赖 DSH Remote 与一套平行的 Host/Client 调用协议，也让第三方插件无法只依据 DSH 的公开合同理解产品能力。

锁定版本 `deepseek-ai/deepseek-harness@c1b47e41fcd54d20a0f061df28683bfc29ee24e5` 已经规定了跨 Host/Client 的正式方式：Host 服务用 Typert `@Remote` / `@RemoteScope` 声明公开方法，构建生成 Host 描述符和 Client contribution，Client 通过 `ctx.remote` 或作用域的 `agentCtx.remote` 调用。会话事件、分页、projection 和其他增量协议继续复用 DSH Connection 的正式协议，不伪装成一元 Remote。

## 决定

1. ElecKoi 所有业务侧 Host/Client 调用迁移到锁定版本 DSH 的 Typert Remote 与 Connection 合同。`DesktopGateway`、业务用 preload bridge、`window.eleckoi`、Renderer `desktopClient.request/on` 和对应自建请求/事件合同全部删除。
2. 新增一个由 ElecKoi 拥有的 Host API 包。公开给 Client 的业务方法继承 `TypertRemoteService`，只通过 `@Remote` / `@RemoteScope` 进入生成合同；包同时发布 `./typert` 与 `./remote`，生成文件不手写。
3. ElecKoi Client 组合显式挂载上述 `./remote` contribution。实际调用方声明 `remote` 与 `remote.<namespace>` 依赖，并通过具体的 `ctx.remote.<namespace>` 方法访问；禁止 Proxy、字符串路由或对旧 Gateway 的包装适配。
4. Host 服务进入 DSH profile/bundle 生命周期。产品 Repository 与 SQLite 的最终所有者迁移到 DSH Host；Electron Main 只保留窗口、受限 preload、启动恢复、更新安装和其他经官方 Desktop 边界确认的壳职责。
5. 数据迁移按领域原子完成。每个领域切换时保留现有数据库路径、版本化迁移链、有效用户数据和单一写入源；同一领域不得长期同时由 Main Gateway 与 DSH Host 写入。
6. 一元查询和命令使用 Remote。可取消流使用 `@Remote({ mode: 'stream' })`。会话事件、实时回复、分页、projection 和实体增量流使用 DSH Connection 上相应的正式数据协议；禁止把它们降级为 Electron 广播事件，也禁止为了形式统一把它们错误建模成普通 Remote。
7. Electron 壳必须保留的 IPC 使用独立、最小且不可供业务插件调用的通道。它们不得重新形成第二套业务 Gateway。

## 迁移顺序

1. 接入与上游一致的 Host-first Typert 生成阶段、`./typert` Loader 注册和 Client `./remote` contribution 挂载，并用一个只读业务切片验证真实端到端调用。
2. 迁移角色、角色配置、用户资料、模型和 Agent 预设等目录型数据；完成一个领域后删除其旧请求与事件。
3. 迁移聊天索引、消息操作、变量、正则、设定库与角色导入导出，并保持 SQLite 迁移与清理行为。
4. 将 Agent 启动、取消、重新生成和运行状态对齐 DSH SessionController、follow、Remote stream 与正式事件/projection；删除 Main 与 DSH Host 之间为业务运行建立的自建命令协议。
5. 迁移设置、作者接口、创作工作室和其他剩余业务能力。
6. 删除 `DesktopGateway`、业务 preload bridge、共享 Gateway 合同、Renderer `desktopClient` 和所有 `window.eleckoi` 使用点；更新架构检查器，使任一业务回流都会失败。

## 验收条件

- 产品客户端代码中不存在 `window.eleckoi`、`desktopClient.request` 或 `desktopClient.on`。
- Main 中不存在 `DesktopGateway`、业务请求路由注册和业务广播。
- 每个 Client 可调用能力都能追溯到一个生成的 Typert Remote 描述符，或一个明确记录的 DSH Connection 正式数据协议。
- 干净构建按 Host 后 Client 的顺序生成并消费 `typert.host.*` 与 `typert.remote-client.*`，修改 Remote 签名而未重新生成时构建失败。
- SQLite 迁移、外键、数据完整性、会话删除与全量聊天删除均在 DSH Host 所有权下通过验证。
- 插件停用、卸载、重启恢复和第三方替换均只依赖 DSH bundle、Cordis 生命周期、Remote、Connection 和 Slots。

## 结果

ElecKoi 只保留一套对插件作者公开的 Host/Client 能力模型。第三方插件从组件目录看到的“服务接口”将对应真实的 DSH Remote namespace 或正式 Connection 协议，不再是只描述内部实现的人工清单。
