import App from './windows/App.jsx';
import { initRendererAssets } from './services/assets.js';
import { installResizePerformanceMode } from './services/windowControls.js';
import { initializeAppearanceMode } from '../modules/appearance/index.js';
import { installUnhandledFailureReporting } from '../utils/failureText.js';
import './windows/styles/index.css';

// 渲染层未处理拒绝的落点（ADR 0002 决定 12 最后一条）：与 main.jsx 同一落点，只 console.error，
// 不新建 IPC 通道（ADR 0017 决定 7）。
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
