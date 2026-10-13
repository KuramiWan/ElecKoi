import logoIcon from "../../../../assets/eleckoi-app-icon.png";
import { DshPanelLeftIcon } from "../../../../ui/icons/dshComposerIcons.jsx";
import { reportFailure } from "../../../../utils/failureText.js";
import { appWindow } from "../../../services/windowControls.js";

function stopDrag(event) {
  event.stopPropagation();
}

// 窗口控件的 IPC 可以不通过（不可信发送方 / 非 dsh-app 框架拿到的残缺 API 桩）。
// 以前这些拒绝没人接，直接逃成未处理拒绝（notes/eh-explore-renderer.md §5.2）。
// 落点：console.error 一条可检索诊断，由 Electron 的 console-message 转发进主进程日志。
function runWindowControl(action, context) {
  try {
    Promise.resolve(action()).catch((error) => reportFailure(error, context));
  } catch (error) {
    reportFailure(error, context);
  }
}

export function WindowControls({ onClose }) {
  return (
    <div className="window-controls">
      <button className="window-control-button minimize" type="button" title="最小化" onPointerDown={stopDrag} onClick={() => runWindowControl(() => appWindow.minimize(), "窗口最小化")}>
        <span />
      </button>
      <button className="window-control-button maximize" type="button" title="最大化" onPointerDown={stopDrag} onClick={() => runWindowControl(() => appWindow.maximizeToggle(), "窗口最大化")}>
        <span />
      </button>
      <button
        className="window-control-button close"
        type="button"
        title="关闭"
        onPointerDown={stopDrag}
        onClick={() => {
          if (onClose) onClose();
          else runWindowControl(() => appWindow.close(), "窗口关闭");
        }}
      >
        <span />
      </button>
    </div>
  );
}

export function TitleBar({
  title = "ElecKoi",
  projectTitle = "",
  splitSurface = false,
  showWindowControls = true,
  sidePanelCollapsed = false,
  onToggleSidePanel,
  onClose,
}) {
  if (splitSurface) {
    return (
      <header className="client-titlebar split-surface" data-tauri-drag-region>
        {sidePanelCollapsed && onToggleSidePanel ? (
          <button
            className="side-panel-expand-button"
            type="button"
            aria-label="展开侧边栏"
            title="展开侧边栏"
            aria-expanded="false"
            onPointerDown={stopDrag}
            onClick={onToggleSidePanel}
          >
            <DshPanelLeftIcon size={16} />
          </button>
        ) : null}
        <div className="title-spacer" data-tauri-drag-region>
          {projectTitle ? (
            <div className="title-project-tab">
              <span>{projectTitle}</span>
              <i />
            </div>
          ) : null}
        </div>
        {showWindowControls ? <WindowControls onClose={onClose} /> : null}
      </header>
    );
  }

  return (
    <header className="client-titlebar">
      <div className="title-brand" data-tauri-drag-region>
        <img src={logoIcon} alt="" className="title-brand-logo" draggable="false" />
        <strong>{title}</strong>
      </div>
      <div className="title-spacer" data-tauri-drag-region>
        {projectTitle ? (
          <div className="title-project-tab">
            <span>{projectTitle}</span>
            <i />
          </div>
        ) : null}
      </div>

      {showWindowControls ? <WindowControls onClose={onClose} /> : null}
    </header>
  );
}
