import React from "react";
import { AppErrorDialog } from "./AppErrorDialog.jsx";

/**
 * notice 的呈现面：错误走持久对话框，其余走会自己消失的紧凑 toast。
 *
 * 判据来源：ADR 0002 决定 12（不给副窗口补 toast 面，第 7 条）、tickets/EH-8-error-surface.md §2。
 * `notices` 是 `useNotices` 的队列，所以**第二条错误不覆盖第一条**（用户故事 5
 * 「连续两次失败我都看得到」）：有错误时把全部错误一起交给对话框。
 */
export function AppToast({ notices, onDismiss }) {
  const list = (Array.isArray(notices) ? notices : []).filter((notice) => notice?.message);
  const errors = list.filter((notice) => notice.type === "error");
  if (errors.length) return <AppErrorDialog notices={errors} onDismiss={onDismiss} />;

  if (!list.length) return null;
  return list.map((notice) => (
    <div key={notice.id} className={`app-toast ${notice.type || "info"}`} role="status" aria-live="polite">
      <span className="app-toast-icon" aria-hidden="true" />
      <span>{notice.message}</span>
    </div>
  ));
}
