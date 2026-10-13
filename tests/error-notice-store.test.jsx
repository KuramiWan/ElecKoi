// @vitest-environment jsdom
//
// 判据来源：tickets/EH-8-error-surface.md §3（用户故事 4/5）与
// notes/eh-explore-renderer.md §4.3（notice store 单槽的三个缺陷的逐行机制）。
//
// 断言的都是**外部行为**：从一次 notify 出发，断言用户在对话框里读到什么。
// notice store 与它唯一的呈现面按 MainWindow.jsx / ChatWindow.jsx 的真实接法接在一起
// （`<AppToast notices={chat.notices} onDismiss={chat.dismissNotice} />`），所以这里用的是
// 生产同一组合，不是为测试另搭一条路。
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ui/icons/index.jsx", async () => {
  const { createElement } = await import("react");
  const Icon = ({ size = 16 }) => createElement("svg", { width: size, height: size, "aria-hidden": true });
  return { CopyIcon: Icon, XIcon: Icon };
});

import { AppToast } from "../apps/web/src/ui/ui/AppToast.jsx";
import { useNotices } from "../apps/web/src/app/hooks/useNotices.js";

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

function mountNotices() {
  const store = { current: null };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function NoticeHarness() {
    const notices = useNotices();
    useEffect(() => {
      store.current = notices;
    });
    return <AppToast notices={notices.notices} onDismiss={notices.dismissNotice} />;
  }
  act(() => root.render(<NoticeHarness />));
  mounted.push(root);
  return store;
}

const shownText = () => document.body.textContent;

function buttonByText(text) {
  const button = [...document.body.querySelectorAll("button")].find((node) => node.textContent.includes(text));
  if (!button) throw new Error(`找不到按钮：${text}`);
  return button;
}

function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

async function clickCopy() {
  const button = buttonByText("复制错误");
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("notice store", () => {
  // 用户故事 5：(a) 两条错误只显示后一条。
  it("keeps both errors when two failures arrive in a row", () => {
    const store = mountNotices();

    act(() => store.current.notify("error", "第一条失败。"));
    act(() => store.current.notify("error", "第二条失败。"));

    expect(shownText()).toContain("第一条失败。");
    expect(shownText()).toContain("第二条失败。");
    expect(document.querySelectorAll(".app-error-entry").length).toBe(2);
  });

  // 用户故事 5：(b) 错误后接一条非错误，错误不能消失。
  it("keeps the error when a non-error notice arrives after it", () => {
    vi.useFakeTimers();
    const store = mountNotices();

    act(() => store.current.notify("error", "错误仍然在。"));
    act(() => store.current.notify("info", "普通提示。"));

    expect(shownText()).toContain("错误仍然在。");

    // 非 error 的 3200 ms 自动消失定时器跑完之后，错误仍在。
    act(() => vi.advanceTimersByTime(3200));

    expect(shownText()).toContain("错误仍然在。");
  });

  // 用户故事 5：(c) `id: Date.now()` 同毫秒撞号导致两条错误只算一条。
  it("keeps two errors that arrive in the same millisecond apart", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    const store = mountNotices();

    act(() => store.current.notify("error", "同毫秒第一条。"));
    act(() => store.current.notify("error", "同毫秒第二条。"));

    expect(shownText()).toContain("同毫秒第一条。");
    expect(shownText()).toContain("同毫秒第二条。");
    expect(document.querySelectorAll(".app-error-entry").length).toBe(2);
  });
});

describe("error dialog payload", () => {
  // 用户故事 4：对话框里能看到失败码与参数化详情，并且能一键复制给维护者。
  it("shows the failure code, the parameterized details and a copyable diagnostic", async () => {
    const failure = {
      isDSHRemoteError: true,
      code: "eleckoi/io/failed",
      message: "写入角色卡失败",
      details: { operation: "write", path: "D:\\卡\\a.png" },
    };
    const writeText = stubClipboard();
    const store = mountNotices();

    act(() => store.current.notify("error", "保存失败，请重试。", failure));

    // 用户可见文案走 EH-4b 的唯一解析点（按码给出的说法），不是这里另写一份码表。
    expect(shownText()).toContain("保存失败：D:\\卡\\a.png。");
    // 码与参数化详情原样展示，不翻译。
    expect(shownText()).toContain("失败码");
    expect(shownText()).toContain("eleckoi/io/failed");
    expect(shownText()).toContain("operation");
    expect(shownText()).toContain("write");
    expect(shownText()).toContain("path");
    expect(shownText()).toContain("D:\\卡\\a.png");

    await clickCopy();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("eleckoi/io/failed");
    expect(copied).toContain("path: D:\\卡\\a.png");
    expect(copied).toContain("eleckoi-renderer-failure");
  });

  // 用户故事 5 的复制面：一键复制要给维护者全部错误，而不是只有最后一条。
  it("copies every error in the queue", async () => {
    const writeText = stubClipboard();
    const store = mountNotices();

    act(() => store.current.notify("error", "第一条失败。", {
      isDSHRemoteError: true, code: "eleckoi/io/failed", message: "第一条失败。", details: { path: "/tmp/a" },
    }));
    act(() => store.current.notify("error", "第二条失败。", {
      isDSHRemoteError: true, code: "eleckoi/storage/corrupt", message: "第二条失败。", details: { what: "characters.json" },
    }));

    await clickCopy();

    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("eleckoi/io/failed");
    expect(copied).toContain("eleckoi/storage/corrupt");
    expect(copied).toContain("what: characters.json");
  });
});
