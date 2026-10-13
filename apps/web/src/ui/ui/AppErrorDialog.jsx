import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { failureDetailLines, resolveFailure } from "../../utils/failureText.js";
import { CopyIcon, XIcon } from "../icons/index.jsx";

/**
 * 错误对话框：一次呈现**全部**未关闭的错误 notice（`useNotices` 的队列）。
 *
 * 判据来源：ADR 0002 决定 12（对话框显示失败码 + 参数化详情 + 诊断尾部、能一键复制给维护者；
 * 用户可见文案只有一个解析点）、tickets/EH-8-error-surface.md §1。两条连续错误各占一条，
 * 不互相顶掉（用户故事 5）。
 *
 * 每条的字段**全部**来自 `apps/web/src/utils/failureText.js` 这个唯一解析点：`text` 是用户可见
 * 说法，`code` / 详情 / `diagnostic` 原样展示、不翻译。拿不到失败实例的 notice（只有消息字符串）
 * 会折成兜底码（`foldFailure` 的未知失败路径），那是契约里"码没被保住"的诚实说法。
 */
export function AppErrorDialog({ notices, onDismiss }) {
  const list = (Array.isArray(notices) ? notices : []).filter((notice) => notice?.message || notice?.failure);
  const entries = list.map(describeNotice);
  const newestId = list[list.length - 1]?.id;
  const titleId = useId();
  const detailId = useId();
  const statusId = useId();
  const dialogRef = useRef(null);
  const copyRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  const [copyState, setCopyState] = useState("idle");

  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!list.length || typeof document === "undefined") return undefined;
    const previousFocus = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => copyRef.current?.focus());

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismissRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll("button:not(:disabled)") || []);
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [newestId]);

  useEffect(() => {
    setCopyState("idle");
  }, [newestId]);

  if (!list.length) return null;

  async function copyError() {
    try {
      await writeClipboard(entries.map(copyTextOfNotice).join("\n\n"));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const copyLabel = copyState === "copied" ? "已复制" : copyState === "failed" ? "重试复制" : "复制错误";
  const statusText = copyState === "copied"
    ? "错误内容已复制"
    : copyState === "failed"
      ? "复制失败，请手动选择错误内容"
      : "";

  const dialog = (
    <div className="app-error-overlay" role="presentation" onMouseDown={() => onDismiss?.()}>
      <section
        ref={dialogRef}
        className="app-error-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${detailId}${statusText ? ` ${statusId}` : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="app-error-header">
          <h2 id={titleId}>运行错误</h2>
          <button type="button" className="app-error-close" aria-label="关闭错误详情" onClick={onDismiss}>
            <XIcon size={18} />
          </button>
        </header>
        <div id={detailId} className="app-error-details">
          {entries.map((entry) => (
            <article key={entry.id} className="app-error-entry">
              <p className="app-error-text">{entry.text}</p>
              <dl className="app-error-facts">
                <div className="app-error-fact">
                  <dt>失败码</dt>
                  <dd>{entry.code}</dd>
                </div>
                {entry.details.map((detail) => (
                  <div className="app-error-fact" key={detail.key}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
              <pre className="app-error-diagnostic" tabIndex={0}>{entry.diagnostic}</pre>
            </article>
          ))}
        </div>
        <div className="app-error-footer">
          <span id={statusId} className={`app-error-copy-status${copyState === "failed" ? " is-failed" : ""}`} role="status" aria-live="polite">
            {statusText}
          </span>
          <div className="app-error-actions">
            <button type="button" onClick={onDismiss}>关闭</button>
            <button ref={copyRef} type="button" className="is-primary" onClick={copyError}>
              <CopyIcon size={15} />
              <span>{copyLabel}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );

  const portalTarget = typeof document === "undefined" ? null : document.body;
  return portalTarget ? createPortal(dialog, portalTarget) : dialog;
}

/** notice → 界面要展示的字段。解析（码、详情、诊断）只有 `resolveFailure` 一处。 */
function describeNotice(notice) {
  const resolved = resolveFailure(notice.failure ?? notice.message, { fallback: notice.message });
  return {
    id: notice.id,
    text: resolved.text,
    code: resolved.code,
    details: failureDetailLines(resolved.details),
    diagnostic: resolved.diagnostic,
  };
}

/** 一键复制的内容：维护者要的失败码、参数化详情与诊断尾部。 */
function copyTextOfNotice(entry) {
  return [
    entry.text,
    `失败码: ${entry.code}`,
    ...entry.details.map(({ label, value }) => `${label}: ${value}`),
    `诊断: ${entry.diagnostic}`,
  ].join("\n");
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard write failed");
}
