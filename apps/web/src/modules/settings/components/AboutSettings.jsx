import appIcon from "../../../assets/eleckoi-app-icon.png";

const BUSY_PHASES = new Set(["checking", "downloading", "installing"]);
const DIALOG_PHASES = new Set(["available", "downloading", "verifying", "ready", "error"]);

export function AboutSettings({ updates }) {
  const android = globalThis.__ELECKOI_CLIENT_PLATFORM__?.kind === "android";
  const status = updates?.status ?? null;
  const phase = status?.phase ?? "idle";
  const busy = BUSY_PHASES.has(phase);
  const canViewUpdate = Boolean(status?.availableVersion && DIALOG_PHASES.has(phase));
  const message = updateStatusMessage(status, updates?.error);
  const currentVersion = status?.currentVersion ?? (android ? globalThis.__ELECKOI_CLIENT_PLATFORM__.version : "");

  async function checkForUpdates() {
    try {
      if (canViewUpdate) updates?.showDialog?.();
      else await updates?.check?.();
    } catch {
      // The shared update state exposes the user-facing error below.
    }
  }

  return (
    <div className="about-settings-page">
      <header className="app-settings-heading">
        <h1>关于 ElecKoi</h1>
      </header>
      <section className="app-settings-card about-version-card" aria-busy={busy || undefined}>
        <img src={appIcon} alt="" aria-hidden="true" draggable="false" />
        <div className="about-version-copy">
          <strong>ElecKoi</strong>
          <span>当前版本 {currentVersion ? `v${currentVersion}` : "—"}</span>
        </div>
        <button
          type="button"
          className="settings-secondary-button about-update-button"
          disabled={busy && !canViewUpdate}
          onClick={checkForUpdates}
        >
          {phase === "checking" ? "正在检查…" : canViewUpdate ? "查看更新" : "检查更新"}
        </button>
        {message ? (
          <p className={`about-update-status${phase === "error" || updates?.error ? " is-error" : ""}`} role="status">
            {message}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function updateStatusMessage(status, error = "") {
  if (error) return error;
  if (!status) return "正在读取版本信息…";
  if (status.phase === "available") return `发现新版本 v${status.availableVersion}`;
  if (status.phase === "downloading") return "正在后台下载更新…";
  if (status.phase === "verifying") return "正在校验更新…";
  if (status.phase === "ready") return "更新已下载，重启后即可完成安装。";
  if (status.phase === "installing") return "正在重启并安装更新…";
  return status.message || "";
}
