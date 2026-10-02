# ADR 0015：内置功能统一登记为 DSH bundle

状态：已采纳，2026-09-30。bundle 登记决策保留；本文旧 Gateway 与 Main 数据边界已由 [ADR 0017](0017-dsh-remote-replaces-desktop-gateway.md) 和 [ADR 0018](0018-dsh-host-owns-product-data.md) 取代。

## 决定

- 七个客户端功能包和消息编辑运行时包补齐同版本 DSH 的 bundle、组合 patch、兼容版本和本地化元数据；角色聊天继续使用自身 bundle。
- 启动叠加配置只调整桌面环境，不再插入上述功能插件。已有 profile 通过一次性登记保留第三方包、用户配置和搜索启停选择，插件 ID 保持稳定。
- 正式 `resolvedProfile.installAnchor` 使用随桌面发布的 Runtime 包清单，让官方解析器遍历桌面依赖及插件包；不能继续使用只包含上游依赖的 DSH 自身清单。
- 插件中心直接使用官方包清单、运行条目、状态和管理操作。运行组件与开发接口分别展示；开发接口目录的声明、校验和传输见 [ADR 0016](0016-plugin-developer-interface-catalog.md)。
- 官方详情页原本只接受已安装或可选包，无法打开由桌面安装层提供且已启用的产品 bundle；锁定版本补丁把 `enabled` 包纳入同一官方详情列表，继续复用原有导航与详情组件。
- 核心界面及其必需依赖不能在运行中停用，否则会导致主窗口失去根布局或数据服务。锁定版本的 DSH 没有面向产品的只读包声明，因此在其既有 `protectedModules` 政策中追加九个核心模块，继续由官方 `management-required` 权限负责拒绝包和组件的停用、卸载。联网搜索和外部扩展不在该追加清单内。
- 该同版本补丁必须在上游升级时复核；上游提供声明式保护合同后移除补丁。禁止另建启停状态、加载器或安装协议。

## 数据与验证

产品数据由 DSH Host 中的唯一 Repository 写入，并通过生成的 Typert Remote 提供给 Client；详见 [ADR 0017](0017-dsh-remote-replaces-desktop-gateway.md) 与 [ADR 0018](0018-dsh-host-owns-product-data.md)。bundle 登记本身不复制 SQLite 数据或 DSH Session 日志。

验证新旧 profile 的登记、正式组合中每个 ID 的唯一性、官方管理器的元数据与保护拒绝、真实 Host 启动，以及界面状态和接口分离。
