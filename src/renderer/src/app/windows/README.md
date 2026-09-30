# Windows（窗口入口）

ElecKoi Desktop 是纯 PC 客户端，不保留 `mobile` 平台，也不再套一层重复的 `desktop` 目录。

```text
windows/
├─ App.jsx                   Window Router（窗口分发入口）
├─ MainWindow.jsx            Main Window（主窗口）
├─ ChatWindow.jsx            Detached Chat Window（独立聊天窗口）
├─ shell/                    Desktop Shell（标题栏、侧栏与窗口框架）
└─ styles/                   Window Styles（窗口级样式）
```

业务功能放进 `modules/`，跨功能界面组件放进 `ui/`，应用级 Hook 与服务放进 `app/`，跨进程调用只放进 `bridge/`。`windows/` 只负责窗口组合，不堆业务实现。
