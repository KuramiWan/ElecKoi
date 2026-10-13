import { createRoot } from "react-dom/client";
import App from "./app/windows/App.jsx";
import { initRendererAssets } from "./app/services/assets.js";
import { installResizePerformanceMode } from "./app/services/windowControls.js";
import { initializeAppearanceMode } from "./modules/appearance/index.js";
import { installUnhandledFailureReporting } from "./utils/failureText.js";
import "./app/windows/styles/index.css";

async function bootstrap() {
  installResizePerformanceMode();
  await Promise.all([
    initRendererAssets(),
    initializeAppearanceMode(),
  ]);
  const container = document.getElementById("eleckoi-root") || document.getElementById("root");
  if (!container) throw new Error("ElecKoi 页面容器不存在");
  globalThis.__ELECKOI_UNMOUNT__?.();
  const root = createRoot(container);
  globalThis.__ELECKOI_UNMOUNT__ = () => {
    root.unmount();
    delete globalThis.__ELECKOI_UNMOUNT__;
  };
  root.render(<App />);
}

// 渲染层未处理拒绝的落点（ADR 0002 决定 12 最后一条）：不新建 IPC 通道，只 console.error
// 一条可检索的诊断串，由 Electron 的 console-message 转发进主进程日志。
installUnhandledFailureReporting();
globalThis.__ELECKOI_MOUNT__ = bootstrap;
void bootstrap();
