import App from './windows/App.jsx';
import { initRendererAssets } from './services/assets.js';
import { installResizePerformanceMode } from './services/windowControls.js';
import { initializeAppearanceMode } from '../modules/appearance/index.js';
import { installUnhandledFailureReporting } from '../utils/failureText.js';
import './windows/styles/index.css';

// 主窗口（DSH 页面）的未处理拒绝落点：`reportFailure` 只 console.error，由 mainWindowPlugin
// 的 console-message 桥转发进主进程日志；不需要新开 IPC 通道。
installUnhandledFailureReporting();
installResizePerformanceMode();
Promise.all([initRendererAssets(), initializeAppearanceMode()]).then(() => {
  globalThis.__ELECKOI_DSH_APP__ = App;
  globalThis.dispatchEvent(new Event('eleckoi:dsh-app-ready'));
}).catch((error) => {
  globalThis.dispatchEvent(new CustomEvent('eleckoi:dsh-app-failed', {
    detail: error instanceof Error ? error.message : String(error)
  }));
});
